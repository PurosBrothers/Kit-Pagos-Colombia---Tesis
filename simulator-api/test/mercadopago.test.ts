import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";

describe("Mercado Pago Simulation Routes", () => {
  const validRequestBody = {
    transaction_amount: 50000,
    description: "orden-mp-123",
    // El token y las cuotas son obligatorios en un cobro con tarjeta de Mercado Pago, y
    // el mock ahora los exige igual que la API real.
    token: "a1b2c3d4e5f6",
    installments: 1,
    payer: {
      email: "cliente.mp@example.com",
      first_name: "Juan",
      last_name: "Pérez",
    },
  };

  describe("POST /v1/sim/mercadopago/payments", () => {
    it("creates an APPROVED payment reflecting transaction_amount, description and payer (no scenario header)", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { "x-idempotency-key": "prueba-idempotencia" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.status).toBe("approved");
      expect(body.status_detail).toBe("accredited");
      expect(body.id).toBeDefined();
      expect(body.transaction_amount).toBe(50000);
      expect(body.currency_id).toBe("COP");
      expect(body.description).toBe("orden-mp-123");
      expect(body.external_reference).toBe("orden-mp-123");
      expect(body.payer.email).toBe("cliente.mp@example.com");
      expect(body.date_approved).toBeDefined();

      await app.close();
    });

    it("creates an APPROVED payment when the x-simulate-scenario header is an explicit APPROVED", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulate-scenario": "APPROVED",
        },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status).toBe("approved");

      await app.close();
    });

    it("creates a REJECTED payment when the x-simulate-scenario header is REJECTED", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulate-scenario": "REJECTED",
        },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status).toBe("rejected");
      expect(body.status_detail).toBe("cc_rejected_other_reason");
      expect(body.date_approved).toBeNull();

      await app.close();
    });

    it("rejects a charge without a token, with the real API's message", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { "x-idempotency-key": "prueba-idempotencia" },
        payload: { ...validRequestBody, token: undefined },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe(
        "payment_method_id attribute can't be null",
      );

      await app.close();
    });

    it("rejects a charge without installments, even if it is one", async () => {
      // Mercado Pago es la única de las cuatro que exige las cuotas siempre. Es la razón
      // de que `installments` viva en el dominio del SDK y no en un solo adaptador.
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { "x-idempotency-key": "prueba-idempotencia" },
        payload: { ...validRequestBody, installments: undefined },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe("Invalid installments");

      await app.close();
    });

    /**
     * El defecto que encontraron las pruebas contra sandbox del SDK: Mercado Pago no crea
     * nada sin llave de idempotencia, y el SDK no la mandaba. Duró invisible porque este
     * mock la aceptaba ausente y porque las mediciones a mano la mandaban sin pensarlo.
     */
    it("rejects a charge without an idempotency key", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain("X-Idempotency-Key");

      await app.close();
    });

    /**
     * La llave se revisa antes que el cuerpo, como en la API real: un cobro sin llave y sin
     * token se queja de la llave, no del token.
     */
    it("checks the idempotency key before the token", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        payload: { ...validRequestBody, token: undefined },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain("X-Idempotency-Key");

      await app.close();
    });

    it("creates an EXPIRED payment when the header is EXPIRED", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "EXPIRED",
        },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status).toBe("cancelled");
      expect(body.status_detail).toBe("expired");

      await app.close();
    });

    it("answers 504 Gateway Timeout when the scenario is TIMEOUT", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "TIMEOUT",
        },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(504);
      expect(response.json().error).toBe("gateway_timeout");

      await app.close();
    });

    it("simulates NETWORK_ERROR by answering with a 500 error", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "NETWORK_ERROR",
        },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(500);

      await app.close();
    });

    it("answers 429 Too Many Requests when the scenario is RATE_LIMIT", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "RATE_LIMIT",
        },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(429);
      expect(response.json().error).toBe("rate_limit_exceeded");

      await app.close();
    });

    it("answers 500 when the scenario is SERVER_ERROR", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "SERVER_ERROR",
        },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe("server_error");

      await app.close();
    });

    it("answers with flapping (503 on the first attempts, success on the next one)", async () => {
      const app = buildApp();
      const flapBody = { ...validRequestBody, external_reference: "mp-flap-1" };

      const res1 = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "FLAPPING",
        },
        payload: flapBody,
      });
      expect(res1.statusCode).toBe(503);

      const res2 = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "FLAPPING",
        },
        payload: flapBody,
      });
      expect(res2.statusCode).toBe(503);

      const res3 = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "FLAPPING",
        },
        payload: flapBody,
      });
      expect(res3.statusCode).toBe(201);
      expect(res3.json().status).toBe("approved");

      await app.close();
    });

    it("detects duplicate payments when the scenario is DUPLICATE_PAYMENT", async () => {
      const app = buildApp();
      const dupBody = { ...validRequestBody, external_reference: "mp-dup-1" };

      const res1 = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "DUPLICATE_PAYMENT",
        },
        payload: dupBody,
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulator-scenario": "DUPLICATE_PAYMENT",
        },
        payload: dupBody,
      });
      expect(res2.statusCode).toBe(409);
      expect(res2.json().error).toBe("conflict");

      await app.close();
    });

    it("answers 501 for an unsupported scenario", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulate-scenario": "ESCENARIO_INVALIDO_MP",
        },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(501);
      expect(response.json().error).toContain("Escenario aún no soportado");

      await app.close();
    });
  });

  /*
   * Las tres pruebas crean el pago antes de consultarlo. Antes estas rutas fabricaban la
   * respuesta con `transaction_amount: 50000` y una descripción inventada, y el estado
   * salía de la cabecera de la consulta: el mismo identificador devolvía `approved` y
   * `rejected` según quién preguntara, y un pago que nunca existió respondía `200`. Eso
   * era el defecto que reporta el issue #124, y las pruebas lo cubrían como si fuera el
   * comportamiento correcto.
   */
  describe("GET /v1/sim/mercadopago/payments/:id", () => {
    it("queries a created payment and returns the same id, status and amount", async () => {
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { "x-idempotency-key": "consulta-aprobado" },
        payload: validRequestBody,
      });

      const { id } = created.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/payments/${id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.id).toBe(id);
      expect(body.status).toBe("approved");
      expect(body.status_detail).toBe("accredited");
      expect(body.currency_id).toBe("COP");
      // El monto y la descripción son los que mandó el comercio, no constantes de la ruta.
      expect(body.transaction_amount).toBe(50000);
      expect(body.description).toBe("orden-mp-123");

      await app.close();
    });

    it("returns rejected for a payment created as rejected", async () => {
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "consulta-rechazado",
          "x-simulate-scenario": "REJECTED",
        },
        payload: validRequestBody,
      });

      const { id } = created.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/payments/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(id);
      expect(body.status).toBe("rejected");

      await app.close();
    });

    it("does not change the status even if the query asks for the opposite", async () => {
      // Criterio 1 del issue: el desenlace lo fija la creación. Una cabecera en la consulta
      // podría reportar como cobrado un pago que el comercio pidió declinado, y el mismo
      // cobro sería aprobado y declinado según quién preguntara.
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "consulta-inmutable",
          "x-simulate-scenario": "REJECTED",
        },
        payload: validRequestBody,
      });

      const { id } = created.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/payments/${id}`,
        headers: { "x-simulate-scenario": "APPROVED" },
      });

      expect(response.json().status).toBe("rejected");

      await app.close();
    });

    it("answers 404 if the payment does not exist, regardless of the header", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/mercadopago/payments/99999999999",
        headers: { "x-simulate-scenario": "NOT_FOUND" },
      });

      // Medido contra la API real el 5 de octubre de 2026.
      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body).toMatchObject({ message: "Payment not found", error: "not_found", status: 404 });
      expect(body.cause).toHaveLength(1);
      expect(body.cause[0]).toMatchObject({ code: 2000, description: "Payment not found" });
      expect(body.cause[0].data).toMatch(/^[^;]+;[0-9a-f-]{36}$/);

      await app.close();
    });
  });

  describe("POST /v1/sim/mercadopago/card_tokens (issue #127)", () => {
    const validCardPayload = {
      card_number: "4013540682746260",
      expiration_month: 11,
      expiration_year: 2030,
      security_code: "123",
      cardholder: {
        name: "APRO",
        identification: { type: "CC", number: "19119119100" },
      },
    };

    it("answers 401 if no public key is sent in the query", async () => {
      const app = buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens",
        payload: validCardPayload,
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error).toBe("unauthorized");
      expect(body.code).toBe("unauthorized_access");
      expect(body.cause[0].code).toBe("E212");
      await app.close();
    });

    it("answers 400 unexpected_processing if the key is sent in Authorization: Bearer instead of the query", async () => {
      const app = buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens",
        headers: { authorization: "Bearer TEST-pub-key" },
        payload: validCardPayload,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("bad_request");
      expect(body.cause[0].code).toBe("G001");
      await app.close();
    });

    it("answers 500 internal_error if the public key does not exist", async () => {
      const app = buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-inexistente",
        payload: validCardPayload,
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe("internal_server_error");
      expect(body.cause[0].code).toBe("E731");
      await app.close();
    });

    it("issues 201 even without identification, with a short number or without security_code (measured against the real API)", async () => {
      const app = buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
        payload: {
          card_number: "1234",
          expiration_month: 11,
          expiration_year: 2030,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toMatch(/^tok_sim_mp_/);
      expect(body.cardholder.identification).toEqual({});
      expect(body.luhn_validation).toBe(false);
      await app.close();
    });

    it.each([
      ["4013540682746260", true],
      ["4013540682746261", false],
    ])("luhn_validation of %s is %s: it applies Luhn, not the length (measured against the real API)", async (cardNumber, expected) => {
      const app = buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
        payload: { ...validCardPayload, card_number: cardNumber },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().luhn_validation).toBe(expected);
      await app.close();
    });

    // Comparar el conjunto entero de claves detecta tanto un campo que falte como uno
    // inventado. Es el conjunto medido contra api.mercadopago.com el 4 de octubre de 2026
    // a las 17:49 (−05:00) con 4013540682746260.
    it("should return exactly the keys measured against the real API", async () => {
      const app = buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
        payload: validCardPayload,
      });

      expect(response.statusCode).toBe(201);
      expect(Object.keys(response.json()).sort()).toEqual(
        [
          "card_number_length",
          "cardholder",
          "date_created",
          "date_due",
          "date_last_updated",
          "expiration_month",
          "expiration_year",
          "first_six_digits",
          "id",
          "last_four_digits",
          "live_mode",
          "luhn_validation",
          "public_key",
          "require_esc",
          "security_code_length",
          "status",
          "trunc_card_number",
        ].sort(),
      );
      await app.close();
    });

    // 4013540682746260 se midió a las 17:49 y 5254133674403564 hacia las 17:40, los dos
    // el 4 de octubre de 2026. Dos números distintos impiden que pase un valor fijo.
    it.each([
      ["4013540682746260", "401354XXXXXX6260"],
      ["5254133674403564", "525413XXXXXX3564"],
    ])("should derive public_key, card_number_length and trunc_card_number from the request for %s", async (cardNumber, truncated) => {
      const publicKey = "TEST-otra-llave-publica";
      const app = buildApp();
      const response = await app.inject({
        method: "POST",
        url: `/v1/sim/mercadopago/card_tokens?public_key=${encodeURIComponent(publicKey)}`,
        payload: { ...validCardPayload, card_number: cardNumber },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.public_key).toBe(publicKey);
      expect(body.card_number_length).toBe(16);
      expect(body.trunc_card_number).toBe(truncated);
      expect(body.live_mode).toBe(true);
      expect(body.require_esc).toBe(false);
      await app.close();
    });

    it("should set date_due eight days after date_created, as the real API does", async () => {
      const app = buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
        payload: validCardPayload,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      const elapsed = Date.parse(body.date_due) - Date.parse(body.date_created);
      expect(elapsed).toBe(8 * 24 * 60 * 60 * 1000);
      await app.close();
    });

    it("answers 201 and issues a card token with public_key in the query param", async () => {
      const app = buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
        payload: validCardPayload,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toMatch(/^tok_sim_mp_/);
      expect(body.status).toBe("active");
      expect(body.first_six_digits).toBe("401354");
      expect(body.last_four_digits).toBe("6260");
      expect(body.expiration_month).toBe(11);
      expect(body.expiration_year).toBe(2030);
      expect(body.cardholder.name).toBe("APRO");
      expect(body.cardholder.identification.number).toBe("19119119100");
      await app.close();
    });

    it("answers according to the simulation engine scenarios (TIMEOUT, RATE_LIMIT, SERVER_ERROR)", async () => {
      const app = buildApp();

      const timeoutRes = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
        headers: { "x-simulate-scenario": "TIMEOUT" },
        payload: validCardPayload,
      });
      expect(timeoutRes.statusCode).toBe(504);

      const rateLimitRes = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
        headers: { "x-simulate-scenario": "RATE_LIMIT" },
        payload: validCardPayload,
      });
      expect(rateLimitRes.statusCode).toBe(429);

      const serverErrorRes = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
        headers: { "x-simulate-scenario": "SERVER_ERROR" },
        payload: validCardPayload,
      });
      expect(serverErrorRes.statusCode).toBe(500);

      await app.close();
    });

    it("completes a Mercado Pago card charge end to end: token mock and POST /v1/api/payments", async () => {
      const testEnv: Record<string, string | undefined> = {
        MERCADOPAGO_PUBLIC_KEY: "TEST-mp-public-key",
        MERCADOPAGO_ACCESS_TOKEN: "APP_USR-test-mp-token",
      };
      const credentialResolver = new CredentialResolver(testEnv);
      const app = buildApp({
        logger: false,
        credentialResolver,
        kitPagosProvider: new KitPagosProvider(credentialResolver, testEnv),
      });
      testEnv.SIMULATOR_SDK_BASE_URL = await app.listen({ port: 0, host: "127.0.0.1" });

      try {
        // 1. Obtener token de tarjeta en el mock del simulador
        const tokenRes = await app.inject({
          method: "POST",
          url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-mp-public-key",
          payload: validCardPayload,
        });

        expect(tokenRes.statusCode).toBe(201);
        const tokenData = tokenRes.json();
        expect(tokenData.id).toMatch(/^tok_sim_mp_/);

        // 2. Cobrar con ese token a través de POST /v1/api/payments
        const paymentRes = await app.inject({
          method: "POST",
          url: "/v1/api/payments",
          payload: {
            gateway: "MERCADOPAGO",
            amount: "75000.00",
            currency: "COP",
            orderReference: `ORDER-MP-E2E-${Date.now()}`,
            payer: { email: "comprador@example.com", fullName: "Laura Martinez" },
            paymentMethod: { type: "CARD", token: tokenData.id, installments: 1 },
          },
        });

        expect(paymentRes.statusCode).toBe(201);
        const paymentData = paymentRes.json();
        expect(paymentData.outcome).toBe("TRANSACTION");
        expect(paymentData.transaction.gatewayTransactionId).toBeDefined();
        expect(paymentData.transaction.amount).toBe("75000.00");
        expect(paymentData.transaction.currency).toBe("COP");
      } finally {
        await app.close();
      }
    });
  });
});
