import {
  KushkiChargeResponse,
  KushkiTransferStatus,
  KushkiTransferStatusResponse,
  KushkiTransactionStatus,
} from "../gateways/kushki/types";
import { scenarioTargetFor } from "./scenarioTarget";
import { StateMachine } from "./StateMachine";
import { Transition } from "./Transition";

/**
 * La tabla de cobros con tarjeta de Kushki (issue #124).
 *
 * ## `INITIALIZED` es el estado intermedio, y su escritura importa
 *
 * Kushki usa `APPROVAL`, no `APPROVED`, y `DECLINED` se escribe igual. Esa diferencia de
 * una letra con las otras tres pasarelas es lo que hace que un `switch` copiado de Wompi
 * falle en silencio, así que la tabla la declara en el vocabulario nativo y no traducida.
 *
 * `INITIALIZED` es el único estado con salida. El issue lo pide explícitamente como
 * estado intermedio del ciclo de vida, análogo a `PENDING`, y por eso la tabla lo mueve a
 * `APPROVAL` al consultarlo.
 *
 * **Nivel 3 — sin medir**: `types.ts` anota que `INITIALIZED` no está confirmado con
 * fuente pública para pagos con tarjeta (sí para transferencias). El simulador lo incluye
 * porque el issue lo pide, y la transición declara que desde ahí el cobro se acredita. Es
 * una decisión del simulador, y por eso queda anotada como tal.
 *
 * ## El HTTP 200 no dice nada
 *
 * Kushki responde `200` incluso cuando `transaction_status` es `DECLINED`: la decisión
 * vive en el cuerpo. Por eso esta tabla no tiene Transitions de error ni de excepción —
 * un cobro declinado es un estado, no un fallo de la petición.
 */
export const KUSHKI_CHARGE_TRANSITIONS: readonly Transition<
  KushkiTransactionStatus,
  KushkiChargeResponse
>[] = [
  {
    /* El cobro quedó inicializado y esperando; al consultarlo, se acreditó. */
    from: ["INITIALIZED"],
    on: "query",
    to: "APPROVAL",
  },
];

/**
 * La tabla de transferencias de Kushki (issue #124).
 *
 * ## El ciclo de tres pasos es el real, no una invención
 *
 * `docs/testing-data/README.md` §4 y `native-status.ts` del SDK registran que, medido
 * contra `api-uat.kushkipagos.com` el 18 de septiembre de 2026, la transferencia nace en
 * `requestedToken` al emitir el token y pasa a `initializedTransaction` al iniciarla, y que
 * **los dos son no finales**. Hasta esa corrección el SDK reportaba un PSE de Kushki en
 * curso como `ERROR`, porque la tabla de estados no los tenía.
 *
 * Esa es la forma en que el simulador puede reproducir el ciclo: dos consultas y un
 * resultado final, y el SDK reconoce los dos estados intermedios porque los tiene
 * mapeados a `PENDING`.
 *
 * **Nivel 1 — medido** hasta `initializedTransaction`. El paso a `approvedTransaction`
 * **no está medido**: para verlo hay que autorizar en el portal del banco, que es una
 * acción manual. Es el mismo hueco que en Wompi y en las órdenes de Mercado Pago, y por
 * eso el destino final de esta tabla es una decisión del simulador.
 *
 * ## Por qué las finales no tienen transición
 *
 * Por el criterio 1 del issue: una transferencia aprobada se consulta como aprobada. Si
 * `approvedTransaction` tuviera salida, la segunda consulta la movería.
 */
export const KUSHKI_TRANSFER_TRANSITIONS: readonly Transition<
  KushkiTransferStatus,
  KushkiTransferStatusResponse
>[] = [
  {
    /*
     * Se emitió el token pero la transferencia todavía no arrancó.
     *
     * La dispara `init`, no una consulta: es lo que dice la medición —"la transferencia
     * nace en `requestedToken` al emitir el token y pasa a `initializedTransaction` **al
     * iniciarla**"—, y `POST /transfer/v1/init` es exactamente la llamada en la que el
     * comercio le pide a Kushki que arranque la transferencia. Por eso es `pay` y no
     * `query`: es la acción que pone en marcha el cobro, no una lectura de su estado.
     *
     * Su respuesta medida no trae campo de estado, así que este estado **no se ve por la
     * API**: vive entre el `init` y la primera consulta. Es el precio de simular el tiempo en
     * un solo endpoint —la consulta de estado es la única forma de decir que el pagador ya
     * volvió del banco, y el simulador la usa para eso—, y queda anotada como tal en vez de
     * inventar una segunda consulta que la API real tampoco tiene.
     */
    from: ["requestedToken"],
    on: "pay",
    to: "initializedTransaction",
  },
  {
    /*
     * Arrancada y esperando al pagador; al consultarla, el banco ya respondió.
     *
     * El destino es el que registró el escenario de creación, y `approvedTransaction`
     * cuando no hubo ninguno. La ruta de transferencia no podía decidirlo antes —el
     * escenario viaja en la petición que emite el token, y la consulta es otra llamada— así
     * que queda registrado y la tabla lo aplica.
     *
     * Sin esto, `declinedTransaction` era un estado declarado que **ningún camino podía
     * alcanzar**: el escenario se ignoraba en las tres rutas de transferencia.
     */
    from: ["initializedTransaction"],
    on: "query",
    to: (transfer) =>
      (scenarioTargetFor("kushki", "transfer", transfer.token) as
        | KushkiTransferStatus
        | undefined) ?? "approvedTransaction",
  },
];

/** La máquina de cobros con tarjeta de Kushki. */
export const kushkiChargeMachine = new StateMachine<
  KushkiChargeResponse,
  KushkiTransactionStatus
>(KUSHKI_CHARGE_TRANSITIONS, {
  /*
   * El estado de Kushki no está en la raíz. La forma medida contra la API UAT lo lleva en
   * `details.transactionStatus`, y en camelCase, mientras que el identificador del cobro
   * sí está en la raíz como `ticketNumber`. Por eso la máquina recibe un `adapter` con la
   * ruta del estado en vez de leer `record.status`: es el caso para el que existe, y
   * escribir `record.status` acá no compilaría.
   */
  statusOf: (charge) => charge.details.transactionStatus,
  withStatus: (charge, status) => ({
    ...charge,
    details: { ...charge.details, transactionStatus: status },
  }),
});

/** La máquina de transferencias de Kushki. */
export const kushkiTransferMachine = new StateMachine<
  KushkiTransferStatusResponse,
  KushkiTransferStatus
>(KUSHKI_TRANSFER_TRANSITIONS, {
  statusOf: (transfer) => transfer.status,
  withStatus: (transfer, status) => ({ ...transfer, status }),
});
