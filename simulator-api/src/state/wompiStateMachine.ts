import { WompiPaymentMethod, WompiTransaction } from "../gateways/wompi/types";
import { scenarioTargetFor } from "./scenarioTarget";
import { StateMachine } from "./StateMachine";
import { Transition } from "./Transition";

/** Los estados nativos de una transacción en Wompi (`types.ts`, línea 50). */
export type WompiStatus = WompiTransaction["status"];

/**
 * Los destinos que la creación puede registrar para una transacción de Wompi.
 *
 * Solo `PENDING`: es el escenario que deja el cobro sin resolver, y el que el criterio 1
 * del issue #124 pide poder consultar como pendiente. Los demás desenlaces no se registran
 * porque nacen resueltos (`DECLINED`, `VOIDED`) o los decide el banco de prueba (PSE).
 */
export const WOMPI_DECLARED_TARGETS: readonly WompiStatus[] = ["PENDING"];

/** El destino que registró la creación, si registró alguno. */
function registeredTarget(transaction: WompiTransaction): WompiStatus | undefined {
  return scenarioTargetFor(WOMPI_DECLARED_TARGETS, "wompi", "transaction", transaction.id);
}

/**
 * Si a esta transacción le falta la URL de redirección del banco.
 *
 * No es un detalle de implementación: es **el estado** de un PSE. La primera consulta
 * publica la URL y sigue en `PENDING`, la segunda resuelve, y el estado nativo es
 * `PENDING` en las dos. La diferencia entre los dos pasos está en este campo, y por eso
 * es el predicado de las dos transiciones del PSE.
 */
function lacksBankUrl(transaction: WompiTransaction): boolean {
  return transaction.payment_method?.extra?.async_payment_url === undefined;
}

/** Si esta transacción se creó con tarjeta. */
function isCard(transaction: WompiTransaction): boolean {
  return transaction.payment_method?.type !== "PSE";
}

/**
 * El estado final de un PSE, según el banco de prueba elegido.
 *
 * Son los mismos códigos que expone el sandbox de Wompi —`1` «Banco que aprueba», `2`
 * «Banco que declina», `3` «Banco que simula un error» (`docs/testing-data/wompi.md`,
 * línea 122)— para que una prueba pueda elegir el desenlace sin depender del azar.
 * Los tres desenlaces están medidos: `1` y `2` en el punto 43, y `3` el 5 de octubre de
 * 2026, que termina `ERROR`.
 *
 * Está como función y no como valor fijo en la tabla porque el destino sale del código
 * de banco, no del estado actual. Ver la nota de `Transition.to`.
 */
function outcomeForBank(transaction: WompiTransaction): WompiStatus {
  const code = transaction.payment_method?.financial_institution_code;

  if (code === "2") return "DECLINED";
  if (code === "3") return "ERROR";

  return "APPROVED";
}

/**
 * Nivel 1 — medido contra `sandbox.wompi.co` el 5 de octubre de 2026: el PSE del banco
 * `3` termina `ERROR` con este `status_message`, y lo mantiene en las consultas
 * siguientes (observado hasta los 41 865 ms).
 */
const ERROR_BANK_STATUS_MESSAGE = "Transacción con ERROR en Sandbox";

/**
 * La tabla de transiciones de Wompi (issue #124).
 *
 * ## Los estados y de dónde sale cada uno
 *
 * `PENDING`, `APPROVED`, `DECLINED`, `ERROR` y `VOIDED` son los cinco estados nativos
 * de `WompiTransaction["status"]`. `CREATED` queda afuera a propósito: no es un estado
 * de transacción sino de un token de tarjeta (`types.ts`, línea 114), que es otro
 * recurso con su propia ruta.
 *
 * **Nivel 1 — medido contra el sandbox** el 19 de septiembre de 2026: con tarjeta,
 * `POST /transactions` responde `201` con `status: "PENDING"` y `finalized_at: null`, y
 * la transacción pasa sola a `APPROVED` unos 600 ms después. La tabla reproduce esa
 * asimetría: nace pendiente y resuelve en la primera consulta, sin que nadie la
 * dispare.
 *
 * **Nivel 1 — medido contra el sandbox** el 18 de septiembre de 2026 (punto 43 del
 * `architecture-log.md`): en PSE la URL del banco no viene en la creación y aparece en un
 * `GET` posterior; el banco `1` resolvió `APPROVED` a los 1075 ms y el `2`, `DECLINED` a
 * los 1650 ms, los dos sin que nadie visitara el banco. Lo que el sandbox no deja ver es
 * el orden: la URL y el desenlace llegan en la misma consulta. Que el simulador los separe
 * en dos consultas es una decisión que reproduce el orden de producción descrito en ese
 * punto, no una medición.
 *
 * **Nivel 1 — medido contra el sandbox** el 5 de octubre de 2026: el banco `3` sigue
 * `PENDING` sin URL a los 2 931 ms y a los 4 964 ms termina `ERROR`, con
 * `status_message: "Transacción con ERROR en Sandbox"` y la URL presente. Igual que en
 * los bancos `1` y `2`, la URL y el desenlace llegan en la misma consulta.
 *
 * **Nivel 3 — decisión del simulador**: un cobro creado con el escenario `PENDING` no
 * resuelve. El sandbox no tiene un banco ni una tarjeta que dejen el cobro pendiente, y
 * el criterio 1 del issue #124 pide poder consultarlo así.
 *
 * ## Por qué PSE necesita dos reglas y tarjeta necesita una
 *
 * Las tres salen de `PENDING` con un `query`, así que se distinguen todas por `when`.
 * Las de PSE también se diferencian entre sí porque el estado nativo es `PENDING` en
 * las dos consultas.
 *
 * Las dos que resuelven consultan primero el destino registrado. Si es `PENDING`, el
 * destino es el estado de origen y el registro no cambia.
 */
export const WOMPI_TRANSITIONS: readonly Transition<WompiStatus, WompiTransaction>[] =
  [
    {
      /* PSE, 1ª consulta: publica la URL del banco y sigue pendiente. */
      from: ["PENDING"],
      on: "query",
      to: "PENDING",
      when: (transaction) =>
        transaction.payment_method?.type === "PSE" && lacksBankUrl(transaction),
      apply: (transaction) => ({
        ...transaction,
        payment_method: {
          ...transaction.payment_method,
          type: "PSE",
          extra: {
            ...transaction.payment_method?.extra,
            async_payment_url: `http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=${transaction.id}`,
          },
        } as WompiPaymentMethod,
      }),
    },
    {
      /* PSE, 2ª consulta: resuelve, y el estado final lo decide el banco. */
      from: ["PENDING"],
      on: "query",
      to: (transaction) => registeredTarget(transaction) ?? outcomeForBank(transaction),
      when: (transaction) =>
        transaction.payment_method?.type === "PSE" && !lacksBankUrl(transaction),
      apply: (transaction, to) =>
        to === "ERROR" ? { ...transaction, status_message: ERROR_BANK_STATUS_MESSAGE } : transaction,
    },
    {
      /* Tarjeta: resuelve en la primera consulta, porque así se midió. */
      from: ["PENDING"],
      on: "query",
      to: (transaction) => registeredTarget(transaction) ?? "APPROVED",
      when: isCard,
    },
  ];

/** La máquina de Wompi, con su tabla y el acceso a su campo `status`. */
export const wompiStateMachine = new StateMachine<WompiTransaction, WompiStatus>(
  WOMPI_TRANSITIONS,
  {
    statusOf: (transaction) => transaction.status,
    withStatus: (transaction, status) => ({ ...transaction, status }),
  },
);