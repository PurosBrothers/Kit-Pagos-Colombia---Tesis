import type { RejectionReason } from "../../../domain/value-objects/RejectionReason";
import type { RejectionCategory } from "../../../domain/value-objects/RejectionCategory";
import type { TransactionStatus } from "../../../domain/value-objects/TransactionStatus";
import { rejectionFor } from "./rejection-reason";

/**
 * Las categorías de los `failure_code` de Rapyd que tienen fuente.
 *
 * Solo `[51]`, documentado como «Insufficient Funds» en las tarjetas de error del sandbox
 * (`docs/testing-data/rapyd.md`, sección 2, tomado de la documentación de Rapyd sin medir).
 * `[05]` «Do Not Honor» es un rechazo genérico del emisor y `[43]` «Stolen Card, pick up» no
 * corresponde a ninguna categoría sin interpretarlo: quedan en `UNKNOWN`.
 */
const RAPYD_CATEGORIES: Readonly<Record<string, RejectionCategory>> = {
  "ERROR_PROCESSING_CARD - [51]": "INSUFFICIENT_FUNDS",
};

/**
 * El motivo de rechazo de un pago de Rapyd: su `failure_code`, tal como llega.
 *
 * Es el mismo campo que decide entre `DECLINED` y `ERROR` en el normalizador: solo un
 * `failure_code` con el prefijo `ERROR_PROCESSING_CARD` es un rechazo del procesador.
 */
export function readRapydRejection(
  data: Record<string, unknown>,
  status: TransactionStatus,
): RejectionReason | undefined {
  return rejectionFor(status, data.failure_code, RAPYD_CATEGORIES);
}
