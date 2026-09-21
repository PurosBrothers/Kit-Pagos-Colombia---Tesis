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
    it("arma el cobro con el país, la categoría de tarjeta y la referencia del comercio", () => {
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
    it("manda el monto como string con la escala de la divisa", () => {
      expect(buildCheckoutPayload(baseRequest).amount).toBe("150000.00");
    });

    it("no manda el token de tarjeta, que la página de Rapyd no puede usar", () => {
      expect(JSON.stringify(buildCheckoutPayload(baseRequest))).not.toContain(
        "card_1a2b3c",
      );
    });

    it("mapea las dos URL de retorno cuando el comercio las configura", () => {
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

    it("omite las URL cuando no se configuran, en vez de mandarlas vacías", () => {
      const payload = buildCheckoutPayload(baseRequest);

      expect(payload.complete_payment_url).toBeUndefined();
      expect(payload.error_payment_url).toBeUndefined();
    });
  });

  /**
   * Rapyd prefija sus identificadores por recurso, y consultar un checkout en
   * `/payments/{id}` responde `400 ERROR_GET_PAYMENT`. El prefijo es lo que evita esa
   * llamada perdida, y a diferencia del caso de Kushki acá el discriminador se midió.
   */
  describe("isRapydCheckoutId", () => {
    it("reconoce un id de checkout", () => {
      expect(isRapydCheckoutId("checkout_422fb0a43ac1ad77ffd9969f454d3ad6")).toBe(true);
    });

    it("no confunde un id de pago", () => {
      expect(isRapydCheckoutId("payment_d31d3ca850419ab5e2f9f1a33f9c6eea")).toBe(false);
    });
  });

  describe("checkoutToPaymentResponse", () => {
    /** Forma real de `GET /v1/checkout/{id}` antes de que el pagador pague. */
    const sinPagar = {
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

    it("reporta el checkout sin pagar con su propio id y la referencia del comercio", () => {
      const traducida = checkoutToPaymentResponse(sinPagar) as {
        data: Record<string, unknown>;
      };

      expect(traducida.data.id).toBe("checkout_422fb0a43ac1ad77ffd9969f454d3ad6");
      expect(traducida.data.status).toBe("NEW");
      expect(traducida.data.amount).toBe(150000);
      expect(traducida.data.merchant_reference_id).toBe("ord-12345");
    });

    it("usa el pago real en cuanto el pagador termina", () => {
      const pagado = {
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

      const traducida = checkoutToPaymentResponse(pagado) as {
        data: Record<string, unknown>;
      };

      expect(traducida.data.id).toBe("payment_d31d3ca850419ab5e2f9f1a33f9c6eea");
      expect(traducida.data.status).toBe("CLO");
      expect(traducida.data.paid).toBe(true);
    });

    it("deja pasar una respuesta sin data para que el normalizador la reporte malformada", () => {
      expect(checkoutToPaymentResponse({ status: { status: "ERROR" } })).toEqual({
        status: { status: "ERROR" },
      });
    });
  });
});
