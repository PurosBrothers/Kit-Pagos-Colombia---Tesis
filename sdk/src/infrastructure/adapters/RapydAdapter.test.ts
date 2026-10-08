import { jsonErrorResponse } from "../../test-support/http-response";
import { createHmac } from "crypto";
import { RapydAdapter } from "./RapydAdapter";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import {
  expectRedirect,
  expectTransaction,
} from "../../test-support/payment-result";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";

describe("RapydAdapter", () => {
  const originalFetch = global.fetch;

  const credentials: Credentials = {
    publicKey: "rapyd_access_key_test",
    privateKey: "rapyd_secret_key_test",
  };

  const validRequest: CreatePaymentRequest = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-12345"),
    payer: new Payer({ email: "cliente@example.com" }),
  };

  /** Respuesta aprobada con el sobre `{ status, data }` que Rapyd usa siempre. */
  const approvedRapydResponse = {
    status: {
      error_code: "",
      status: "SUCCESS",
      message: "",
      response_code: "",
      operation_id: "op-abc",
    },
    data: {
      id: "payment_d31d3ca850419ab5e2f9f1a33f9c6eea",
      status: "CLO",
      paid: true,
      amount: "150000.00",
      currency_code: "COP",
      merchant_reference_id: "ord-12345",
      receipt_email: "cliente@example.com",
      failure_code: "",
      failure_message: "",
      created_at: 1756292071,
    },
  };

  const mockOk = (body: unknown = approvedRapydResponse) =>
    jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => body,
    });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("amount format", () => {
    it("sends the amount in pesos and not in cents", async () => {
      // Es la diferencia central con Wompi y el error mas facil de cometer
      // copiando WompiAdapter: si el adaptador llamara a toMinorUnits(), el
      // monto saldria como "15000000" y el comercio cobraria cien veces mas.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment(validRequest);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.amount).toBe("150000.00");
      expect(body.amount).not.toBe("15000000");
    });

    it("sends the amount as a string, not as a JSON number", async () => {
      // Rapyd documenta que JSON.stringify convierte 12.00 en 12 y que eso
      // rompe el calculo de la firma, y recomienda enviar los montos como
      // strings numericos. El cuerpo serializado debe llevar el monto entre
      // comillas.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment(validRequest);

      const rawBody: string = mockFetch.mock.calls[0][1].body;
      expect(rawBody).toContain('"amount":"150000.00"');
      expect(rawBody).not.toContain('"amount":150000');
    });

    it("keeps trailing zeros that a number would lose", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment({
        ...validRequest,
        amount: new Amount("19.90"),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.amount).toBe("19.90");
    });

    it("pads to the currency scale when the amount has no decimals", async () => {
      // COP tiene exponente 2 en ISO 4217, asi que "50000" se envia como
      // "50000.00": la escala la fija la divisa, no como el comercio escribio
      // el monto.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment({
        ...validRequest,
        amount: new Amount("50000"),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.amount).toBe("50000.00");
    });
  });

  describe("request signature", () => {
    /**
     * Reimplementacion literal del algoritmo publicado en
     * docs.rapyd.net/en/request-signatures.html, escrita aparte del codigo de
     * produccion a proposito: si alguien "simplifica" sign() a
     * digest("base64"), o deja de pasar el metodo en minusculas, estas pruebas
     * fallan. Sin un vector independiente, una prueba de firma solo verificaria
     * que el codigo coincide consigo mismo.
     */
    const referenceSignature = (
      method: string,
      urlPath: string,
      salt: string,
      timestamp: string,
      body: string
    ): string => {
      const toSign =
        method +
        urlPath +
        salt +
        timestamp +
        credentials.publicKey +
        credentials.privateKey +
        body;
      const hmac = createHmac("sha256", credentials.privateKey);
      hmac.update(toSign);
      return Buffer.from(hmac.digest("hex")).toString("base64");
    };

    it("signs the creation with Rapyd's official formula", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).createPayment(validRequest);

      const [, init] = mockFetch.mock.calls[0];
      const headers = init.headers;

      expect(headers.signature).toBe(
        referenceSignature(
          "post",
          "/v1/sim/rapyd/checkout",
          headers.salt,
          headers.timestamp,
          init.body
        )
      );
    });

    it("signs the exact body it sends, without re-serializing it", async () => {
      // Si el adaptador serializara el payload una vez para firmar y otra para
      // enviar, cualquier diferencia entre ambas cadenas produciria una firma
      // que no corresponde al cuerpo. Esta prueba fija que se firma el mismo
      // string que viaja.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).createPayment(validRequest);

      const [, init] = mockFetch.mock.calls[0];
      const sentBodySignature = referenceSignature(
        "post",
        "/v1/sim/rapyd/checkout",
        init.headers.salt,
        init.headers.timestamp,
        init.body
      );

      expect(init.headers.signature).toBe(sentBodySignature);
    });

    it("signs the status query with method get and an empty body", async () => {
      // Rapyd no tiene un esquema reducido de solo lectura: la consulta se firma
      // igual que la creacion. Un cuerpo ausente se firma como string vacio, no
      // como "{}".
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).getStatus("payment_xyz");

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.signature).toBe(
        referenceSignature(
          "get",
          "/v1/sim/rapyd/payments/payment_xyz",
          init.headers.salt,
          init.headers.timestamp,
          ""
        )
      );
    });

    it("does not reuse the salt across requests", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      const adapter = new RapydAdapter(undefined, credentials);
      await adapter.createPayment(validRequest);
      await adapter.createPayment(validRequest);

      const firstSalt = mockFetch.mock.calls[0][1].headers.salt;
      const secondSalt = mockFetch.mock.calls[1][1].headers.salt;
      expect(firstSalt).not.toBe(secondSalt);
    });

    it("sends the four authentication headers Rapyd requires", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).createPayment(validRequest);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.access_key).toBe("rapyd_access_key_test");
      expect(headers.salt).toMatch(/^[0-9a-f]{16}$/);
      expect(Number(headers.timestamp)).toBeGreaterThan(0);
      expect(typeof headers.signature).toBe("string");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("never sends the secret key in a header", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).createPayment(validRequest);

      const [, init] = mockFetch.mock.calls[0];
      const serializedBody = JSON.stringify(init.headers) + init.body;
      expect(serializedBody).not.toContain(credentials.privateKey);
    });

    it("timestamp in seconds and not in milliseconds", async () => {
      // Rapyd rechaza un timestamp con más de 300 s de atraso (medido el 7 de octubre de
      // 2026). Enviarlo en milisegundos lo situaría décadas en el futuro.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).createPayment(validRequest);

      const timestamp = Number(mockFetch.mock.calls[0][1].headers.timestamp);
      const nowInSeconds = Math.floor(Date.now() / 1000);
      expect(Math.abs(nowInSeconds - timestamp)).toBeLessThanOrEqual(5);
    });

    it("omits the signature headers when there are no credentials", async () => {
      // El mock de la API de Simulacion no verifica la firma, y el adaptador
      // debe seguir siendo instanciable sin configuracion, igual que el de Wompi.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment(validRequest);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers).toEqual({ "Content-Type": "application/json" });
    });

    it("signs the real path when the base points to the Rapyd sandbox", async () => {
      // Contra el sandbox el path firmado es /v1/checkout, no el del simulador.
      // Se deriva de la URL en vez de estar escrito a mano.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(
        "https://sandboxapi.rapyd.net/v1",
        credentials
      ).createPayment(validRequest);

      const [url, init] = mockFetch.mock.calls[0];
      // La base es la raíz y el adaptador le agrega la ruta del recurso, así que
      // el path firmado es el completo.
      expect(url).toBe("https://sandboxapi.rapyd.net/v1/checkout");
      expect(init.headers.signature).toBe(
        referenceSignature(
          "post",
          "/v1/checkout",
          init.headers.salt,
          init.headers.timestamp,
          init.body
        )
      );
    });
  });

  describe("createPayment()", () => {
    /**
     * El cobro con tarjeta pasa por la página de pago de Rapyd y no por `/payments`.
     * No es una preferencia: se midió que `/payments` sin `payment_method` responde
     * `400 MISSING_FIELDS - [PAYMENT_METHOD]`, que un token de tarjeta guardado responde
     * `400 ERROR_CARD_NOT_AUTHENTICATED`, y que el único camino que funciona exige el
     * número de la tarjeta en la petición. Ver `rapyd-checkout.ts` y el punto 50.
     */
    it("maps the domain to the native fields of the Rapyd checkout", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment(validRequest);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:3000/v1/sim/rapyd/checkout");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({
        amount: "150000.00",
        currency: "COP",
        country: "CO",
        merchant_reference_id: "ord-12345",
        payment_method_type_categories: ["card"],
        receipt_email: "cliente@example.com",
      });
    });

    /**
     * El `cardToken` que el comercio haya conseguido no viaja: la página de Rapyd le pide
     * la tarjeta al pagador otra vez. No se rechaza para que el comercio no tenga que
     * escribir código distinto por pasarela, que es lo que el SDK existe para evitar.
     */
    it("does not send the card token, because the Rapyd page asks for the card", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment({
        ...validRequest,
        paymentMethod: PaymentMethod.card("card_1a2b3c"),
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.payment_method).toBeUndefined();
      expect(JSON.stringify(requestBody)).not.toContain("card_1a2b3c");
    });

    it("charges a card without the merchant having any token", async () => {
      global.fetch = mockOk();

      const paymentResult = await new RapydAdapter().createPayment({
        ...validRequest,
        paymentMethod: PaymentMethod.card(),
      });

      expect(paymentResult.outcome).toBeDefined();
    });

    it("returns a normalized approved Transaction", async () => {
      global.fetch = mockOk();

      const transaction = expectTransaction(await new RapydAdapter().createPayment(validRequest));

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe(
        "payment_d31d3ca850419ab5e2f9f1a33f9c6eea"
      );
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.RAPYD);
      expect(transaction.amount.getValue()).toBe("150000.00");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.orderReference.getValue()).toBe("ord-12345");
    });

    it("reports a pending redirect when Rapyd triggers 3DS, instead of dropping the URL", async () => {
      // Prueba de regresión del issue #64. Antes de ese cambio, este mismo pago
      // devolvía una Transaction PENDING y el `redirect_url` se perdía: el
      // normalizador traduce "ACT" a PENDING y Transaction no tenía dónde
      // guardar la URL. El comercio hacía polling de un pago que nunca iba a
      // avanzar, porque el paso que faltaba era una redirección que él no sabía
      // que debía hacer.
      global.fetch = mockOk({
        status: { status: "SUCCESS", error_code: "" },
        data: {
          id: "payment_3ds_abc123",
          status: "ACT",
          paid: false,
          amount: "150000.00",
          currency_code: "COP",
          merchant_reference_id: "ord-12345",
          next_action: "3d_verification",
          redirect_url: "https://sandbox.rapyd.net/v1/checkout/3ds/payment_3ds_abc123",
        },
      });

      const result = await new RapydAdapter().createPayment(validRequest);

      expect(result.outcome).toBe("REDIRECT_REQUIRED");
      const redirect = expectRedirect(result);
      expect(redirect.redirectUrl).toBe(
        "https://sandbox.rapyd.net/v1/checkout/3ds/payment_3ds_abc123",
      );
      expect(redirect.gatewayTransactionId.value).toBe("payment_3ds_abc123");
      expect(redirect.rawStatus).toBe("ACT");
    });

    it("still reports a transaction when the payment resolves without a redirect", async () => {
      global.fetch = mockOk();

      const result = await new RapydAdapter().createPayment(validRequest);

      expect(result.outcome).toBe("TRANSACTION");
    });

    it("maps the return URLs to the Rapyd fields when configured", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment({
        ...validRequest,
        returnUrlConfig: new ReturnUrlConfig(undefined, {
          success: "https://comercio.co/ok",
          failure: "https://comercio.co/error",
        }),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.complete_payment_url).toBe("https://comercio.co/ok");
      expect(body.error_payment_url).toBe("https://comercio.co/error");
    });

    it("does not include redirect fields when they are not configured", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment(validRequest);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty("complete_payment_url");
      expect(body).not.toHaveProperty("error_payment_url");
    });

    it("maps a network failure to KitPagosError via ErrorHandler", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        new RapydAdapter().createPayment(validRequest)
      ).rejects.toBeInstanceOf(KitPagosError);
    });

    it("maps an HTTP error to KitPagosError via ErrorHandler", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonErrorResponse(401, {
          status: { error_code: "UNAUTHENTICATED_API_CALL", status: "ERROR" },
        }),
      );

      await expect(
        new RapydAdapter().createPayment(validRequest)
      ).rejects.toBeInstanceOf(KitPagosError);
    });

    it("maps an HTTP error with a non-JSON body by reading it as text", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("no es JSON");
        },
        text: async () => "Bad Gateway",
      });

      await expect(
        new RapydAdapter().createPayment(validRequest)
      ).rejects.toBeInstanceOf(KitPagosError);
    });

    it("maps only the success URL when it is the only one configured", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment({
        ...validRequest,
        returnUrlConfig: new ReturnUrlConfig(undefined, {
          success: "https://comercio.co/ok",
        }),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.complete_payment_url).toBe("https://comercio.co/ok");
      expect(body).not.toHaveProperty("error_payment_url");
    });

    it("uses the single URL for both fields when configured without distinction", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment({
        ...validRequest,
        returnUrlConfig: new ReturnUrlConfig("https://comercio.co/retorno"),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.complete_payment_url).toBe("https://comercio.co/retorno");
      expect(body.error_payment_url).toBe("https://comercio.co/retorno");
    });

    it("maps an unparseable body to KitPagosError", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => {
          throw new Error("Unexpected end of JSON input");
        },
      });

      await expect(
        new RapydAdapter().createPayment(validRequest)
      ).rejects.toBeInstanceOf(KitPagosError);
    });
  });

  describe("card through the Rapyd checkout page", () => {
    /** Forma real de `POST /v1/checkout`, recortada a lo que el SDK lee. */
    const checkoutResponse = {
      status: { status: "SUCCESS", error_code: "" },
      data: {
        id: "checkout_422fb0a43ac1ad77ffd9969f454d3ad6",
        status: "NEW",
        redirect_url:
          "https://sandboxcheckout.rapyd.net/?token=checkout_422fb0a43ac1ad77ffd9969f454d3ad6",
        payment: {
          id: null,
          amount: 150000,
          currency_code: "COP",
          merchant_reference_id: "ord-12345",
          status: null,
        },
      },
    };

    it("returns a redirect to the Rapyd page, with the checkout id", async () => {
      global.fetch = mockOk(checkoutResponse);

      const redirect = expectRedirect(
        await new RapydAdapter().createPayment(validRequest),
      );

      expect(redirect.redirectUrl).toBe(
        "https://sandboxcheckout.rapyd.net/?token=checkout_422fb0a43ac1ad77ffd9969f454d3ad6",
      );
      expect(redirect.gatewayTransactionId.value).toBe(
        "checkout_422fb0a43ac1ad77ffd9969f454d3ad6",
      );
    });

    /**
     * Un id de checkout en `/payments/{id}` responde `400 ERROR_GET_PAYMENT`, así que la
     * consulta tiene que ir al recurso que corresponde. La ruta se elige por el prefijo.
     */
    it("queries the status on /checkout and not on /payments", async () => {
      const mockFetch = mockOk({
        status: { status: "SUCCESS" },
        data: checkoutResponse.data,
      });
      global.fetch = mockFetch;

      const transaction = await new RapydAdapter().getStatus(
        "checkout_422fb0a43ac1ad77ffd9969f454d3ad6",
      );

      expect(mockFetch.mock.calls[0][0]).toBe(
        "http://localhost:3000/v1/sim/rapyd/checkout/checkout_422fb0a43ac1ad77ffd9969f454d3ad6",
      );
      // Un checkout que nadie pagó es un cobro pendiente, no un error.
      expect(transaction.getStatus()).toBe("PENDING");
      expect(transaction.orderReference.getValue()).toBe("ord-12345");
    });

    it("returns the real payment as soon as the payer finishes on the page", async () => {
      global.fetch = mockOk({
        status: { status: "SUCCESS" },
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
            receipt_email: "cliente@example.com",
          },
        },
      });

      const transaction = await new RapydAdapter().getStatus(
        "checkout_422fb0a43ac1ad77ffd9969f454d3ad6",
      );

      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe(
        "payment_d31d3ca850419ab5e2f9f1a33f9c6eea",
      );
    });

    it("still queries /payments when the identifier belongs to a payment", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().getStatus("payment_d31d3ca850419ab5e2f9f1a33f9c6eea");

      expect(mockFetch.mock.calls[0][0]).toBe(
        "http://localhost:3000/v1/sim/rapyd/payments/payment_d31d3ca850419ab5e2f9f1a33f9c6eea",
      );
    });
  });

  describe("getStatus()", () => {
    it("queries the payment by its identifier and normalizes the response", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      const transaction = await new RapydAdapter().getStatus(
        "payment_d31d3ca850419ab5e2f9f1a33f9c6eea"
      );

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "http://localhost:3000/v1/sim/rapyd/payments/payment_d31d3ca850419ab5e2f9f1a33f9c6eea"
      );
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
      expect(transaction.getStatus()).toBe("APPROVED");
    });

    it("maps a network failure during the query", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ETIMEDOUT"));

      await expect(
        new RapydAdapter().getStatus("payment_xyz")
      ).rejects.toBeInstanceOf(KitPagosError);
    });
  });

  describe("verifySignature()", () => {
    it("should delegate to WebhookVerifier with the access key and webhook URL from its credentials", () => {
      const verify = jest.fn().mockReturnValue(true);
      const adapter = new RapydAdapter(
        undefined,
        {
          publicKey: "rapyd_access_key_test",
          privateKey: "rapyd_secret_key_test",
          webhookUrl: "https://tienda.example.com/webhooks/rapyd",
        },
        { verify } as never,
      );

      const paymentResult = adapter.verifySignature("{}", { salt: "s" }, "secreto");

      expect(paymentResult).toBe(true);
      expect(verify).toHaveBeenCalledWith(
        { payload: "{}", headers: { salt: "s" } },
        {
          secret: "secreto",
          publicKey: "rapyd_access_key_test",
          webhookUrl: "https://tienda.example.com/webhooks/rapyd",
        },
        Gateway.RAPYD,
      );
    });
  });
});

