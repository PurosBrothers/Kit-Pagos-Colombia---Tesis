import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";
import { ScenarioEngine } from "../src/scenarios/ScenarioEngine";
import { resetSimulatorState } from "../src/store/GatewayStores";

describe("POST /v1/sim/wompi/transactions", () => {
  const validRequestBody = {
    amount_in_cents: 5000000,
    currency: "COP",
    reference: "orden-123",
    customer_email: "cliente@example.com",
    payment_method: { type: "CARD", token: "tok_test_fake" },
  };

  it("creates the PENDING charge, reflecting amount_in_cents and reference (no scenario header)", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();
    // PENDING y no APPROVED: medido contra sandbox.wompi.co, el cobro con tarjeta nace
    // pendiente y se resuelve unos 600 ms después. El mock devolvía APPROVED de una y le
    // escondía al comercio que tiene que consultar el estado.
    expect(body.data.status).toBe("PENDING");
    expect(typeof body.data.id).toBe("string");
    expect(body.data.id.length).toBeGreaterThan(0);
    expect(body.data.amount_in_cents).toBe(validRequestBody.amount_in_cents);
    expect(body.data.reference).toBe(validRequestBody.reference);
    // El SDK reconstruye su objeto de valor Payer desde este campo, así que el
    // mock debe devolverlo tal como lo hace la API real de Wompi.
    expect(body.data.customer_email).toBe(validRequestBody.customer_email);

    await app.close();
  });

  it("answers correctly when the APPROVED scenario is sent explicitly", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulate-scenario": "APPROVED" },
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.status).toBe("PENDING");

    await app.close();
  });

  it("rejects the charge without a payment method, with the 422 that Wompi answers", async () => {
    // Medido: `POST /transactions` sin `payment_method` responde
    // `422 "No se especificó método de pago o fuente de pago"`. El mock lo aceptaba, y por
    // eso el SDK pudo no mandar nunca el token de tarjeta con la suite en verde.
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: { ...validRequestBody, payment_method: undefined },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.reason).toContain("método de pago");

    await app.close();
  });

  it("creates a DECLINED charge when the scenario is DECLINED", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "DECLINED" },
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.status).toBe("DECLINED");
    expect(body.data.reference).toBe(validRequestBody.reference);

    await app.close();
  });

  it("creates a VOIDED charge when the scenario is EXPIRED", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "EXPIRED" },
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.status).toBe("VOIDED");

    await app.close();
  });

  it("answers 504 Gateway Timeout when the scenario is TIMEOUT", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "TIMEOUT" },
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(504);
    expect(response.json().error.type).toBe("GATEWAY_TIMEOUT");

    await app.close();
  });

  it("simulates NETWORK_ERROR by answering with a connection error", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "NETWORK_ERROR" },
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(500);

    await app.close();
  });

  it("answers 429 Too Many Requests when the scenario is RATE_LIMIT", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "RATE_LIMIT" },
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.type).toBe("RATE_LIMIT");

    await app.close();
  });

  it("answers 500 when the scenario is SERVER_ERROR", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "SERVER_ERROR" },
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.type).toBe("SERVER_ERROR");

    await app.close();
  });

  it("answers with flapping (503 on the first attempt, success on the second)", async () => {
    const app = buildApp();
    const flapBody = { ...validRequestBody, reference: "wompi-flap-test" };

    // Intento 1 -> 503
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "FLAPPING" },
      payload: flapBody,
    });
    expect(res1.statusCode).toBe(503);

    // Intento 2 -> 503
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "FLAPPING" },
      payload: flapBody,
    });
    expect(res2.statusCode).toBe(503);

    // Intento 3 -> 201 Aprobado (recuperado)
    const res3 = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "FLAPPING" },
      payload: flapBody,
    });
    expect(res3.statusCode).toBe(201);
    expect(res3.json().data.status).toBe("PENDING");

    await app.close();
  });

  it("detects duplicate payments when the scenario is DUPLICATE_PAYMENT", async () => {
    const app = buildApp();
    const dupBody = { ...validRequestBody, reference: "wompi-dup-1" };

    const res1 = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "DUPLICATE_PAYMENT" },
      payload: dupBody,
    });
    expect(res1.statusCode).toBe(201);

    const res2 = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulator-scenario": "DUPLICATE_PAYMENT" },
      payload: dupBody,
    });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().error.type).toBe("DUPLICATE_TRANSACTION");

    await app.close();
  });

  it("answers with an explicit error for an unsupported scenario, without returning a false APPROVED", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulate-scenario": "ESCENARIO_DESCONOCIDO_99" },
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(501);
    expect(response.json().error).toMatch(/escenario aún no soportado/i);

    await app.close();
  });

  it("does not disguise an unexpected engine failure as an unsupported scenario", async () => {
    // Solo UnsupportedScenarioError se traduce a 501. Cualquier otro fallo debe
    // propagarse para que Fastify responda 500, porque un error de programación
    // no es lo mismo que un escenario que todavía no existe.
    const executeSpy = jest
      .spyOn(ScenarioEngine.prototype, "execute")
      .mockImplementation(() => {
        throw new Error("fallo inesperado del motor");
      });

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).not.toMatch(/escenario aún no soportado/i);

    executeSpy.mockRestore();
    await app.close();
  });
});

