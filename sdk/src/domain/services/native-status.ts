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
 * aplicación, importan de acá.
 *
 * ## Por qué Rapyd no está
 *
 * Porque su manejador de webhook no traduce un estado sino un **tipo de evento**:
 * Rapyd manda un webhook distinto por resultado (`PAYMENT_COMPLETED`,
 * `PAYMENT_FAILED`) en vez de un evento único con un campo de estado variable.
 * Meterlo acá obligaría a fingir que las dos cosas son lo mismo. Su normalizador
 * sí traduce estados nativos, pero no tiene con quién compartirlos, así que la
 * duplicación que este archivo corrige no existe en Rapyd.
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
 * Los primeros son de la Payments API, que cobra con tarjeta; los segundos de la
 * Orders API, que cobra PSE. No son variantes de lo mismo: son dos vocabularios
 * distintos de la misma pasarela, y por eso la tabla es más larga que las otras.
 * `action_required` es el estado de una orden de PSE esperando la transferencia,
 * medido junto a `status_detail: "waiting_transfer"` (punto 45).
 */
export const MERCADOPAGO_NATIVE_STATUS: Readonly<Record<string, TransactionStatus>> = {
  // Payments API (tarjeta).
  approved: "APPROVED",
  rejected: "DECLINED",
  pending: "PENDING",
  in_process: "PENDING",
  cancelled: "VOIDED",
  // Orders API (PSE).
  processed: "APPROVED",
  action_required: "PENDING",
  created: "PENDING",
  processing: "PENDING",
  canceled: "VOIDED",
  expired: "EXPIRED",
  failed: "ERROR",
};

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
