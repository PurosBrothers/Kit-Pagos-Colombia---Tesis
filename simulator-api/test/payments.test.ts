import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";

describe("POST /v1/api/payments (Issue #102)", () => {
  let app: FastifyInstance;
  const testEnv: Record<string, string | undefined> = {
    ...process.env,
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

  beforeAll(async () => {
    const resolver = new CredentialResolver(testEnv);
    const provider = new KitPagosProvider(resolver, testEnv);

    app = buildApp({
      logger: false,
      credentialResolver: resolver,
      kitPagosProvider: provider,
    });

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    testEnv.SIMULATOR_SDK_BASE_URL = address;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Criterio 1: Cobro con tarjeta responde 201 y discrimina TRANSACTION", () => {
    it("crea un cobro exitoso con tarjeta en Wompi", async () => {
      const payload = {
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        orderReference: `ORDER-WOMPI-${Date.now()}`,
        payer: {
          email: "usuario@example.com",
          fullName: "Carlos Gomez",
        },
        paymentMethod: {
          type: "CARD",
          token: "tok_test_wompi_card_123",
          installments: 1,
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.outcome).toBe("TRANSACTION");
      expect(data.transaction).toBeDefined();
      expect(data.transaction.gatewayTransactionId).toBeDefined();
      expect(data.transaction.orderReference).toBe(payload.orderReference);
      expect(data.transaction.amount).toBe("50000.00");
      expect(data.transaction.currency).toBe("COP");
      expect(data.transaction.payer.email).toBe("usuario@example.com");
      expect(data.rawStatus).toBeDefined();
    });

    it("crea un cobro exitoso con tarjeta en Mercado Pago", async () => {
      const payload = {
        gateway: "MERCADOPAGO",
        amount: "75000.00",
        currency: "COP",
        orderReference: `ORDER-MP-${Date.now()}`,
        payer: {
          email: "comprador@example.com",
          fullName: "Laura Martinez",
        },
        paymentMethod: {
          type: "CARD",
          token: "tok_test_mp_card_456",
          installments: 1,
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.outcome).toBe("TRANSACTION");
      expect(data.transaction.orderReference).toBe(payload.orderReference);
      expect(data.rawStatus).toBeDefined();
    });

    it("crea un cobro exitoso con tarjeta en Kushki", async () => {
      const payload = {
        gateway: "kushki",
        amount: "119000.00",
        currency: "COP",
        orderReference: `ORDER-KUSHKI-${Date.now()}`,
        payer: {
          email: "cliente.kushki@example.com",
          fullName: "Andres Silva",
        },
        paymentMethod: {
          type: "CARD",
          token: "tok_test_kushki_card_789",
          installments: 1,
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.outcome).toBe("TRANSACTION");
      expect(data.transaction.orderReference).toBe(payload.orderReference);
      expect(data.rawStatus).toBeDefined();
    });
  });

  describe("Criterio 2: Cobro con PSE responde 201 con outcome REDIRECT_REQUIRED y redirectUrl", () => {
    it("crea un cobro con PSE en Wompi que requiere redirección bancaria", async () => {
      const payload = {
        gateway: "wompi",
        amount: "65000.00",
        currency: "COP",
        orderReference: `ORDER-PSE-WOMPI-${Date.now()}`,
        payer: {
          email: "pagador.pse@example.com",
          fullName: "Felipe Ruiz",
          documentType: "CC",
          documentNumber: "1020304050",
          phone: "3001234567",
        },
        paymentMethod: {
          type: "PSE",
          bankCode: "1", // Banco que aprueba en sandbox
          payerKind: "NATURAL",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.outcome).toBe("REDIRECT_REQUIRED");
      expect(data.redirect).toBeDefined();
      expect(typeof data.redirect.redirectUrl).toBe("string");
      expect(data.redirect.redirectUrl.length).toBeGreaterThan(0);
      expect(data.redirect.gatewayTransactionId).toBeDefined();
      expect(data.redirect.rawStatus).toBeDefined();
    });

    it("crea un cobro con PSE en Mercado Pago que requiere redirección", async () => {
      const payload = {
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
        paymentMethod: {
          type: "PSE",
          bankCode: "1022",
          payerKind: "NATURAL",
        },
        returnUrlConfig: {
          returnUrl: "https://comercio.example.com/retorno",
        },
        ipAddress: "186.84.90.12",
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.outcome).toBe("REDIRECT_REQUIRED");
      expect(data.redirect.redirectUrl).toBeDefined();
      expect(data.redirect.redirectUrl).toContain("mercadopago");
    });
  });

  describe("Criterio 3: Las cuatro pasarelas funcionan por el mismo endpoint", () => {
    it("procesa pagos por Rapyd a través del mismo endpoint /v1/api/payments", async () => {
      const payload = {
        gateway: "rapyd",
        amount: "45000.00",
        currency: "COP",
        orderReference: `ORDER-RAPYD-${Date.now()}`,
        payer: {
          email: "usuario.rapyd@example.com",
          fullName: "Daniel Ochoa",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.outcome).toBeDefined();
    });
  });

  describe("Criterio 4: Cuerpos incompletos responden 400 con los campos que faltan desde el SDK", () => {
    it("responde 400 cuando falta orderReference", async () => {
      const payload = {
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        payer: {
          email: "usuario@example.com",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(400);
      const errorBody = response.json();
      expect(errorBody.code).toBe("INVALID_REQUEST");
      expect(errorBody.message).toContain("orderReference");
    });

    it("responde 400 cuando falta amount", async () => {
      const payload = {
        gateway: "wompi",
        currency: "COP",
        orderReference: "REF-TEST-SIN-MONTO",
        payer: {
          email: "usuario@example.com",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(400);
      const errorBody = response.json();
      expect(errorBody.code).toBe("INVALID_REQUEST");
      expect(errorBody.message).toContain("amount");
    });

    it("responde 400 cuando falta payer", async () => {
      const payload = {
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        orderReference: "REF-TEST-SIN-PAYER",
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(400);
      const errorBody = response.json();
      expect(errorBody.code).toBe("INVALID_REQUEST");
      expect(errorBody.message).toContain("payer");
    });

    it("responde 400 cuando falta gateway", async () => {
      const payload = {
        amount: "50000.00",
        currency: "COP",
        orderReference: "REF-TEST-SIN-GW",
        payer: {
          email: "usuario@example.com",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(400);
      const errorBody = response.json();
      expect(errorBody.code).toBe("INVALID_REQUEST");
      expect(errorBody.message).toContain("gateway");
    });

    it("responde 400 cuando la pasarela especificada es desconocida", async () => {
      const payload = {
        gateway: "pasarela_fantasma",
        amount: "50000.00",
        currency: "COP",
        orderReference: "REF-GW-DESCONOCIDA",
        payer: {
          email: "usuario@example.com",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(400);
      const errorBody = response.json();
      expect(errorBody.code).toBe("INVALID_REQUEST");
      expect(errorBody.message).toContain("no soportada");
    });

    it("responde 400 cuando payer no contiene email (validación de VO del dominio)", async () => {
      const payload = {
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        orderReference: "REF-PAYER-SIN-EMAIL",
        payer: {
          fullName: "Sin Email",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(400);
      const errorBody = response.json();
      expect(errorBody.code).toBe("INVALID_REQUEST");
      expect(errorBody.message).toContain("email");
    });
  });

  describe("Criterio 5: Conservación exacta de escala decimal en amount", () => {
    it("conserva la escala exacta en decimales (ej. 19.90 y 99.99)", async () => {
      const payload = {
        gateway: "wompi",
        amount: "19.90",
        currency: "COP",
        orderReference: `ORDER-DECIMAL-${Date.now()}`,
        payer: {
          email: "decimales@example.com",
        },
        paymentMethod: {
          type: "CARD",
          token: "tok_test_card",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.transaction.amount).toBe("19.90");
    });

    it("rechaza montos con más decimales de los permitidos por Amount", async () => {
      const payload = {
        gateway: "wompi",
        amount: "19.999", // 3 decimales no válidos para Amount
        currency: "COP",
        orderReference: "REF-DECIMAL-INVALIDO",
        payer: {
          email: "error.decimal@example.com",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(400);
      const errorBody = response.json();
      expect(errorBody.code).toBe("INVALID_REQUEST");
    });
  });

  describe("Criterio 6: Métodos no implementados responden 400 y no cobran en silencio", () => {
    it("responde 400 con UNSUPPORTED_OPERATION si se solicita un método no soportado (ej. CRYPTO)", async () => {
      const payload = {
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        orderReference: `ORDER-UNSUPPORTED-${Date.now()}`,
        payer: {
          email: "crypto@example.com",
        },
        paymentMethod: {
          type: "CRYPTO",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(400);
      const errorBody = response.json();
      expect(errorBody.code).toBe("UNSUPPORTED_OPERATION");
      expect(errorBody.message).toContain("no soporta pagos con CRYPTO");
    });

    it("responde 400 cuando falta el token de tarjeta requerido por Wompi", async () => {
      const payload = {
        gateway: "wompi",
        amount: "50000.00",
        currency: "COP",
        orderReference: `ORDER-SIN-TOKEN-${Date.now()}`,
        payer: {
          email: "sin.token@example.com",
        },
        paymentMethod: {
          type: "CARD",
          // token omitido deliberadamente
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(400);
      const errorBody = response.json();
      expect(errorBody.code).toBe("INVALID_REQUEST");
      expect(errorBody.message).toContain("token de tarjeta");
    });
  });

  describe("Resolución de credenciales y autenticación", () => {
    it("permite enviar credenciales de pasarela mediante cabeceras x-gateway-*", async () => {
      const payload = {
        gateway: "wompi",
        amount: "30000.00",
        currency: "COP",
        orderReference: `ORDER-HEADERS-${Date.now()}`,
        payer: {
          email: "headers@example.com",
        },
        paymentMethod: {
          type: "CARD",
          token: "tok_test_card_custom",
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        headers: {
          "x-gateway-public-key": "pub_custom_client_key",
          "x-gateway-private-key": "prv_custom_client_key",
          "x-gateway-integrity-secret": "custom_secret_client",
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
    });

    it("responde 401 si no hay credenciales ni en cabeceras ni en el servidor", async () => {
      const emptyResolver = new CredentialResolver({});
      const emptyProvider = new KitPagosProvider(emptyResolver, {});
      const unauthApp = buildApp({
        logger: false,
        credentialResolver: emptyResolver,
        kitPagosProvider: emptyProvider,
      });

      const payload = {
        gateway: "wompi",
        amount: "30000.00",
        currency: "COP",
        orderReference: "ORDER-SIN-CREDS",
        payer: {
          email: "sin.creds@example.com",
        },
      };

      const response = await unauthApp.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
      });

      expect(response.statusCode).toBe(401);
      const errorBody = response.json();
      expect(errorBody.error).toBe("Unauthorized");
      expect(errorBody.message).toContain("Missing credentials for gateway 'wompi'");

      await unauthApp.close();
    });
  });
});
