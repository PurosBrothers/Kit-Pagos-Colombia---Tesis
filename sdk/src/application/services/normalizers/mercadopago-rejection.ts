import type { RejectionReason } from "../../../domain/value-objects/RejectionReason";
import type { RejectionCategory } from "../../../domain/value-objects/RejectionCategory";
import type { TransactionStatus } from "../../../domain/value-objects/TransactionStatus";
import { rejectionFor } from "./rejection-reason";

/**
 * Las categorías de los `status_detail` de tarjeta que tienen fuente.
 *
 * La correspondencia entre titular de prueba y `status_detail` es la de la documentación de
 * Mercado Pago que sigue el simulador (`docs/02-arquitectura/3-api-de-simulacion.md`, sección
 * 4), y el significado de cada titular es el de `docs/testing-data/mercado-pago.md`
 * («Escenarios de Prueba»): `FUND` «Importe Insuficiente», `SECU` «Código de Seguridad
 * Inválido», `EXPI` «Fecha de Vencimiento», `FORM` «Error de Formulario». Ninguno se pudo
 * confirmar en la cuenta de prueba, que el 6 de octubre de 2026 rechazó todo con
 * `cc_rejected_high_risk`. Ese código, `cc_rejected_other_reason`,
 * `cc_rejected_call_for_authorize`, `cc_rejected_max_attempts` y el `processing_error` de PSE
 * quedan en `UNKNOWN`: Mercado Pago no informa la causa, o el código no corresponde a ninguna
 * categoría sin interpretarlo.
 */
const MERCADOPAGO_CATEGORIES: Readonly<Record<string, RejectionCategory>> = {
  cc_rejected_insufficient_amount: "INSUFFICIENT_FUNDS",
  cc_rejected_bad_filled_security_code: "INVALID_CARD_DATA",
  cc_rejected_bad_filled_date: "INVALID_CARD_DATA",
  cc_rejected_bad_filled_other: "INVALID_CARD_DATA",
};

/**
 * El motivo de rechazo de Mercado Pago: el `status_detail` del pago.
 *
 * En la Payments API (tarjeta) el pago es la raíz y el detalle es `status_detail`, por ejemplo
 * `cc_rejected_high_risk` (medido el 6 de octubre de 2026). En la Orders API (PSE) la orden
 * fallida dice solo `failed / failed`, y el detalle está en `transactions.payments[0]`: en el
 * `402` medido el 7 de octubre de 2026 es `processing_error` (`docs/testing-data/mercado-pago.md`,
 * «El `402` de una orden de PSE que falla»). El `status_detail` de la raíz de una orden no se
 * usa, porque repite el estado.
 *
 * Es una función de módulo y no un método del normalizador porque `normalize()` está en
 * complejidad 9 de 10 (`ck-metrics.mdc`).
 */
export function readMercadoPagoRejection(
  data: Record<string, unknown>,
  status: TransactionStatus,
): RejectionReason | undefined {
  const transactions = data.transactions as { payments?: unknown } | undefined;
  if (transactions === undefined) {
    return rejectionFor(status, data.status_detail, MERCADOPAGO_CATEGORIES);
  }
  const payments = Array.isArray(transactions.payments) ? transactions.payments : [];
  const detail = (payments[0] as { status_detail?: unknown } | undefined)?.status_detail;
  return rejectionFor(status, detail, MERCADOPAGO_CATEGORIES);
}
