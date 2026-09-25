import { buildApp } from "../src/app";
import { ScenarioEngine } from "../src/scenarios/ScenarioEngine";
import { transactionStore } from "../src/store/TransactionStore";

describe("POST /v1/sim/wompi/transactions", () => {
  const validRequestBody = {
    amount_in_cents: 5000000,
    currency: "COP",
    reference: "orden-123",
    customer_email: "cliente@example.com",
    payment_method: { type: "CARD", token: "tok_test_fake" },
  };

  it("crea el cobro PENDIENTE, reflejando amount_in_cents y reference (sin header de escenario)", async () => {
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

  it("responde correctamente cuando el escenario APPROVED se envía explícitamente", async () => {
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

  it("rechaza el cobro sin método de pago, con el 422 que responde Wompi", async () => {
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

  it("crea un cobro DECLINED cuando el escenario es DECLINED", async () => {
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

  it("crea un cobro VOIDED cuando el escenario es EXPIRED", async () => {
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

  it("responde 504 Gateway Timeout cuando el escenario es TIMEOUT", async () => {
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

  it("simula NETWORK_ERROR respondiendo con error de conexión", async () => {
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

  it("responde 429 Too Many Requests cuando el escenario es RATE_LIMIT", async () => {
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

  it("responde 500 cuando el escenario es SERVER_ERROR", async () => {
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

  it("responde con flapping (503 en primer intento, éxito en el segundo)", async () => {
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

  it("detecta pagos duplicados cuando el escenario es DUPLICATE_PAYMENT", async () => {
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

  it("responde con error explícito ante un escenario no soportado, sin devolver un APPROVED falso", async () => {
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

  it("no disfraza un fallo inesperado del motor como un escenario no soportado", async () => {
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
    transactionStore.clear();
  });

  afterEach(() => {
    transactionStore.clear();
  });

  it("devuelve 200 con { data: transaction } cuando la transacción fue creada previamente", async () => {
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

  it("devuelve 404 con la forma nativa de error de Wompi cuando el id no existe", async () => {
    const app = buildApp();
    const nonExistentId = "non-existent-wompi-id-999";

    const response = await app.inject({
      method: "GET",
      url: `/v1/sim/wompi/transactions/${nonExistentId}`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe("NOT_FOUND");
    expect(body.error.reason).toContain(nonExistentId);

    await app.close();
  });
});