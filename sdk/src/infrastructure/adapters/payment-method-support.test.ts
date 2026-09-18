import { assertSupportedPaymentMethod } from "./payment-method-support";
import { WompiAdapter } from "./WompiAdapter";
import { MercadoPagoAdapter } from "./MercadoPagoAdapter";
import { RapydAdapter } from "./RapydAdapter";
import { KushkiAdapter } from "./KushkiAdapter";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

describe("assertSupportedPaymentMethod", () => {
  /**
   * Omitir el método es válido: el contrato dice que cada pasarela aplica su
   * método por defecto, que en las cuatro es tarjeta.
   */
  it("should accept a request that does not declare a payment method", () => {
    expect(() =>
      assertSupportedPaymentMethod(undefined, Gateway.RAPYD, ["CARD"]),
    ).not.toThrow();
  });

  it("should accept a method the gateway declares as supported", () => {
    expect(() =>
      assertSupportedPaymentMethod(PaymentMethod.pse({ bankCode: "1" }), Gateway.WOMPI, [
        "CARD",
        "PSE",
      ]),
    ).not.toThrow();
  });

  /**
   * `UNSUPPORTED_OPERATION` y no `INVALID_REQUEST`: la solicitud del comercio es
   * correcta, es la pasarela activa la que no la puede atender. La salida es
   * cambiar de pasarela, no corregir los datos.
   */
  it("should reject an unsupported method as UNSUPPORTED_OPERATION", () => {
    try {
      assertSupportedPaymentMethod(PaymentMethod.cash(), Gateway.WOMPI, ["CARD", "PSE"]);
      fail("debía lanzar");
    } catch (error) {
      expect(error).toBeInstanceOf(KitPagosError);
      expect((error as KitPagosError).code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
    }
  });

  it("should name the gateway and the supported methods in the message", () => {
    try {
      assertSupportedPaymentMethod(PaymentMethod.pse({ bankCode: "1" }), Gateway.RAPYD, [
        "CARD",
      ]);
      fail("debía lanzar");
    } catch (error) {
      const message = (error as KitPagosError).message;
      expect(message).toContain(Gateway.RAPYD);
      expect(message).toContain("PSE");
      expect(message).toContain("CARD");
    }
  });
});

/**
 * Regresión del defecto medido el 18 de septiembre de 2026 contra el simulador:
 * pedirle PSE a Mercado Pago o a Rapyd devolvía `TRANSACTION (APPROVED)`, es
 * decir un cobro **con tarjeta** de un pago que el pagador quiso hacer por PSE,
 * sin ninguna señal de que el método se había descartado.
 *
 * Estas pruebas no verifican una implementación de PSE: verifican que una
 * pasarela que no la tiene lo diga en vez de cobrar otra cosa. Y comprueban que
 * falle **antes** de la red, porque un cobro que no debe ocurrir no debe llegar
 * a salir.
 */
describe("pedir un método que la pasarela no implementa", () => {
  const pseRequest: CreatePaymentRequest = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-pse-1"),
    payer: new Payer({
      email: "cliente@example.com",
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: "1" }),
  };

  const originalFetch = global.fetch;

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it.each([
    ["RapydAdapter", () => new RapydAdapter()],
    ["KushkiAdapter", () => new KushkiAdapter()],
  ])("%s should refuse a PSE payment without issuing any request", async (_name, build) => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    await expect(build().createPayment(pseRequest)).rejects.toMatchObject({
      code: KitPagosErrorCode.UNSUPPORTED_OPERATION,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  /**
   * Mercado Pago sí implementa PSE desde este issue, así que no debe rechazarlo
   * por no soportarlo. Lo que sí rechaza es la falta de los datos que su Orders
   * API exige y el dominio deja opcionales, y lo hace con `INVALID_REQUEST` en
   * vez de `UNSUPPORTED_OPERATION`: la distinción importa porque la salida de uno
   * es completar datos y la del otro es cambiar de pasarela.
   */
  it("MercadoPagoAdapter should refuse a PSE payment that lacks its required data", async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    await expect(
      new MercadoPagoAdapter().createPayment(pseRequest),
    ).rejects.toMatchObject({ code: KitPagosErrorCode.INVALID_REQUEST });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  /** Wompi sí la implementa, así que no debe rechazarla. */
  it("WompiAdapter should accept a PSE payment", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            id: "wompi-pse-1",
            status: "PENDING",
            amount_in_cents: 15000000,
            currency: "COP",
            reference: "ord-pse-1",
            customer_email: "cliente@example.com",
            payment_method: { type: "PSE", extra: {} },
          },
        }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "wompi-pse-1",
            status: "PENDING",
            amount_in_cents: 15000000,
            currency: "COP",
            reference: "ord-pse-1",
            customer_email: "cliente@example.com",
            payment_method: {
              type: "PSE",
              extra: { async_payment_url: "https://banco.example/pagar" },
            },
          },
        }),
      });
    global.fetch = mockFetch;

    const result = await new WompiAdapter().createPayment(pseRequest);

    expect(result.outcome).toBe("REDIRECT_REQUIRED");
  });

  /**
   * `CASH` existe en el tipo desde #85 y ninguna pasarela lo implementa todavía,
   * así que las cuatro tienen que rechazarlo.
   */
  it.each([
    ["WompiAdapter", () => new WompiAdapter()],
    ["MercadoPagoAdapter", () => new MercadoPagoAdapter()],
    ["RapydAdapter", () => new RapydAdapter()],
    ["KushkiAdapter", () => new KushkiAdapter()],
  ])("%s should refuse a CASH payment", async (_name, build) => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    await expect(
      build().createPayment({ ...pseRequest, paymentMethod: PaymentMethod.cash() }),
    ).rejects.toMatchObject({ code: KitPagosErrorCode.UNSUPPORTED_OPERATION });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
