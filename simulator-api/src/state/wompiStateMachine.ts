import { WompiPaymentMethod, WompiTransaction } from "../gateways/wompi/types";
import { bankRedirectOriginFor } from "../store/BankRedirectOrigins";
import { scenarioTargetFor } from "./scenarioTarget";
import { StateMachine } from "./StateMachine";
import { Transition } from "./Transition";

/** Los estados nativos de una transacción en Wompi (`types.ts`, línea 50). */
export type WompiStatus = WompiTransaction["status"];

/**
 * Los destinos que la creación puede registrar para una transacción de Wompi.
 *
 * `PENDING` es el escenario que deja el cobro sin resolver, y el que el criterio 1 del
 * issue #124 pide poder consultar como pendiente. `DECLINED` es el desenlace de la tarjeta
 * de prueba `4111 1111 1111 1111` (issue #122): nace pendiente como toda tarjeta y la
 * consulta la resuelve declinada. Nivel 1, medido el 6 de octubre de 2026
 * (`docs/testing-data/wompi.md`, sección 1.3). Los demás
 * desenlaces no se registran porque nacen resueltos o los decide el banco de prueba (PSE).
 */
export const WOMPI_DECLARED_TARGETS: readonly WompiStatus[] = ["PENDING", "DECLINED"];

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
 * Nivel 1 — medido contra `sandbox.wompi.co` el 6 de octubre de 2026
 * (`docs/testing-data/wompi.md`, sección 3, «Medido de nuevo el 6 de octubre»): el PSE del
 * banco `2` termina `DECLINED` con este `status_message`, en la misma consulta que trae la URL.
 */
const DECLINED_BANK_STATUS_MESSAGE = "Transacción RECHAZADA en Sandbox";

/** El desenlace de un PSE: el que registró la creación o, si no registró ninguno, el del banco. */
function pseOutcome(transaction: WompiTransaction): WompiStatus {
  return registeredTarget(transaction) ?? outcomeForBank(transaction);
}

/**
 * Si el PSE cierra en la misma consulta que publica la URL.
 *
 * Así se midió el 6 de octubre de 2026 con los bancos `2` y `3`: en unas 90 consultas sobre
 * cinco transacciones, ninguna mostró `PENDING` con la URL. El aprobado sigue en dos pasos
 * por decisión del simulador (ver la tabla), y el `PENDING` registrado no cierra nunca.
 */
function closesWithBankUrl(transaction: WompiTransaction): boolean {
  const outcome = pseOutcome(transaction);
  return outcome === "DECLINED" || outcome === "ERROR";
}

/**
 * La URL del banco, apuntando al simulador.
 *
 * Nivel 1 para la forma — medido contra `sandbox.wompi.co` el 6 de octubre de 2026
 * (`docs/testing-data/wompi.md`, sección 3): `https://api-sandbox.wompi.co/v1/pse/redirect?
 * ticket_id=<id sin guiones>`. El host es el de la petición que creó la transacción
 * (`BankRedirectOrigins.ts`) y la ruta lleva el prefijo `/v1/sim/wompi`, como todas las del
 * simulador.
 */
function bankUrlFor(transaction: WompiTransaction): string {
  const origin = bankRedirectOriginFor("wompi", transaction.id);
  const ticketId = transaction.id.replace(/-/g, "");
  return `${origin}/v1/sim/wompi/pse/redirect?ticket_id=${ticketId}`;
}

/** La transacción con la URL del banco publicada. */
function withBankUrl(transaction: WompiTransaction): WompiTransaction {
  return {
    ...transaction,
    payment_method: {
      ...transaction.payment_method,
      type: "PSE",
      extra: {
        ...transaction.payment_method?.extra,
        async_payment_url: bankUrlFor(transaction),
      },
    } as WompiPaymentMethod,
  };
}

/** El `status_message` medido de cada desenlace de PSE; el aprobado no trae ninguno. */
function withPseStatusMessage(transaction: WompiTransaction, to: WompiStatus): WompiTransaction {
  if (to === "ERROR") return { ...transaction, status_message: ERROR_BANK_STATUS_MESSAGE };
  if (to === "DECLINED") return { ...transaction, status_message: DECLINED_BANK_STATUS_MESSAGE };
  return transaction;
}

