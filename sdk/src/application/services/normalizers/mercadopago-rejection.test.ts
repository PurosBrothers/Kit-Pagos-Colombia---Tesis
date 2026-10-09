import { readMercadoPagoRejection } from "./mercadopago-rejection";
import { RejectionReason } from "../../../domain/value-objects/RejectionReason";

/** La forma de `transactions` del `402` medido el 7 de octubre de 2026 (docs/testing-data/mercado-pago.md). */
function orderWithDetail(statusDetail: unknown): Record<string, unknown> {
  return {
    status: "failed",
    status_detail: "failed",
    transactions: { payments: [{ status: "failed", status_detail: statusDetail }] },
  };
}

/** Un pago con tarjeta de la Payments API: el detalle va en la raíz. */
function cardPayment(statusDetail: unknown): Record<string, unknown> {
  return { id: 1, status: "rejected", status_detail: statusDetail };
}

describe("readMercadoPagoRejection()", () => {
  it("should take the payment status_detail of a declined order, with an UNKNOWN category", () => {
    expect(readMercadoPagoRejection(orderWithDetail("processing_error"), "DECLINED")).toEqual(
      new RejectionReason("processing_error", "UNKNOWN"),
    );
  });

  /* Medido el 6 de octubre de 2026: la cuenta de prueba rechaza con este código. */
  it("should keep cc_rejected_high_risk as UNKNOWN, because Mercado Pago does not tell the cause", () => {
    expect(readMercadoPagoRejection(cardPayment("cc_rejected_high_risk"), "DECLINED")).toEqual(
      new RejectionReason("cc_rejected_high_risk", "UNKNOWN"),
    );
  });

  it.each([
    ["cc_rejected_insufficient_amount", "INSUFFICIENT_FUNDS"],
    ["cc_rejected_bad_filled_security_code", "INVALID_CARD_DATA"],
    ["cc_rejected_bad_filled_date", "INVALID_CARD_DATA"],
    ["cc_rejected_bad_filled_other", "INVALID_CARD_DATA"],
    ["cc_rejected_other_reason", "UNKNOWN"],
    ["cc_rejected_call_for_authorize", "UNKNOWN"],
  ])("should map the documented card detail %s to %s", (detail, category) => {
    expect(readMercadoPagoRejection(cardPayment(detail), "DECLINED")).toEqual(
      new RejectionReason(detail, category as RejectionReason["rejectionCategory"]),
    );
  });

  it("should not report a rejection when the payment is not declined", () => {
    expect(readMercadoPagoRejection(orderWithDetail("processing_error"), "PENDING")).toBeUndefined();
    expect(readMercadoPagoRejection(cardPayment("pending_contingency"), "PENDING")).toBeUndefined();
  });

  it.each([
    ["with payments that are not a list", { transactions: { payments: "none" } }],
    ["with an empty list of payments", { status_detail: "failed", transactions: { payments: [] } }],
    ["with an empty status_detail", orderWithDetail("")],
    ["with a status_detail that is not text", orderWithDetail(42)],
    ["without status_detail in a card payment", { status: "rejected" }],
  ])("should not report a rejection %s", (_case, data) => {
    expect(readMercadoPagoRejection(data, "DECLINED")).toBeUndefined();
  });
});
