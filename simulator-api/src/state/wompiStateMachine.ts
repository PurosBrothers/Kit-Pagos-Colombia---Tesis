import { WompiPaymentMethod, WompiTransaction } from "../gateways/wompi/types";
import { StateMachine } from "./StateMachine";
import { Transition } from "./Transition";

/** Los estados nativos de una transacción en Wompi (`types.ts`, línea 50). */
export type WompiStatus = WompiTransaction["status"];

/**
 * Si a esta transacción le falta la URL de redirección del banco.
 *
 * No es un detalle de implementación: es **el estado** de un PSE. La primera consulta
 * publica la URL y sigue en `PENDING`, la segunda resuelve, y el estado nativo es
 * `PENDING` en las dos. La diferencia entre los dos pasos está en este campo, y por eso
 * es el predicado de las dos transiciones del PSE.
 */
function faltaUrlDelBanco(transaction: WompiTransaction): boolean {
  return transaction.payment_method?.extra?.async_payment_url === undefined;
}

/** Si esta transacción se creó con tarjeta. */
function esTarjeta(transaction: WompiTransaction): boolean {
  return transaction.payment_method?.type !== "PSE";
}

/**
 * El estado final de un PSE, según el banco de prueba elegido.
 *
 * Son los mismos códigos que expone el sandbox de Wompi —`1` aprueba, `2` declina,
 * `3` da error— para que una prueba pueda elegir el desenlace sin depender del azar.
 *
 * Está como función y no como valor fijo en la tabla porque el destino sale del código
 * de banco, no del estado actual. Ver la nota de `Transition.to`.
 */
function desenlaceDelBanco(transaction: WompiTransaction): WompiStatus {
  const code = transaction.payment_method?.financial_institution_code;

  if (code === "2") return "DECLINED";
  if (code === "3") return "ERROR";

  return "APPROVED";
}

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
 * **Nivel 2 — medido solo hasta la redirección**: el ciclo de PSE está comprobado hasta
 * que aparece la URL del banco, y de ahí en adelante no, porque resolver exige que una
 * persona autorice la transferencia. `docs/testing-data/README.md` §4 lo lista como
 * hueco conocido de Wompi.
 *
 * **Nivel 3 — sin confirmar**: el banco de prueba `"3"` simula un error, pero
 * `docs/testing-data/wompi.md` no registra cuál es el estado resultante. La tabla lo
 * mapea a `ERROR` porque es el estado que el vocabulario de Wompi tiene para eso, y
 * queda anotado aquí como decisión pendiente de medición.
 *
 * ## Por qué PSE necesita dos reglas y tarjeta necesita una
 *
 * Las tres salen de `PENDING` con un `query`, así que se distinguen todas por `when`.
 * Las de PSE también se diferencian entre sí porque el estado nativo es `PENDING` en
 * las dos consultas.
 */
export const WOMPI_TRANSITIONS: readonly Transition<WompiStatus, WompiTransaction>[] =
  [
    {
      /* PSE, 1ª consulta: publica la URL del banco y sigue pendiente. */
      from: ["PENDING"],
      on: "query",
      to: "PENDING",
      when: (transaction) =>
        transaction.payment_method?.type === "PSE" && faltaUrlDelBanco(transaction),
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
      to: desenlaceDelBanco,
      when: (transaction) =>
        transaction.payment_method?.type === "PSE" && !faltaUrlDelBanco(transaction),
    },
    {
      /* Tarjeta: resuelve en la primera consulta, porque así se midió. */
      from: ["PENDING"],
      on: "query",
      to: "APPROVED",
      when: esTarjeta,
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