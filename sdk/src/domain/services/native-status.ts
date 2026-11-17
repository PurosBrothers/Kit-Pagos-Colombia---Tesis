import { TransactionStatus } from "../value-objects/TransactionStatus";

/**
 * Traducción de los estados nativos de cada pasarela al enum unificado.
 *
 * ## Por qué existe este archivo
 *
 * Porque el mismo estado se traducía en dos lugares por pasarela —el
 * normalizador de respuestas y el manejador de webhooks— y las dos copias se
 * habían desincronizado. Encontrado al revisar qué faltaba para cerrar PSE
 * (issue #64) y registrado en el punto 46 del `architecture-log.md`. El patrón
 * era el mismo en las tres pasarelas que mapean estados:
 *
 * | Pasarela | El normalizador conocía | Al webhook le faltaba |
 * |---|---|---|
 * | Wompi | `PENDING` | `PENDING` |
 * | Kushki | `INITIALIZED` | `INITIALIZED` |
 * | Mercado Pago | los estados de la Orders API | `processed`, `action_required`, `expired` |
 *
 * Lo que le faltaba a cada manejador era exactamente **el estado no final**, y
 * eso no es casualidad: los webhooks se escribieron cuando el SDK solo cobraba
 * con tarjeta, donde la notificación llega con el pago ya resuelto. PSE rompe
 * ese supuesto, porque la primera notificación puede llegar mientras el pagador
 * todavía no volvió del banco. Un estado ausente de la tabla cae en `ERROR`, así
 * que el efecto era que **una notificación de un pago en curso se reportaba como
 * error**.
 *
 * ## Por qué es un módulo del dominio y no de la capa de aplicación
 *
 * Porque los manejadores de webhook viven en el dominio y no pueden importar de
 * `application/` sin invertir la dependencia que la Arquitectura Hexagonal
 * define (ADR-01). Al revés sí se puede: los normalizadores, que son de
 * aplicación, importan de aquí.
 *
 * ## Por qué Rapyd es una función y no una tabla
 *
 * Su manejador de webhook traduce casi siempre un **tipo de evento**: Rapyd manda un
 * webhook distinto por resultado (`PAYMENT_COMPLETED`, `PAYMENT_FAILED`) en vez de un
 * evento único con un campo de estado variable. La excepción es `PAYMENT_UPDATED`, que
 * no es un resultado sino un aviso de que el pago cambió: su resultado es el estado del
 * pago, como en una consulta. Se midió el 21 de octubre de 2026 en el sandbox, con una
 * tarjeta con 3DS: `PAYMENT_SUCCEEDED` (`ACT`), y en el mismo segundo `PAYMENT_UPDATED`
 * (`ACT`) y `PAYMENT_COMPLETED` (`CLO`). Desde entonces el manejador comparte con el
 * normalizador la traducción del estado del pago (punto 118), que no cabe en una tabla
 * porque dos códigos se desambiguan con un segundo campo.
 */

/**
 * Estados de Wompi. `PENDING` es el de una transacción de PSE esperando que el
 * pagador vuelva del banco (medido contra el sandbox, punto 43).
 */
export const WOMPI_NATIVE_STATUS: Readonly<Record<string, TransactionStatus>> = {
  approved: "APPROVED",
  declined: "DECLINED",
  voided: "VOIDED",
  pending: "PENDING",
};

/**
 * Estados de Kushki, que tiene **dos vocabularios** como Mercado Pago.
 *
 * Los primeros son de tarjeta: usa `APPROVAL` y no `APPROVED`, que es la
 * diferencia que el normalizador gestiona explícitamente.
 *
 * Los segundos son de transferencia (PSE), y **son otra cosa**: no son los mismos
 * valores en otro formato, son nombres propios con el sufijo `Transaction`.
 * Medidos contra la API UAT real el 18 de septiembre de 2026, ejecutando el flujo
 * completo (punto 48): la transferencia nace en `requestedToken` al emitir el
 * token y pasa a `initializedTransaction` al iniciarla. Los dos son **no
 * finales**, y ninguno de los dos estaba en esta tabla, así que hasta esta
 * corrección un PSE de Kushki en curso se reportaba como `ERROR`. Es exactamente
 * el defecto del punto 46, esta vez encontrado midiendo y no leyendo código.
 */
export const KUSHKI_NATIVE_STATUS: Readonly<Record<string, TransactionStatus>> = {
  // Tarjeta.
  approval: "APPROVED",
  approved: "APPROVED",
  declined: "DECLINED",
  initialized: "PENDING",
  // Transferencia (PSE).
  requestedtoken: "PENDING",
  initializedtransaction: "PENDING",
  approvedtransaction: "APPROVED",
  declinedtransaction: "DECLINED",
  expiredtransaction: "EXPIRED",
};

