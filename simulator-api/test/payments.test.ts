import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";

/**
 * Sin `...process.env`: un `WOMPI_BASE_URL` en la terminal de quien corre la
 * prueba ganaría sobre `SIMULATOR_SDK_BASE_URL` y la mandaría a una API real.
 */
const SERVER_CREDENTIALS = {
  WOMPI_PUBLIC_KEY: "pub_test_wompi_key_123",
  WOMPI_PRIVATE_KEY: "prv_test_wompi_key_456",
  WOMPI_INTEGRITY_SECRET: "test_integrity_secret_789",
  MERCADOPAGO_PUBLIC_KEY: "TEST-mp-public-key",
  MERCADOPAGO_ACCESS_TOKEN: "APP_USR-test-mp-token",
  RAPYD_API_ACCESS_KEY: "test_rapyd_access_key",
  RAPYD_API_SECRET_KEY: "test_rapyd_secret_key",
  KUSHKI_PUBLIC_MERCHANT_ID: "test_kushki_public_key",
  KUSHKI_PRIVATE_MERCHANT_ID: "test_kushki_private_key",
};

function appWith(env: Record<string, string | undefined>): FastifyInstance {
  const credentialResolver = new CredentialResolver(env);
  return buildApp({
    logger: false,
    credentialResolver,
    kitPagosProvider: new KitPagosProvider(credentialResolver, env),
  });
}

const PSE_PAYER = {
  email: "pagador.pse@example.com",
  fullName: "Felipe Ruiz",
  documentType: "CC",
  documentNumber: "1020304050",
  phone: "3001234567",
};

function kushkiPse(taxBreakdown: unknown) {
  return {
    gateway: "kushki",
    amount: "119000.00",
    currency: "COP",
    orderReference: `ORDER-PSE-KUSHKI-${Date.now()}`,
    payer: PSE_PAYER,
    paymentMethod: { type: "PSE", bankCode: "0001" },
    returnUrlConfig: { returnUrl: "https://comercio.example.com/retorno" },
    taxBreakdown,
  };
}