/**
 * Nivel 1 — medido contra `sandbox.wompi.co` el 6 de octubre de 2026
 * (`docs/testing-data/wompi.md`, sección 1.3): la tarjeta `4111 1111 1111 1111` nace
 * `PENDING` y la consulta la muestra `DECLINED` con este `status_message`. La `4242` termina
 * `APPROVED` sin `status_message`, y por eso el aprobado no lleva ninguno.
 */
const DECLINED_CARD_STATUS_MESSAGE = "La transacción fue rechazada (Sandbox)";

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
 * **Nivel 1 — medido contra el sandbox** el 6 de octubre de 2026 (`docs/testing-data/wompi.md`,
 * sección 3): en unas 90 consultas sobre cinco transacciones, ninguna mostró `PENDING` con la
 * URL. El rechazo (banco `2`) y el error (banco `3`) llegan con la URL y su `status_message` en
 * la misma consulta, y la tabla los cierra así, sea que los pida el banco, la cabecera o el
 * monto.
 *
 * **Nivel 3 — decisión del simulador**: el aprobado se queda en dos consultas, la URL todavía
 * en `PENDING` y el desenlace después, aunque lo medido es que también llegan juntos. Esa
 * ventana es la que deja ejercitar la redirección (punto 43), y es una ventana que el sandbox
 * no muestra.
 *
 * **Nivel 3 — decisión del simulador**: un cobro creado con el escenario `PENDING` no
 * resuelve. El sandbox no tiene un banco ni una tarjeta que dejen el cobro pendiente, y
 * el criterio 1 del issue #124 pide poder consultarlo así.
 *
 * ## Por qué PSE necesita tres reglas y tarjeta necesita una
 *
 * Las cuatro salen de `PENDING` con un `query`, así que se distinguen todas por `when`.
 * Las de PSE también se diferencian entre sí porque el estado nativo es `PENDING` en
 * las consultas que no cierran.
 *
 * Las que resuelven consultan primero el destino registrado. Si es `PENDING`, el
 * destino es el estado de origen y el registro no cambia.
 */
export const WOMPI_TRANSITIONS: readonly Transition<WompiStatus, WompiTransaction>[] =
  [
    {
      /* PSE que rechaza o falla: la 1ª consulta publica la URL y cierra, como se midió. */
      from: ["PENDING"],
      on: "query",
      to: pseOutcome,
      when: (transaction) =>
        transaction.payment_method?.type === "PSE" &&
        lacksBankUrl(transaction) &&
        closesWithBankUrl(transaction),
      apply: (transaction, to) => withPseStatusMessage(withBankUrl(transaction), to),
    },
    {
      /* PSE que aprueba o queda pendiente, 1ª consulta: publica la URL y sigue pendiente. */
      from: ["PENDING"],
      on: "query",
      to: "PENDING",
      when: (transaction) =>
        transaction.payment_method?.type === "PSE" && lacksBankUrl(transaction),
      apply: withBankUrl,
    },
    {
      /* PSE, 2ª consulta: resuelve con el destino registrado o el del banco. */
      from: ["PENDING"],
      on: "query",
      to: pseOutcome,
      when: (transaction) =>
        transaction.payment_method?.type === "PSE" && !lacksBankUrl(transaction),
      apply: withPseStatusMessage,
    },
    {
      /* Tarjeta: resuelve en la primera consulta, porque así se midió. */
      from: ["PENDING"],
      on: "query",
      to: (transaction) => registeredTarget(transaction) ?? "APPROVED",
      when: isCard,
      apply: (transaction, to) =>
        to === "DECLINED"
          ? { ...transaction, status_message: DECLINED_CARD_STATUS_MESSAGE }
          : transaction,
    },
  ];

/** La máquina de Wompi, con su tabla y el acceso a su campo `status`. */
export const wompiStateMachine = new StateMachine<WompiTransaction, WompiStatus>(
  WOMPI_TRANSITIONS,
  {
    statusOf: (transaction) => transaction.status,
    withStatus: (transaction, status) => ({ ...transaction, status }),
  },
  "wompi.transaction",
);