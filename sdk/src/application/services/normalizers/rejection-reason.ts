import { RejectionReason } from "../../../domain/value-objects/RejectionReason";
import type { RejectionCategory } from "../../../domain/value-objects/RejectionCategory";
import type { TransactionStatus } from "../../../domain/value-objects/TransactionStatus";

/**
 * El `RejectionReason` de una transacción normalizada, o `undefined`.
 *
 * Solo hay motivo de rechazo cuando el estado es `DECLINED`: así lo define el SAD 15.1 para
 * `Transaction`, y un `ERROR` no es un rechazo del banco sino un fallo antes o fuera del cobro
 * (punto 46). El código se guarda tal como llega; la categoría sale de la tabla de cada
 * pasarela, y un código sin correspondencia con fuente queda en `UNKNOWN`. Ver el punto 87 del
 * architecture-log.md.
 */
export function rejectionFor(
  status: TransactionStatus,
  nativeCode: unknown,
  categories: Readonly<Record<string, RejectionCategory>>,
): RejectionReason | undefined {
  if (status !== "DECLINED") return undefined;
  if (typeof nativeCode !== "string" || nativeCode === "") return undefined;
  return new RejectionReason(nativeCode, categories[nativeCode] ?? "UNKNOWN");
}
