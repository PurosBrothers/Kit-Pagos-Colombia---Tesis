import type { RejectionReason } from "../../../domain/value-objects/RejectionReason";
import type { RejectionCategory } from "../../../domain/value-objects/RejectionCategory";
import type { TransactionStatus } from "../../../domain/value-objects/TransactionStatus";
import { rejectionFor } from "./rejection-reason";

/**
 * Las categorías de los códigos de Kushki que tienen fuente.
 *
 * Solo `00011`, «Fondos insuficientes» en los códigos de la red PSE
 * (`docs/testing-data/kushki.md`, sección 5.5, tomado de la documentación de Kushki). En qué
 * campo llegan esos códigos no está medido. Los `responseCode` de tarjeta no tienen tabla en el
 * repositorio, y la cuenta UAT aprueba todo, así que ningún rechazo se pudo observar: quedan en
 * `UNKNOWN`.
 */
const KUSHKI_CATEGORIES: Readonly<Record<string, RejectionCategory>> = {
  "00011": "INSUFFICIENT_FUNDS",
};

/**
 * El motivo de rechazo de Kushki: su `responseCode`, tal como llega.
 *
 * En la tarjeta es `details.responseCode` de la respuesta completa del cobro, que
 * `flattenKushkiCharge()` sube a la raíz (documentación de Kushki, «Make a charge or deferred
 * charge», https://api-docs.kushkipagos.com/ecuador/online-payments/card-payments/charge,
 * consultada el 7 de octubre de 2026; no se consultó la página de Colombia). En la
 * transferencia es `responseCode` en la raíz: así lo trae el ejemplo rechazado del webhook de
 * transferencia, y la consulta de estado medida el 18 de septiembre de 2026 no lo trae.
 */
export function readKushkiRejection(
  payload: Record<string, unknown>,
  status: TransactionStatus,
): RejectionReason | undefined {
  return rejectionFor(status, payload.responseCode, KUSHKI_CATEGORIES);
}
