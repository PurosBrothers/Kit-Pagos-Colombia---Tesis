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

  it("responde APROBADO reflejando amount_in_cents y reference (sin header de escenario)", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: validRequestBody,
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.data.status).toBe("APPROVED");
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
    expect(response.json().data.status).toBe("APPROVED");

    await app.close();
  });

  it("responde con error explícito ante un escenario no soportado, sin devolver un APPROVED falso", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { "x-simulate-scenario": "DECLINED" },
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