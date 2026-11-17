import { KushkiResponseNormalizer } from "./KushkiResponseNormalizer";
import { RejectionReason } from "../../../domain/value-objects/RejectionReason";

/**
 * Un cobro con tarjeta pedido con `fullResponse: true`, con el código en `details.responseCode`
 * como lo documenta Kushki. El valor `"005"` es ilustrativo, un código fuera de la tabla; los de
 * la tabla se midieron el 24 de octubre de 2026 (docs/testing-data/kushki.md §1).
 */
function cardCharge(transactionStatus: string, responseCode?: unknown): Record<string, unknown> {
  return {
    ticketNumber: "171983521467380925",
    transactionReference: "5c4e7ab2-5b2f-4f4d-9a43-0c9f2d9e2c11",
    details: {
      transactionStatus,
      trackingCode: "ORDER-77",
      subtotalIva0: 50000,
      subtotalIva: 0,
      ivaValue: 0,
      iceValue: 0,
      currencyCode: "COP",
      responseCode,
    },
  };
}

/** Una transferencia con la forma de la consulta de estado medida (punto 48), más el código. */
function transfer(status: string, responseCode?: unknown): Record<string, unknown> {
  return {
    token: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    status,
    paymentDescription: "ORDER-78",
    amount: { subtotalIva0: 50000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
    responseCode,
  };
}

describe("Kushki rejection reason", () => {
  const normalizer = new KushkiResponseNormalizer();

  it("should keep the card responseCode of a declined charge, with an UNKNOWN category", () => {
    const transaction = normalizer.normalize(cardCharge("DECLINED", "005"));

    expect(transaction.getStatus()).toBe("DECLINED");
    expect(transaction.rejectionReason).toEqual(new RejectionReason("005", "UNKNOWN"));
  });

  // Los códigos y motivos medidos el 24 de octubre de 2026 con las tarjetas de kushki.md §1.
  it.each([
    ["017", "Tarjeta no válida", "INVALID_CARD_DATA"],
    ["019", "Tarjeta no compatible", "UNKNOWN"],
    ["021", "Tarjeta sin fondos", "INSUFFICIENT_FUNDS"],
    ["022", "Imposible verificar cvv", "INVALID_CARD_DATA"],
    ["023", "Tarjeta bloqueada por el banco", "CARD_RESTRICTED"],
  ])("should map the measured card code %s (%s) to %s", (code, _reason, category) => {
    expect(normalizer.normalize(cardCharge("DECLINED", code)).rejectionReason).toEqual(
      new RejectionReason(code, category as RejectionReason["rejectionCategory"]),
    );
  });

  it("should not report a rejection for an approved charge, which also carries a responseCode", () => {
    expect(normalizer.normalize(cardCharge("APPROVAL", "000")).rejectionReason).toBeUndefined();
  });

  it("should map the PSE network code 00011 to INSUFFICIENT_FUNDS in a declined transfer", () => {
    const transaction = normalizer.normalize(transfer("declinedTransaction", "00011"));

    expect(transaction.getStatus()).toBe("DECLINED");
    expect(transaction.rejectionReason).toEqual(new RejectionReason("00011", "INSUFFICIENT_FUNDS"));
  });

  /* El ejemplo rechazado del webhook de transferencia trae `T003`. */
  it("should keep another transfer code as UNKNOWN", () => {
    expect(normalizer.normalize(transfer("declinedTransaction", "T003")).rejectionReason).toEqual(
      new RejectionReason("T003", "UNKNOWN"),
    );
  });

  it("should not report a rejection for a declined transfer without code, as the measured query", () => {
    expect(normalizer.normalize(transfer("declinedTransaction")).rejectionReason).toBeUndefined();
  });
});