describe("GET /v1/sim/wompi/transactions/:id", () => {
  const validRequestBody = {
    amount_in_cents: 5000000,
    currency: "COP",
    reference: "orden-123",
    customer_email: "cliente@example.com",
    payment_method: { type: "CARD", token: "tok_test_fake" },
  };

  beforeEach(() => {
    resetSimulatorState();
  });

  afterEach(() => {
    resetSimulatorState();
  });

  it("returns 200 with { data: transaction } when the transaction was created beforehand", async () => {
    const app = buildApp();

    // 1. Crear la transacción vía POST para que se guarde en TransactionStore
    const postResponse = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: validRequestBody,
    });
    expect(postResponse.statusCode).toBe(201);
    const createdId = postResponse.json().data.id;

    // 2. Consultar por el ID generado vía GET
    const getResponse = await app.inject({
      method: "GET",
      url: `/v1/sim/wompi/transactions/${createdId}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const body = getResponse.json();
    expect(body.data).toBeDefined();
    expect(body.data.id).toBe(createdId);
    expect(body.data.status).toBe("APPROVED");
    expect(body.data.amount_in_cents).toBe(validRequestBody.amount_in_cents);
    expect(body.data.reference).toBe(validRequestBody.reference);
    expect(body.data.customer_email).toBe(validRequestBody.customer_email);

    await app.close();
  });

  it("returns 404 with Wompi's native error shape when the id does not exist", async () => {
    const app = buildApp();
    const nonExistentId = "non-existent-wompi-id-999";

    const response = await app.inject({
      method: "GET",
      url: `/v1/sim/wompi/transactions/${nonExistentId}`,
    });

    // Medido contra el sandbox el 5 de octubre de 2026.
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { type: "NOT_FOUND_ERROR", reason: "La entidad solicitada no existe" },
    });

    await app.close();
  });
});

describe("POST /v1/sim/wompi/tokens/cards", () => {
  const validCardBody = {
    number: "4242424242424242",
    cvc: "123",
    exp_month: "12",
    exp_year: "30",
    card_holder: "JUAN PEREZ",
  };

  it("creates a card token successfully with code 201 and Wompi's native format", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: {
        authorization: "Bearer pub_test_1234567890",
      },
      payload: validCardBody,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("CREATED");
    expect(body.data).toBeDefined();
    expect(body.data.id).toMatch(/^tok_sim_[a-f0-9]{16}$/);
    expect(body.data.brand).toBe("VISA");
    expect(body.data.last_four).toBe("4242");
    expect(body.data.bin).toBe("424242");
    expect(body.data.exp_month).toBe("12");
    expect(body.data.exp_year).toBe("30");
    expect(body.data.card_holder).toBe("JUAN PEREZ");
    expect(body.data.created_with_cvc).toBe(true);
    expect(body.data.validity_ends_at).toBeNull();

    await app.close();
  });

  it("rejects the request with 401 if the Authorization header is missing", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      payload: validCardBody,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.type).toBe("UNAUTHORIZED");
    expect(body.error.code).toBe("ACCESS_TOKEN_HEADER_NOT_PRESENT");
    expect(body.error.reason).toBe("Header de autorización 'Authorization' no enviado.");

    await app.close();
  });

  it("rejects the request with 401 if the Authorization header has no valid key", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: {
        authorization: "Bearer ",
      },
      payload: validCardBody,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.type).toBe("UNAUTHORIZED");
    expect(body.error.code).toBe("ACCESS_TOKEN_HEADER_NOT_PRESENT");
    expect(body.error.reason).toBe("Header de autorización 'Authorization' no enviado.");

    await app.close();
  });

  it("rejects the request with 422 if required fields are missing", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: {
        authorization: "Bearer pub_test_12345",
      },
      payload: {
        number: "4242424242424242",
        // cvc faltante
        exp_month: "12",
        exp_year: "30",
        card_holder: "JUAN PEREZ",
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.type).toBe("INPUT_VALIDATION_ERROR");
    expect(body.error.messages).toBeDefined();
    expect(body.error.messages.cvc).toEqual(["debe tener la propiedad requerida cvc."]);

    await app.close();
  });

  it("rejects the request with 422 if the cvc arrives empty (regex pattern)", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: {
        authorization: "Bearer pub_test_12345",
      },
      payload: {
        ...validCardBody,
        cvc: "",
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.type).toBe("INPUT_VALIDATION_ERROR");
    expect(body.error.messages.cvc).toEqual(['debe coincidir con el patron "^\\d{3,4}$"']);

    await app.close();
  });

  it("rejects the request with 422 if the card number is not valid", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: {
        authorization: "Bearer pub_test_12345",
      },
      payload: {
        ...validCardBody,
        number: "123", // Muy corto
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.type).toBe("INPUT_VALIDATION_ERROR");
    expect(body.error.messages).toBeDefined();
    expect(body.error.messages.number).toBeDefined();

    await app.close();
  });

  it("rejects the request with 404 MERCHANT_NOT_FOUND for a nonexistent public key (measured 2026-10-03)", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: {
        authorization: "Bearer pub_test_inexistente",
      },
      payload: validCardBody,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.type).toBe("NOT_FOUND");
    expect(body.error.code).toBe("MERCHANT_NOT_FOUND");

    await app.close();
  });

  it("supports technical scenarios such as SERVER_ERROR or TIMEOUT", async () => {
    const app = buildApp();

    const serverErrRes = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: {
        authorization: "Bearer pub_test_12345",
        "x-simulate-scenario": "SERVER_ERROR",
      },
      payload: validCardBody,
    });
    expect(serverErrRes.statusCode).toBe(500);

    const timeoutRes = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: {
        authorization: "Bearer pub_test_12345",
        "x-simulate-scenario": "TIMEOUT",
      },
      payload: validCardBody,
    });
    expect(timeoutRes.statusCode).toBe(504);

    await app.close();
  });

  it("completes a Wompi card charge end to end: token mock and POST /v1/api/payments", async () => {
    const testEnv: Record<string, string | undefined> = {
      WOMPI_PUBLIC_KEY: "pub_test_wompi_key_123",
      WOMPI_PRIVATE_KEY: "prv_test_wompi_key_456",
      WOMPI_INTEGRITY_SECRET: "test_integrity_secret_789",
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
        url: "/v1/sim/wompi/tokens/cards",
        headers: { authorization: "Bearer pub_test_wompi_key_123" },
        payload: validCardBody,
      });

      expect(tokenRes.statusCode).toBe(201);
      const tokenData = tokenRes.json().data;
      expect(tokenData.id).toMatch(/^tok_sim_/);

      // 2. Cobrar con ese token a través de POST /v1/api/payments
      const paymentRes = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload: {
          gateway: "wompi",
          amount: "50000.00",
          currency: "COP",
          orderReference: `ORDER-WOMPI-E2E-${Date.now()}`,
          payer: { email: "usuario@example.com", fullName: "Carlos Gomez" },
          paymentMethod: { type: "CARD", token: tokenData.id, installments: 1 },
        },
      });

      expect(paymentRes.statusCode).toBe(201);
      const paymentData = paymentRes.json();
      expect(paymentData.outcome).toBe("TRANSACTION");
      expect(paymentData.transaction.gatewayTransactionId).toBeDefined();
      expect(paymentData.transaction.amount).toBe("50000.00");
      expect(paymentData.transaction.currency).toBe("COP");
    } finally {
      await app.close();
    }
  });
});
