import {
  buildCheckoutPayload,
  checkoutToPaymentResponse,
  isRapydCheckoutId,
} from "./rapyd-checkout";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";

describe("rapyd-checkout", () => {
  const baseRequest: CreatePaymentRequest = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-12345"),
    payer: new Payer({ email: "cliente@example.com" }),
    paymentMethod: PaymentMethod.card("card_1a2b3c"),
  };

  describe("buildCheckoutPayload", () => {
    it("builds the charge with the country, the card category and the merchant reference", () => {
      expect(buildCheckoutPayload(baseRequest)).toEqual({
        amount: "150000.00",
        currency: "COP",
        country: "CO",
        merchant_reference_id: "ord-12345",
        payment_method_type_categories: ["card"],
        receipt_email: "cliente@example.com",
      });
    });

    /**
     * El monto va como string con la escala de la divisa porque Rapyd firma el cuerpo
     * serializado: `JSON.stringify` convierte `150000.00` en `150000` y eso invalida la
     * firma. Es la misma razón por la que lo hacía el cobro directo.
     */
    it("sends the amount as a string with the currency scale", () => {
      expect(buildCheckoutPayload(baseRequest).amount).toBe("150000.00");
    });

    it("does not send the card token, which the Rapyd page cannot use", () => {
      expect(JSON.stringify(buildCheckoutPayload(baseRequest))).not.toContain(
        "card_1a2b3c",
      );
    });

    it("maps both return URLs when the merchant configures them", () => {
      const payload = buildCheckoutPayload({
        ...baseRequest,
        returnUrlConfig: new ReturnUrlConfig(null, {
          success: "https://comercio.example.com/ok",
          failure: "https://comercio.example.com/rechazado",
        }),
      });

      expect(payload.complete_payment_url).toBe("https://comercio.example.com/ok");
      expect(payload.error_payment_url).toBe("https://comercio.example.com/rechazado");
    });

    it("omits the URLs when they are not configured, instead of sending them empty", () => {
      const payload = buildCheckoutPayload(baseRequest);

      expect(payload.complete_payment_url).toBeUndefined();
      expect(payload.error_payment_url).toBeUndefined();
    });
  });

  /**
   * Rapyd prefija sus identificadores por recurso, y consultar un checkout en
   * `/payments/{id}` responde `400 ERROR_GET_PAYMENT`. El prefijo es lo que evita esa
   * llamada perdida, y a diferencia del caso de Kushki aquí el discriminador se midió.
   */
  describe("isRapydCheckoutId", () => {
    it("recognizes a checkout id", () => {
      expect(isRapydCheckoutId("checkout_422fb0a43ac1ad77ffd9969f454d3ad6")).toBe(true);
    });

    it("does not mistake a payment id", () => {
      expect(isRapydCheckoutId("payment_d31d3ca850419ab5e2f9f1a33f9c6eea")).toBe(false);
    });
  });

  describe("checkoutToPaymentResponse", () => {
    /** Forma real de `GET /v1/checkout/{id}` antes de que el pagador pague. */
    const unpaidCheckout = {
      data: {
        id: "checkout_422fb0a43ac1ad77ffd9969f454d3ad6",
        status: "NEW",
        payment: {
          id: null,
          amount: 150000,
          currency_code: "COP",
          merchant_reference_id: "ord-12345",
          status: null,
        },
      },
    };

    it("reports the unpaid checkout with its own id and the merchant reference", () => {
      const mapped = checkoutToPaymentResponse(unpaidCheckout) as {
        data: Record<string, unknown>;
      };

      expect(mapped.data.id).toBe("checkout_422fb0a43ac1ad77ffd9969f454d3ad6");
      expect(mapped.data.status).toBe("NEW");
      expect(mapped.data.amount).toBe(150000);
      expect(mapped.data.merchant_reference_id).toBe("ord-12345");
    });

    it("uses the real payment as soon as the payer finishes", () => {
      const paidCheckout = {
        data: {
          id: "checkout_422fb0a43ac1ad77ffd9969f454d3ad6",
          status: "DON",
          payment: {
            id: "payment_d31d3ca850419ab5e2f9f1a33f9c6eea",
            status: "CLO",
            paid: true,
            amount: 150000,
            currency_code: "COP",
            merchant_reference_id: "ord-12345",
          },
        },
      };

      const mapped = checkoutToPaymentResponse(paidCheckout) as {
        data: Record<string, unknown>;
      };

      expect(mapped.data.id).toBe("payment_d31d3ca850419ab5e2f9f1a33f9c6eea");
      expect(mapped.data.status).toBe("CLO");
      expect(mapped.data.paid).toBe(true);
    });

    it("lets a response without data through so the normalizer reports it as malformed", () => {
      expect(checkoutToPaymentResponse({ status: { status: "ERROR" } })).toEqual({
        status: { status: "ERROR" },
      });
    });
  });
});