describe("POST /v1/api/payments (issue #102)", () => {
  let app: FastifyInstance;
  const testEnv: Record<string, string | undefined> = { ...SERVER_CREDENTIALS };

  beforeAll(async () => {
    app = appWith(testEnv);
    // La misma app sirve de simulador: el SDK le cobra por /v1/sim.
    testEnv.SIMULATOR_SDK_BASE_URL = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
  });

  function pay(payload: unknown, headers: Record<string, string> = {}) {
    return app.inject({ method: "POST", url: "/v1/api/payments", payload: payload as object, headers });
  }

  describe("card payments answer 201 with outcome TRANSACTION", () => {
    it("should charge a card in Wompi and return the normalized transaction", async () => {
      const payload = {
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        orderReference: `ORDER-WOMPI-${Date.now()}`,
        payer: { email: "usuario@example.com", fullName: "Carlos Gomez" },
        paymentMethod: { type: "CARD", token: "tok_test_wompi_card_123", installments: 1 },
      };

      const response = await pay(payload);

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.outcome).toBe("TRANSACTION");
      expect(data.transaction.gatewayTransactionId).toBeDefined();
      expect(data.transaction.orderReference).toBe(payload.orderReference);
      expect(data.transaction.amount).toBe("50000.00");
      expect(data.transaction.currency).toBe("COP");
      expect(data.transaction.payer.email).toBe("usuario@example.com");
      expect(data.rawStatus).toBeDefined();
    });

    it.each([
      ["MERCADOPAGO", "75000.00"],
      ["kushki", "119000.00"],
    ])("should charge a card in %s through the same endpoint", async (gateway, amount) => {
      const payload = {
        gateway,
        amount,
        currency: "COP",
        orderReference: `ORDER-${gateway}-${Date.now()}`,
        payer: { email: "comprador@example.com", fullName: "Laura Martinez" },
        paymentMethod: { type: "CARD", token: "tok_test_card_456", installments: 1 },
      };

      const response = await pay(payload);

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data).toMatchObject({
        outcome: "TRANSACTION",
        transaction: { orderReference: payload.orderReference },
      });
      // El monto de la respuesta es el que reporta la pasarela, como número y sin
      // los ceros de la derecha: la escala exacta solo se garantiza de ida (punto 71).
      expect(Number(data.transaction.amount)).toBe(Number(amount));
    });

    it("should default an omitted paymentMethod to card in Rapyd, which requires a redirect", async () => {
      const response = await pay({
        gateway: "rapyd",
        amount: "45000.00",
        currency: "COP",
        orderReference: `ORDER-RAPYD-${Date.now()}`,
        payer: { email: "usuario.rapyd@example.com", fullName: "Daniel Ochoa" },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        outcome: "REDIRECT_REQUIRED",
        redirect: { redirectUrl: expect.stringMatching(/^https?:\/\//) },
      });
    });
  });

  describe("PSE payments answer 201 with outcome REDIRECT_REQUIRED", () => {
    it("should return the bank redirect for a Wompi PSE payment", async () => {
      const response = await pay({
        gateway: "wompi",
        amount: "65000.00",
        currency: "COP",
        orderReference: `ORDER-PSE-WOMPI-${Date.now()}`,
        payer: PSE_PAYER,
        paymentMethod: { type: "PSE", bankCode: "1", payerKind: "NATURAL" },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.outcome).toBe("REDIRECT_REQUIRED");
      expect(data.redirect.redirectUrl).toMatch(/^https?:\/\//);
      expect(data.redirect.gatewayTransactionId).toBeDefined();
      expect(data.redirect.rawStatus).toBeDefined();
    });

    it("should return the bank redirect for a Mercado Pago PSE payment", async () => {
      const response = await pay({
        gateway: "mercadopago",
        amount: "50000.00",
        currency: "COP",
        orderReference: `ORDER-PSE-MP-${Date.now()}`,
        payer: {
          email: "pagador.mp@example.com",
          firstName: "Juan",
          lastName: "Perez",
          documentType: "CC",
          documentNumber: "1098765432",
          phone: "3109876543",
          phoneAreaCode: "57",
          address: {
            streetName: "Carrera 7",
            streetNumber: "71-21",
            city: "Bogota",
            zipCode: "110221",
            neighborhood: "Chapinero",
          },
        },
        paymentMethod: { type: "PSE", bankCode: "1022", payerKind: "NATURAL" },
        returnUrlConfig: { returnUrl: "https://comercio.example.com/retorno" },
        ipAddress: "186.84.90.12",
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().outcome).toBe("REDIRECT_REQUIRED");
      expect(response.json().redirect.redirectUrl).toContain("mercadopago");
    });

    it("should accept a Kushki PSE payment with the tax breakdown given as a rate", async () => {
      const response = await pay(kushkiPse({ rate: "0.19" }));

      expect(response.statusCode).toBe(201);
      expect(response.json().outcome).toBe("REDIRECT_REQUIRED");
    });
  });

  describe("incomplete bodies answer 400 naming what is missing", () => {
    it.each(["orderReference", "amount", "payer"])(
      "should answer 400 when %s is missing, with the message coming from the SDK",
      async (field) => {
        const payload: Record<string, unknown> = {
          gateway: "wompi",
          amount: "50000.00",
          currency: "COP",
          orderReference: "REF-TEST-INCOMPLETO",
          payer: { email: "usuario@example.com" },
        };
        delete payload[field];

        const response = await pay(payload);

        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe("INVALID_REQUEST");
        expect(response.json().message).toContain(field);
      },
    );

    it.each([
      ["missing", undefined],
      ["unknown", "pasarela_fantasma"],
    ])("should answer 400 listing the supported gateways when the gateway is %s", async (_, gateway) => {
      const response = await pay({
        gateway,
        amount: "50000.00",
        currency: "COP",
        orderReference: "REF-GW",
        payer: { email: "usuario@example.com" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: "INVALID_REQUEST",
        message: "Unsupported gateway. Supported gateways: wompi, rapyd, mercadopago, kushki.",
      });
    });

    it("should answer 400 when the payer has no email, as the domain value object requires", async () => {
      const response = await pay({
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        orderReference: "REF-PAYER-SIN-EMAIL",
        payer: { fullName: "Sin Email" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");
      expect(response.json().message).toContain("email");
    });
  });

  describe("amount keeps its exact decimal scale", () => {
    it("should return the amount with the same scale it was sent with", async () => {
      const response = await pay({
        gateway: "wompi",
        amount: "19.90",
        currency: "COP",
        orderReference: `ORDER-DECIMAL-${Date.now()}`,
        payer: { email: "decimales@example.com" },
        paymentMethod: { type: "CARD", token: "tok_test_card" },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().transaction.amount).toBe("19.90");
    });

    it("should reject an amount with more decimals than Amount allows", async () => {
      const response = await pay({
        gateway: "wompi",
        amount: "19.999",
        currency: "COP",
        orderReference: "REF-DECIMAL-INVALIDO",
        payer: { email: "error.decimal@example.com" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");
    });
  });

  describe("unsupported methods answer 400 and never charge silently", () => {
    it("should answer UNSUPPORTED_OPERATION for a method the SDK does not implement", async () => {
      const response = await pay({
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        orderReference: `ORDER-UNSUPPORTED-${Date.now()}`,
        payer: { email: "crypto@example.com" },
        paymentMethod: { type: "CRYPTO" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("UNSUPPORTED_OPERATION");
      expect(response.json().message).toContain("no soporta pagos con CRYPTO");
    });

    it("should answer 400 when Wompi is asked for a card without its token", async () => {
      const response = await pay({
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        orderReference: `ORDER-SIN-TOKEN-${Date.now()}`,
        payer: { email: "sin.token@example.com" },
        paymentMethod: { type: "CARD" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");
      expect(response.json().message).toContain("token de tarjeta");
    });
  });

  /**
   * Un campo que viene pero no se puede interpretar no se descarta: descartado,
   * el cobro sale con el valor por omisión y no con lo que se pidió (punto 71).
   */
  describe("fields that arrive but cannot be interpreted answer 400", () => {
    const withPaymentMethod = (paymentMethod: unknown) => ({
      gateway: "wompi",
      amount: "50000.00",
      currency: "COP",
      orderReference: `ORDER-PM-${Date.now()}`,
      payer: PSE_PAYER,
      paymentMethod,
    });

    it.each([
      ["has no type", {}, "paymentMethod.type es obligatorio"],
      ["is not an object", "PSE", "paymentMethod debe ser un objeto"],
      ["has installments as text", { type: "CARD", token: "tok", installments: "3" }, "installments"],
      ["has an unknown payerKind", { type: "PSE", bankCode: "1", payerKind: "JURIDICA" }, "payerKind"],
    ])("should answer INVALID_REQUEST when paymentMethod %s", async (_, paymentMethod, message) => {
      const response = await pay(withPaymentMethod(paymentMethod));

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");
      expect(response.json().message).toContain(message);
    });

    it.each([
      ["is missing components", { subtotalIva: "100000.00" }],
      ["has a numeric rate", { rate: 0.19 }],
      ["is not an object", "0.19"],
    ])("should answer 400 instead of charging Kushki as tax exempt when taxBreakdown %s", async (_, taxBreakdown) => {
      const response = await pay(kushkiPse(taxBreakdown));

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");
      expect(response.json().message).toContain("taxBreakdown requiere");
    });
  });

  describe("credentials", () => {
    it("should charge with the client's x-gateway-* credentials when the server has none", async () => {
      const clientOnly = appWith({ SIMULATOR_SDK_BASE_URL: testEnv.SIMULATOR_SDK_BASE_URL });

      const response = await clientOnly.inject({
        method: "POST",
        url: "/v1/api/payments",
        headers: {
          "x-gateway-public-key": "pub_custom_client_key",
          "x-gateway-private-key": "prv_custom_client_key",
          "x-gateway-integrity-secret": "custom_secret_client",
        },
        payload: {
          gateway: "wompi",
          amount: "30000.00",
          currency: "COP",
          orderReference: `ORDER-HEADERS-${Date.now()}`,
          payer: { email: "headers@example.com" },
          paymentMethod: { type: "CARD", token: "tok_test_card_custom" },
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().outcome).toBe("TRANSACTION");
      await clientOnly.close();
    });

    it("should answer 401 when neither the headers nor the server have credentials", async () => {
      const unauthApp = appWith({});

      const response = await unauthApp.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload: {
          gateway: "wompi",
          amount: "30000.00",
          currency: "COP",
          orderReference: "ORDER-SIN-CREDS",
          payer: { email: "sin.creds@example.com" },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe("Unauthorized");
      expect(response.json().message).toContain("Missing credentials for gateway 'wompi'");
      await unauthApp.close();
    });

    /** La regla del punto 69 aplicada a esta ruta: `gatewayClientFor()` la cablea. */
    describe("when the gateway points at a real API", () => {
      const cardAgainst = (baseUrl: string) =>
        appWith({ ...SERVER_CREDENTIALS, WOMPI_BASE_URL: baseUrl });
      const payload = {
        gateway: "wompi",
        amount: "30000.00",
        currency: "COP",
        orderReference: "ORDER-REAL-API",
        payer: { email: "real@example.com" },
        paymentMethod: { type: "CARD", token: "tok_test_card" },
      };
      let fetchSpy: jest.SpyInstance;

      beforeEach(() => {
        fetchSpy = jest
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(new Response(JSON.stringify({ error: "stubbed" }), { status: 401 }));
      });

      afterEach(() => {
        fetchSpy.mockRestore();
      });

      it("should refuse the server credentials against production without calling the gateway", async () => {
        const production = cardAgainst("https://production.wompi.co/v1");

        const response = await production.inject({ method: "POST", url: "/v1/api/payments", payload });

        expect(response.statusCode).toBe(401);
        expect(response.json().message).toContain("la trata como producción");
        expect(fetchSpy).not.toHaveBeenCalled();
        await production.close();
      });

      it("should warn in the header and the body when it falls back to the server credentials in a sandbox", async () => {
        const sandbox = cardAgainst("https://sandbox.wompi.co/v1");

        const response = await sandbox.inject({ method: "POST", url: "/v1/api/payments", payload });

        expect(fetchSpy).toHaveBeenCalled();
        expect(response.headers["x-kit-pagos-warning"]).toBeDefined();
        expect(response.json().warnings).toEqual([
          expect.objectContaining({ code: "SERVER_SANDBOX_CREDENTIALS_USED" }),
        ]);
        await sandbox.close();
      });
    });
  });
});
