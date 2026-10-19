import { flattenKushkiCharge, isKushkiFullResponseCharge } from "./kushki-card";
import { KushkiResponseNormalizer } from "./KushkiResponseNormalizer";

/**
 * Respuesta real de `POST /card/v1/charges` con `fullResponse: true`, recortada a los
 * campos que el SDK lee. Medida el 19 de septiembre de 2026 contra
 * api-uat.kushkipagos.com con la tarjeta de prueba 4242 4242 4242 4242.
 */
const realChargeResponse = {
  details: {
    transactionStatus: "APPROVAL",
    trackingCode: "ord-12345",
    subtotalIva0: 50000,
    subtotalIva: 0,
    ivaValue: 0,
    iceValue: 0,
    currencyCode: "COP",
    contactDetails: { email: "comprador@example.com" },
    approvedTransactionAmount: 50000,
    responseText: "Transacción aprobada",
  },
  ticketNumber: "978471849144483984",
  transactionReference: "2520f1c8-de70-4b22-b8dc-f7b7899c2c6d",
};

describe("kushki-card", () => {
  describe("isKushkiFullResponseCharge", () => {
    it("recognizes the fullResponse charge by its details object", () => {
      expect(isKushkiFullResponseCharge(realChargeResponse)).toBe(true);
    });

    it("does not mistake a charge without fullResponse, which has no details", () => {
      expect(
        isKushkiFullResponseCharge({
          ticketNumber: "713915823527394740",
          transactionReference: "fe8fbdd8-8825-4f48-a800-fff6686bdb20",
        }),
      ).toBe(false);
    });

    it("does not mistake the flat shape served by the simulator", () => {
      expect(
        isKushkiFullResponseCharge({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: { subtotalIva0: 50000, currency: "COP" },
        }),
      ).toBe(false);
    });

    it("is not fooled by a details that is not an object", () => {
      expect(isKushkiFullResponseCharge({ details: "APPROVAL" })).toBe(false);
      expect(isKushkiFullResponseCharge({ details: null })).toBe(false);
      expect(isKushkiFullResponseCharge({ details: ["APPROVAL"] })).toBe(false);
    });
  });

  describe("flattenKushkiCharge", () => {
    it("takes the status out of details and puts it where the normalizer looks for it", () => {
      expect(flattenKushkiCharge(realChargeResponse).transaction_status).toBe(
        "APPROVAL",
      );
    });

    it("rebuilds the amount object with the four components", () => {
      expect(flattenKushkiCharge(realChargeResponse).amount).toEqual({
        subtotalIva0: 50000,
        subtotalIva: 0,
        iva: 0,
        ice: 0,
        currency: "COP",
      });
    });

    it("keeps the root ticketNumber, which is the charge identifier", () => {
      expect(flattenKushkiCharge(realChargeResponse).ticketNumber).toBe(
        "978471849144483984",
      );
    });

    it("uses COP when the response has no currency, instead of failing", () => {
      const flattened = flattenKushkiCharge({ details: {}, ticketNumber: "1" });

      expect((flattened.amount as Record<string, unknown>).currency).toBe("COP");
    });
  });

  /**
   * La prueba que importa: la respuesta real, tal como Kushki la manda, tiene que
   * producir una Transaction. Antes de medir, esta misma respuesta fallaba con
   * `MALFORMED_RESPONSE: missing amount`.
   */
  describe("end-to-end normalization", () => {
    it("turns the real response of an approved charge into a Transaction", () => {
      const transaction = new KushkiResponseNormalizer().normalize(
        realChargeResponse,
      );

      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("978471849144483984");
      expect(transaction.orderReference.getValue()).toBe("ord-12345");
      expect(transaction.amount.getValue()).toBe("50000.00");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.payer.email).toBe("comprador@example.com");
    });

    it("maps an issuer rejection to DECLINED", () => {
      const transaction = new KushkiResponseNormalizer().normalize(
        {
          ...realChargeResponse,
          details: { ...realChargeResponse.details, transactionStatus: "DECLINED" },
        },
      );

      expect(transaction.getStatus()).toBe("DECLINED");
    });
  });
});