/**
 * Estados de Mercado Pago, de sus **dos** APIs.
 *
 * Los primeros son de la Payments API, por donde se cobraba tarjeta antes de la
 * versión 0.6.0 y que todavía responde la consulta de esos pagos; los segundos de la
 * Orders API, que cobra PSE y, desde 0.6.0, tarjeta. No son variantes de lo mismo: son
 * dos vocabularios distintos de la misma pasarela, y por eso la tabla es más larga que
 * las otras. `action_required` es el estado de una orden de PSE esperando la
 * transferencia, medido junto a `status_detail: "waiting_transfer"` (punto 45). Con
 * tarjeta, medido el 15 de octubre de 2026: `processed` es el cobro aprobado,
 * `processing` el del titular de prueba `CONT` (con `in_process`) y `failed` el rechazo.
 *
 * `failed` es `DECLINED` y no `ERROR` (issue #122): es la orden cuyo pago falló, que la
 * creación entrega en un `402` con la orden en `data` y que la consulta devuelve en
 * `failed / failed` con `200`. Medido el 7 de octubre de 2026
 * (`docs/testing-data/mercado-pago.md`, «El `402` de una orden de PSE que falla»). La
 * orden existe y no cambió en las dos consultas, separadas por 6 segundos: para el
 * comercio es un pago rechazado, y debe verla igual al crearla que al consultarla.
 */
export const MERCADOPAGO_NATIVE_STATUS: Readonly<Record<string, TransactionStatus>> = {
  // Payments API (tarjeta antes de 0.6.0).
  approved: "APPROVED",
  rejected: "DECLINED",
  pending: "PENDING",
  in_process: "PENDING",
  cancelled: "VOIDED",
  // Orders API (PSE y, desde 0.6.0, tarjeta).
  processed: "APPROVED",
  action_required: "PENDING",
  created: "PENDING",
  processing: "PENDING",
  canceled: "VOIDED",
  expired: "EXPIRED",
  failed: "DECLINED",
};

/**
 * Prefijo de `failure_code` que identifica un rechazo del procesador de tarjeta de Rapyd.
 * Catalogo completo en docs.rapyd.net/en/card-network-errors.html; por ejemplo
 * "ERROR_PROCESSING_CARD - [51]" es fondos insuficientes.
 */
export const RAPYD_CARD_DECLINE_PREFIX = "ERROR_PROCESSING_CARD";

/**
 * Estado de un pago de Rapyd. Necesita el pago completo y no solo el estado, porque dos de
 * sus códigos son ambiguos por sí mismos y hay que leer un segundo campo para desambiguarlos.
 */
export function rapydPaymentStatus(
  rawStatus: string,
  payment: { paid?: unknown; failure_code?: unknown },
): TransactionStatus {
  const failureCode = String(payment.failure_code ?? "");

  switch (rawStatus.toUpperCase()) {
    case "CLO":
      // "CLO" es "cerrado", no "pagado": son dos campos distintos y hay que
      // leer los dos. Un pago cerrado sin `paid` no autoriza a decirle al
      // comercio que cobro. La combinacion no esta documentada, asi que se
      // degrada a ERROR en vez de a DECLINED: afirmar un rechazo seria
      // afirmar que el banco respondio, y eso no se sabe.
      return payment.paid === true ? "APPROVED" : "ERROR";
    case "ACT":
      // Activo: creado y esperando que el pagador lo complete. Es el estado en
      // el que el comercio debe reintentar el polling.
      return "PENDING";
    case "NEW":
      // No es un estado de pago sino de **checkout**: la página existe y nadie la
      // completó todavía. Entra aquí porque desde el issue #64 un cobro con tarjeta en
      // Rapyd devuelve un checkout, y consultarlo antes de que el pagador pague
      // responde `status: "NEW"` con `payment.id` en null (ver `rapyd-checkout.ts`).
      // Sin esta rama caía en `default` y un cobro recién creado se reportaba como
      // ERROR, que es el mismo defecto que el punto 46 corrigió en los webhooks.
      return "PENDING";
    case "ERR":
      // Rapyd no distingue el rechazo de negocio del fallo tecnico por
      // `status` (es "ERR" en ambos casos). Se aplica el mismo criterio de
      // desambiguacion por prefijo de `failure_code` que usa el manejador de
      // webhooks para PAYMENT_FAILED, para que el mismo pago no se normalice
      // distinto segun si llego por webhook o por consulta.
      return failureCode.startsWith(RAPYD_CARD_DECLINE_PREFIX) ? "DECLINED" : "ERROR";
    case "EXP":
      return "EXPIRED";
    case "REV":
      // Revertido por Rapyd, con el motivo en `cancel_reason`. Este codigo
      // resuelve el pendiente que ubiquitous-language.md dejaba abierto
      // conjeturando "CAN": el valor real que documenta Rapyd es "REV".
      return "VOIDED";
    default:
      return "ERROR";
  }
}

/**
 * Busca un estado nativo en la tabla de su pasarela.
 *
 * Un estado desconocido devuelve `ERROR` a propósito: es mejor que el comercio
 * vea un error que un `APPROVED` inventado. El valor nativo se preserva aparte en
 * `rawStatus`, así que traducir nunca pierde el original.
 *
 * La búsqueda ignora mayúsculas porque las pasarelas no coinciden entre sí
 * —Wompi y Kushki mandan mayúsculas, Mercado Pago minúsculas— y esa diferencia
 * no debería obligar a cada llamante a recordarla.
 */
export function lookupNativeStatus(
  table: Readonly<Record<string, TransactionStatus>>,
  rawStatus: string,
): TransactionStatus {
  return table[rawStatus.trim().toLowerCase()] ?? "ERROR";
}
