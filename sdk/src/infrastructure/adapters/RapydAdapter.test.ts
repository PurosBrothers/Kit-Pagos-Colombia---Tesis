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

  describe("formato del monto", () => {
    it("envia el monto en pesos y no en centavos", async () => {
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

    it("envia el monto como string, no como numero JSON", async () => {
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

    it("conserva los ceros a la derecha que se perderian con un number", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment({
        ...validRequest,
        amount: new Amount("19.90"),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.amount).toBe("19.90");
    });

    it("completa la escala de la divisa cuando el monto viene sin decimales", async () => {
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

  describe("firma de la peticion", () => {
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

    it("firma la creacion con la formula oficial de Rapyd", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).createPayment(validRequest);

      const [, init] = mockFetch.mock.calls[0];
      const headers = init.headers;

      expect(headers.signature).toBe(
        referenceSignature(
          "post",
          "/v1/sim/rapyd/payments",
          headers.salt,
          headers.timestamp,
          init.body
        )
      );
    });

    it("firma el cuerpo exacto que envia, sin volver a serializarlo", async () => {
      // Si el adaptador serializara el payload una vez para firmar y otra para
      // enviar, cualquier diferencia entre ambas cadenas produciria una firma
      // que no corresponde al cuerpo. Esta prueba fija que se firma el mismo
      // string que viaja.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).createPayment(validRequest);

      const [, init] = mockFetch.mock.calls[0];
      const firmaDelCuerpoEnviado = referenceSignature(
        "post",
        "/v1/sim/rapyd/payments",
        init.headers.salt,
        init.headers.timestamp,
        init.body
      );

      expect(init.headers.signature).toBe(firmaDelCuerpoEnviado);
    });

    it("firma la consulta de estado con metodo get y cuerpo vacio", async () => {
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

    it("no reutiliza el salt entre peticiones", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      const adapter = new RapydAdapter(undefined, credentials);
      await adapter.createPayment(validRequest);
      await adapter.createPayment(validRequest);

      const primerSalt = mockFetch.mock.calls[0][1].headers.salt;
      const segundoSalt = mockFetch.mock.calls[1][1].headers.salt;
      expect(primerSalt).not.toBe(segundoSalt);
    });

    it("envia los cuatro headers de autenticacion que Rapyd exige", async () => {
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

    it("nunca transmite la llave secreta en un header", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).createPayment(validRequest);

      const [, init] = mockFetch.mock.calls[0];
      const serializado = JSON.stringify(init.headers) + init.body;
      expect(serializado).not.toContain(credentials.privateKey);
    });

    it("timestamp en segundos y no en milisegundos", async () => {
      // Rapyd rechaza timestamps que se desvien mas de 60 segundos del reloj
      // real. Enviarlo en milisegundos lo situaria decadas en el futuro.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(undefined, credentials).createPayment(validRequest);

      const timestamp = Number(mockFetch.mock.calls[0][1].headers.timestamp);
      const ahoraEnSegundos = Math.floor(Date.now() / 1000);
      expect(Math.abs(ahoraEnSegundos - timestamp)).toBeLessThanOrEqual(5);
    });

    it("omite los headers de firma cuando no hay credenciales", async () => {
      // El mock de la API de Simulacion no verifica la firma, y el adaptador
      // debe seguir siendo instanciable sin configuracion, igual que el de Wompi.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment(validRequest);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers).toEqual({ "Content-Type": "application/json" });
    });

    it("firma el path real cuando la base apunta al sandbox de Rapyd", async () => {
      // Contra el sandbox el path firmado es /v1/payments, no el del simulador.
      // Se deriva de la URL en vez de estar escrito a mano.
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter(
        "https://sandboxapi.rapyd.net/v1/payments",
        credentials
      ).createPayment(validRequest);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://sandboxapi.rapyd.net/v1/payments");
      expect(init.headers.signature).toBe(
        referenceSignature(
          "post",
          "/v1/payments",
          init.headers.salt,
          init.headers.timestamp,
          init.body
        )
      );
    });
  });

  describe("createPayment()", () => {
    it("mapea el dominio a los campos nativos de Rapyd", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment(validRequest);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:3000/v1/sim/rapyd/payments");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({
        amount: "150000.00",
        currency: "COP",
        merchant_reference_id: "ord-12345",
        receipt_email: "cliente@example.com",
      });
    });

    it("devuelve una Transaction aprobada normalizada", async () => {
      global.fetch = mockOk();

      const transaction = await new RapydAdapter().createPayment(validRequest);

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

    it("mapea las URLs de retorno a los campos de Rapyd cuando se configuran", async () => {
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

    it("no incluye campos de redireccion cuando no se configuran", async () => {
      const mockFetch = mockOk();
      global.fetch = mockFetch;

      await new RapydAdapter().createPayment(validRequest);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty("complete_payment_url");
      expect(body).not.toHaveProperty("error_payment_url");
    });

    it("traduce un fallo de red a KitPagosError via ErrorHandler", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        new RapydAdapter().createPayment(validRequest)
      ).rejects.toBeInstanceOf(KitPagosError);
    });

    it("traduce un error HTTP a KitPagosError via ErrorHandler", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          status: { error_code: "UNAUTHENTICATED_API_CALL", status: "ERROR" },
        }),
      });

      await expect(
        new RapydAdapter().createPayment(validRequest)
      ).rejects.toBeInstanceOf(KitPagosError);
    });

    it("traduce un error HTTP con cuerpo no JSON leyendolo como texto", async () => {
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

    it("mapea solo la URL de exito cuando es la unica configurada", async () => {
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

    it("usa la URL unica para ambos campos cuando se configura sin diferenciar", async () => {
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

    it("traduce un cuerpo no parseable a KitPagosError", async () => {
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

  describe("getStatus()", () => {
    it("consulta el pago por su identificador y normaliza la respuesta", async () => {
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

    it("traduce un fallo de red durante la consulta", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ETIMEDOUT"));

      await expect(
        new RapydAdapter().getStatus("payment_xyz")
      ).rejects.toBeInstanceOf(KitPagosError);
    });
  });

  describe("verifySignature()", () => {
    it("delega en WebhookVerifier con Gateway.RAPYD", () => {
      const verify = jest.fn().mockReturnValue(true);
      const adapter = new RapydAdapter(undefined, undefined, undefined, {
        verify,
      } as never);

      const resultado = adapter.verifySignature("{}", { salt: "s" }, "secreto");

      expect(resultado).toBe(true);
      expect(verify).toHaveBeenCalledWith(
        "{}",
        { salt: "s" },
        "secreto",
        Gateway.RAPYD
      );
    });
  });
});