/**
 * PSE en Rapyd, que es la prueba de fuego de la decision del puerto: son **dos
 * llamadas** escondidas detras de un `createPayment()`, y lo que estas pruebas
 * cuidan es que la secuencia ocurra en orden y que el resultado no delate que hubo
 * dos.
 *
 * La forma de las respuestas es la medida contra el sandbox real el 18 de
 * septiembre de 2026, incluido `next_action: "pending_confirmation"`, que **no** es
 * el `"3d_verification"` del flujo de tarjeta.
 */
describe("RapydAdapter with PSE", () => {
  const originalFetch = global.fetch;

  const pseRequest: CreatePaymentRequest = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-rapyd-pse-1"),
    payer: new Payer({
      email: "cliente@example.com",
      fullName: "Jaime Pavlich Mariscal",
      phone: "3001234567",
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: "co_pse_bancolombia_bank" }),
    returnUrlConfig: new ReturnUrlConfig("https://comercio.example.com/retorno"),
  };

  const customerResponse = {
    ok: true,
    status: 200,
    json: async () => ({
      status: { status: "SUCCESS" },
      data: { id: "cus_01f2f7ddace1fc8aa19ae9c535d7fb57" },
    }),
  };

  const pseCreatedResponse = {
    ok: true,
    status: 201,
    json: async () => ({
      status: { status: "SUCCESS" },
      data: {
        id: "payment_353f1be65d4d9dc8bd2814aa45a8d117",
        status: "ACT",
        paid: false,
        next_action: "pending_confirmation",
        redirect_url:
          "https://sandboxcheckout.rapyd.net/complete-bank-payment?token=payment_353f1be65d4d9dc8bd2814aa45a8d117",
        amount: "150000.00",
        currency_code: "COP",
        merchant_reference_id: "ord-rapyd-pse-1",
      },
    }),
  };

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("creates the customer before the payment, in that order", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(customerResponse)
      .mockResolvedValueOnce(pseCreatedResponse);
    global.fetch = mockFetch;

    await new RapydAdapter("https://api.example.com/v1").createPayment(pseRequest);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/v1/customers");
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.example.com/v1/payments");
  });

  /**
   * Si el pago no llevara el cliente que devolvio la primera llamada, Rapyd lo
   * rechazaria con `MISSING_PAYMENT_METHOD_REQUIRED_FIELD - [CUSTOMER]`. Esta prueba
   * verifica que las dos llamadas estan encadenadas y no solo que ocurrieron.
   */
  it("passes the payment the customer returned by the first call", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(customerResponse)
      .mockResolvedValueOnce(pseCreatedResponse);
    global.fetch = mockFetch;

    await new RapydAdapter("https://api.example.com/v1").createPayment(pseRequest);

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.customer).toBe("cus_01f2f7ddace1fc8aa19ae9c535d7fb57");
    expect(body.payment_method.type).toBe("co_pse_bancolombia_bank");
  });

  it("returns the redirect from the creation response, without polling", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(customerResponse)
      .mockResolvedValueOnce(pseCreatedResponse);
    global.fetch = mockFetch;

    const result = await new RapydAdapter(
      "https://api.example.com/v1",
    ).createPayment(pseRequest);

    const redirect = expectRedirect(result);
    expect(redirect.redirectUrl).toContain("complete-bank-payment");
    expect(redirect.rawStatus).toBe("ACT");
    expect(redirect.gatewayTransactionId.value).toBe(
      "payment_353f1be65d4d9dc8bd2814aa45a8d117",
    );
    // Dos llamadas y ni una mas: Rapyd entrega la URL en la creacion, a diferencia
    // de Wompi, que la hace aparecer despues.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  /**
   * El fallo de la primera llamada no debe intentar la segunda: un pago sin cliente
   * es un rechazo garantizado, y hacerlo igual gastaria una llamada para producir un
   * error peor.
   */
  it("does not attempt the payment if the customer creation fails", async () => {
    const mockFetch = jest.fn().mockResolvedValueOnce(
      jsonErrorResponse(400, {
        status: { error_code: "INVALID_CUSTOMER_NAME", status: "ERROR" },
      }),
    );
    global.fetch = mockFetch;

    await expect(
      new RapydAdapter("https://api.example.com/v1").createPayment(pseRequest),
    ).rejects.toBeInstanceOf(KitPagosError);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("the card path still makes a single call, the checkout one", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        status: { status: "SUCCESS" },
        data: {
          id: "payment_card_1",
          status: "CLO",
          paid: true,
          amount: "150000.00",
          currency_code: "COP",
          merchant_reference_id: "ord-rapyd-pse-1",
        },
      }),
    });
    global.fetch = mockFetch;

    const result = await new RapydAdapter("https://api.example.com/v1").createPayment({
      ...pseRequest,
      paymentMethod: undefined,
    });

    expectTransaction(result);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/v1/checkout");
  });

  describe("getPseBanks()", () => {
    it("filters the PSE methods from the country catalog", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: { status: "SUCCESS" },
          data: [
            { type: "co_pse_bancolombia_bank", name: "Bancolombia" },
            { type: "co_visa_card", name: "Visa" },
          ],
        }),
      });
      global.fetch = mockFetch;

      const banks = await new RapydAdapter(
        "https://api.example.com/v1",
      ).getPseBanks();

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://api.example.com/v1/payment_methods/country?country=CO",
      );
      expect(banks).toEqual([
        { code: "co_pse_bancolombia_bank", name: "Bancolombia", achCode: "1007" },
      ]);
    });

    /**
     * El codigo que devuelve la lista tiene que servir tal cual en
     * `PaymentMethod.pse()`. Si hiciera falta transformarlo, la lista no resolveria
     * el problema que vino a resolver.
     */
    it("returns codes that PaymentMethod.pse accepts without transformation", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: { status: "SUCCESS" },
          data: [{ type: "co_pse_bancolombia_bank", name: "Bancolombia" }],
        }),
      });

      const [firstBank] = await new RapydAdapter("https://api.example.com/v1").getPseBanks();

      expect(() => PaymentMethod.pse({ bankCode: firstBank.code })).not.toThrow();
    });
  });
});
