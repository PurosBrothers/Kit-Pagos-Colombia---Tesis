import type { RejectionReason } from "../../../domain/value-objects/RejectionReason";
import type { RejectionCategory } from "../../../domain/value-objects/RejectionCategory";
import type { TransactionStatus } from "../../../domain/value-objects/TransactionStatus";
import { rejectionFor } from "./rejection-reason";

/**
 * Las categorías de los códigos de Kushki que tienen fuente.
 *
 * Los de tarjeta son los de la tabla de `docs/testing-data/kushki.md` §1, y se midieron el 24 de
 * octubre de 2026: cada tarjeta de rechazo dio su código en `details.responseCode` y su motivo en
 * `details.responseText` (punto 122). Se categoriza solo lo que el motivo dice sin interpretarlo,
 * como en Mercado Pago: `019`, «Tarjeta no compatible», no dice por qué, y queda en `UNKNOWN`.
 *
 * `00011`, «Fondos insuficientes», es de los códigos de la red PSE (sección 5.5, tomado de la
 * documentación de Kushki). En qué campo llegan esos códigos no está medido.
 */
const KUSHKI_CATEGORIES: Readonly<Record<string, RejectionCategory>> = {
  "017": "INVALID_CARD_DATA",
  "021": "INSUFFICIENT_FUNDS",
  "022": "INVALID_CARD_DATA",
  "023": "CARD_RESTRICTED",
  "00011": "INSUFFICIENT_FUNDS",
};

/**
 * El motivo de rechazo de Kushki: su `responseCode`, tal como llega.
 *
 * En la tarjeta es `details.responseCode` del cobro, que `flattenKushkiCharge()` y, en un
 * rechazo, `acceptDeclinedCharge()` suben a la raíz (documentación de Kushki, «Make a charge or
 * deferred charge», https://api-docs.kushkipagos.com/ecuador/online-payments/card-payments/charge,
 * consultada el 7 de octubre de 2026, y medido en Colombia el 24 de octubre de 2026). En la
 * transferencia es `responseCode` en la raíz: así lo trae el ejemplo rechazado del webhook de
 * transferencia, y la consulta de estado medida el 18 de septiembre de 2026 no lo trae.
 */
export function readKushkiRejection(
  payload: Record<string, unknown>,
  status: TransactionStatus,
): RejectionReason | undefined {
  return rejectionFor(status, payload.responseCode, KUSHKI_CATEGORIES);
}
