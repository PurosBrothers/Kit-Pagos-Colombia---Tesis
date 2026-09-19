import { CARD_CHARGE_PATH, buildCardChargePayload } from "./kushki-charge";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Gateway } from "../../domain/value-objects/Gateway";

describe("kushki-charge", () => {
  const baseRequest: CreatePaymentRequest = {
    amount: new Amount("50000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-12345"),
    payer: new Payer({ email: "cliente@example.com" }),
    paymentMethod: PaymentMethod.card("kushki-card-token-abc"),
  };

  /**
   * La ruta vieja no era un detalle: `POST /charges` responde `403 Forbidden` contra
   * api-uat.kushkipagos.com, lo mismo que una ruta inventada, así que el cobro con
   * tarjeta nunca habría funcionado fuera del simulador.
   */
  it("cobra en la ruta que existe de verdad", () => {
    expect(CARD_CHARGE_PATH).toBe("/card/v1/charges");
  });

  it("manda el token del comercio y no un literal", () => {
    const payload = buildCardChargePayload(baseRequest);

    expect(payload.token).toBe("kushki-card-token-abc");
    expect(JSON.stringify(payload)).not.toContain("simulated-token");
  });

  it("pide fullResponse, porque sin él la respuesta no alcanza para una Transaction", () => {
    expect(buildCardChargePayload(baseRequest).fullResponse).toBe(true);
  });

  it("conserva la referencia del comercio en trackingCode", () => {
    expect(buildCardChargePayload(baseRequest).trackingCode).toBe("ord-12345");
  });

  it("manda el desglose de monto que Kushki exige", () => {
    expect(buildCardChargePayload(baseRequest).amount).toEqual({
      subtotalIva0: 50000,
      subtotalIva: 0,
      iva: 0,
      ice: 0,
      currency: "COP",
    });
  });

  describe("cuotas", () => {
    it("no manda months cuando es un pago de una sola cuota", () => {
      expect(buildCardChargePayload(baseRequest).months).toBeUndefined();
    });

    /** Kushki llama `months` a las cuotas. Se midió que las acepta y las devuelve. */
    it("traduce las cuotas a months cuando hay más de una", () => {
      const payload = buildCardChargePayload({
        ...baseRequest,
        paymentMethod: PaymentMethod.card("kushki-card-token-abc", {
          installments: 3,
        }),
      });

      expect(payload.months).toBe(3);
    });
  });

  describe("sin token", () => {
    it("falla con INVALID_REQUEST y dice dónde tokenizar", () => {
      try {
        buildCardChargePayload({ ...baseRequest, paymentMethod: undefined });
        fail("debía lanzar");
      } catch (error) {
        const kitPagosError = error as {
          code: KitPagosErrorCode;
          gateway: Gateway;
          message: string;
        };
        expect(kitPagosError.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
        expect(kitPagosError.gateway).toBe(Gateway.KUSHKI);
        expect(kitPagosError.message).toContain("POST /card/v1/tokens");
      }
    });
  });
});
