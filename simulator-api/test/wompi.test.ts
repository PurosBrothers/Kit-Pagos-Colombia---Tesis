import { buildApp } from "../src/app";

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
});