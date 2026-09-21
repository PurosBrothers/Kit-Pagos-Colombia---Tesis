import { flattenKushkiCharge, isKushkiFullResponseCharge } from "./kushki-card";
import { KushkiResponseNormalizer } from "./KushkiResponseNormalizer";

/**
 * Respuesta real de `POST /card/v1/charges` con `fullResponse: true`, recortada a los
 * campos que el SDK lee. Medida el 19 de septiembre de 2026 contra
 * api-uat.kushkipagos.com con la tarjeta de prueba 4242 4242 4242 4242.
 */
const respuestaRealDeCobro = {
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
    it("reconoce el cobro con fullResponse por su objeto details", () => {
      expect(isKushkiFullResponseCharge(respuestaRealDeCobro)).toBe(true);
    });

    it("no confunde un cobro sin fullResponse, que no trae details", () => {
      expect(
        isKushkiFullResponseCharge({
          ticketNumber: "713915823527394740",
          transactionReference: "fe8fbdd8-8825-4f48-a800-fff6686bdb20",
        }),
      ).toBe(false);
    });

    it("no confunde la forma plana que sirve el simulador", () => {
      expect(
        isKushkiFullResponseCharge({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: { subtotalIva0: 50000, currency: "COP" },
        }),
      ).toBe(false);
    });

    it("no se deja engañar por un details que no es objeto", () => {
      expect(isKushkiFullResponseCharge({ details: "APPROVAL" })).toBe(false);
      expect(isKushkiFullResponseCharge({ details: null })).toBe(false);
      expect(isKushkiFullResponseCharge({ details: ["APPROVAL"] })).toBe(false);
    });
  });

  describe("flattenKushkiCharge", () => {
    it("saca el estado de details y lo pone donde el normalizador lo busca", () => {
      expect(flattenKushkiCharge(respuestaRealDeCobro).transaction_status).toBe(
        "APPROVAL",
      );
    });

    it("rearma el objeto amount con los cuatro componentes", () => {
      expect(flattenKushkiCharge(respuestaRealDeCobro).amount).toEqual({
        subtotalIva0: 50000,
        subtotalIva: 0,
        iva: 0,
        ice: 0,
        currency: "COP",
      });
    });

    it("conserva el ticketNumber de la raíz, que es el identificador del cobro", () => {
      expect(flattenKushkiCharge(respuestaRealDeCobro).ticketNumber).toBe(
        "978471849144483984",
      );
    });

    it("usa COP cuando la respuesta no trae divisa, en vez de fallar", () => {
      const aplanada = flattenKushkiCharge({ details: {}, ticketNumber: "1" });

      expect((aplanada.amount as Record<string, unknown>).currency).toBe("COP");
    });
  });

  /**
   * La prueba que importa: la respuesta real, tal como Kushki la manda, tiene que
   * producir una Transaction. Antes de medir, esta misma respuesta fallaba con
   * `MALFORMED_RESPONSE: missing amount`.
   */
  describe("normalización de punta a punta", () => {
    it("convierte la respuesta real de un cobro aprobado en una Transaction", () => {
      const transaction = new KushkiResponseNormalizer().normalize(
        respuestaRealDeCobro,
      );

      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("978471849144483984");
      expect(transaction.orderReference.getValue()).toBe("ord-12345");
      expect(transaction.amount.getValue()).toBe("50000");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.payer.email).toBe("comprador@example.com");
    });

    it("traduce un rechazo del emisor a DECLINED", () => {
      const transaction = new KushkiResponseNormalizer().normalize(
        {
          ...respuestaRealDeCobro,
          details: { ...respuestaRealDeCobro.details, transactionStatus: "DECLINED" },
        },
      );

      expect(transaction.getStatus()).toBe("DECLINED");
    });
  });
});
