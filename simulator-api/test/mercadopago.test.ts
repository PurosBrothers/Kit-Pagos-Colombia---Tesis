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
    it("crea un pago APROBADO reflejando transaction_amount, description y payer (sin header de escenario)", async () => {
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

    it("crea un pago APROBADO cuando el header x-simulate-scenario es APPROVED explícito", async () => {
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

    it("crea un pago RECHAZADO cuando el header x-simulate-scenario es REJECTED", async () => {
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

    it("rechaza un cobro sin token, con el mensaje de la API real", async () => {
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

    it("rechaza un cobro sin cuotas, aunque sean una", async () => {
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
    it("rechaza un cobro sin llave de idempotencia", async () => {
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
    it("revisa la llave de idempotencia antes que el token", async () => {
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

    it("crea un pago EXPIRED cuando el header es EXPIRED", async () => {
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

    it("responde 504 Gateway Timeout cuando el escenario es TIMEOUT", async () => {
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

    it("simula NETWORK_ERROR respondiendo con error 500", async () => {
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

    it("responde 429 Too Many Requests cuando el escenario es RATE_LIMIT", async () => {
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

    it("responde 500 cuando el escenario es SERVER_ERROR", async () => {
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

    it("responde con flapping (503 en intentos iniciales, éxito en el siguiente)", async () => {
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

    it("detecta pagos duplicados cuando el escenario es DUPLICATE_PAYMENT", async () => {
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

    it("responde 501 ante un escenario no soportado", async () => {
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
    it("consulta un pago creado y devuelve el mismo id, estado y monto", async () => {
      const app = buildApp();

      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { "x-idempotency-key": "consulta-aprobado" },
        payload: validRequestBody,
      });

      const { id } = creado.json();

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

    it("devuelve rejected para un pago creado como rechazado", async () => {
      const app = buildApp();

      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "consulta-rechazado",
          "x-simulate-scenario": "REJECTED",
        },
        payload: validRequestBody,
      });

      const { id } = creado.json();

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

    it("no cambia el estado aunque la consulta pida lo contrario", async () => {
      // Criterio 1 del issue: el desenlace lo fija la creación. Una cabecera en la consulta
      // podría reportar como cobrado un pago que el comercio pidió declinado, y el mismo
      // cobro sería aprobado y declinado según quién preguntara.
      const app = buildApp();

      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "consulta-inmutable",
          "x-simulate-scenario": "REJECTED",
        },
        payload: validRequestBody,
      });

      const { id } = creado.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/payments/${id}`,
        headers: { "x-simulate-scenario": "APPROVED" },
      });

      expect(response.json().status).toBe("rejected");

      await app.close();
    });

    it("responde 404 si el pago no existe, sin importar la cabecera", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/mercadopago/payments/no-existe",
        headers: { "x-simulate-scenario": "NOT_FOUND" },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("not_found");

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

    it("responde 401 si no se envía llave pública en query", async () => {
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

    it("responde 400 unexpected_processing si se envía llave en Authorization: Bearer en vez de la query", async () => {
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

    it("responde 500 internal_error si la clave pública es inexistente", async () => {
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

    it("emite 201 incluso sin identificación, con número corto o sin security_code (medido contra API real)", async () => {
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
    ])("luhn_validation de %s es %s: aplica Luhn, no la longitud (medido contra API real)", async (cardNumber, expected) => {
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

    it("responde 201 y emite un token de tarjeta con public_key en query param", async () => {
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

    it("responde según escenarios del motor de simulación (TIMEOUT, RATE_LIMIT, SERVER_ERROR)", async () => {
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

    it("completa un cobro con tarjeta de Mercado Pago de punta a punta: mock de tokens y POST /v1/api/payments", async () => {
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
