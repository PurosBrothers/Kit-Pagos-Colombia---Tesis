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
      assertSupportedPaymentMethod(metodoQueElTipoNoAdmite(), Gateway.WOMPI, ["CARD", "PSE"]);
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

  /**
   * Las cuatro pasarelas implementan PSE desde que se amplió el alcance del issue
   * #64, así que ya ninguna lo rechaza por no soportarlo. Lo que sigue importando, y
   * es lo que estas pruebas cuidan, es que **falle antes de la red** cuando faltan
   * los datos que cada pasarela exige y el dominio deja opcionales.
   *
   * Que sea `INVALID_REQUEST` y no `UNSUPPORTED_OPERATION` no es un detalle: la
   * salida de uno es completar datos y la del otro es cambiar de pasarela, y el
   * comercio necesita saber cuál de las dos le toca.
   *
   * Cada pasarela pide un conjunto distinto. Rapyd exige nombre y teléfono además
   * del documento, porque su `customer` es una entidad aparte; Kushki exige la URL
   * de retorno, que viaja al pedir el token; Mercado Pago exige nombre, apellido,
   * dirección e IP. Esta solicitud trae solo el documento, así que las tres deben
   * rechazarla.
   */
  it.each([
    ["RapydAdapter", () => new RapydAdapter()],
    ["KushkiAdapter", () => new KushkiAdapter()],
    ["MercadoPagoAdapter", () => new MercadoPagoAdapter()],
  ])(
    "%s should refuse an incomplete PSE payment without issuing any request",
    async (_name, build) => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      await expect(build().createPayment(pseRequest)).rejects.toMatchObject({
        code: KitPagosErrorCode.INVALID_REQUEST,
      });

      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  /**
   * El código de banco es opaco y **con significado por pasarela** (punto 19), así
   * que un comercio que migra de Wompi a Rapyd sin cambiarlo manda un número donde
   * Rapyd espera `co_pse_{banco}_bank`. Rapyd responde a eso con
   * `ERROR_GET_PAYMENT_METHOD_TYPE` y un mensaje que no menciona de dónde sacar el
   * valor correcto, así que el SDK lo ataja antes y dice qué hacer.
   */
  it("RapydAdapter should refuse a bank code from another gateway", async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    const conCodigoAjeno: CreatePaymentRequest = {
      ...pseRequest,
      payer: new Payer({
        email: "cliente@example.com",
        fullName: "Jaime Pavlich Mariscal",
        phone: "3001234567",
        documentType: "CC",
        documentNumber: "1099888777",
      }),
      // "1051" es el código de Davivienda en Mercado Pago, no en Rapyd.
      paymentMethod: PaymentMethod.pse({ bankCode: "1051" }),
    };

    await expect(
      new RapydAdapter().createPayment(conCodigoAjeno),
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
   * El alcance del trabajo son tarjeta y PSE, así que el tipo solo admite esos dos
   * y el compilador ya rechaza cualquier otro. Esta prueba cubre el caso que el
   * compilador **no** ve: un comercio en JavaScript, sin tipos, que manda un método
   * inventado. La guarda tiene que responder lo mismo que si fuera un método futuro
   * que esta pasarela no soporta, y sobre todo **no debe llegar a la red**: un cobro
   * que la pasarela no puede atender no se intenta.
   */
  it.each([
    ["WompiAdapter", () => new WompiAdapter()],
    ["MercadoPagoAdapter", () => new MercadoPagoAdapter()],
    ["RapydAdapter", () => new RapydAdapter()],
    ["KushkiAdapter", () => new KushkiAdapter()],
  ])("%s should refuse a method it cannot charge", async (_name, build) => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    await expect(
      build().createPayment({ ...pseRequest, paymentMethod: metodoQueElTipoNoAdmite() }),
    ).rejects.toMatchObject({ code: KitPagosErrorCode.UNSUPPORTED_OPERATION });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

/**
 * Un método de pago que `PaymentMethodType` no admite, como llegaría desde
 * JavaScript sin tipos.
 *
 * El cast es deliberado y es lo que se quiere probar: sin él no hay forma de
 * escribir este caso, porque el compilador lo rechaza, y entonces la guarda de los
 * adaptadores quedaría sin ninguna prueba que la ejercite.
 */
function metodoQueElTipoNoAdmite(): PaymentMethod {
  return { type: "CASH" } as unknown as PaymentMethod;
}
