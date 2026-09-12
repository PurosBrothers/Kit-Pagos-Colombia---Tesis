import { buildApp } from "../src/app";

describe("Mercado Pago Simulation Routes", () => {
  const validRequestBody = {
    transaction_amount: 50000,
    description: "orden-mp-123",
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
        headers: { "x-simulate-scenario": "APPROVED" },
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
        headers: { "x-simulate-scenario": "REJECTED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status).toBe("rejected");
      expect(body.status_detail).toBe("cc_rejected_other_reason");
      expect(body.date_approved).toBeNull();

      await app.close();
    });

    it("responde 501 ante un escenario no soportado", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { "x-simulate-scenario": "TIMEOUT_NO_SOPORTADO" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(501);
      expect(response.json().error).toContain("Escenario aún no soportado");

      await app.close();
    });
  });

  describe("GET /v1/sim/mercadopago/payments/:id", () => {
    it("consulta un pago existente y responde 200 reflejando el id en la URL", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/mercadopago/payments/9876543210",
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.id).toBe("9876543210");
      expect(body.status).toBe("approved");
      expect(body.status_detail).toBe("accredited");
      expect(body.currency_id).toBe("COP");

      await app.close();
    });

    it("responde 200 con estado rejected cuando el header es REJECTED", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/mercadopago/payments/9876543210",
        headers: { "x-simulate-scenario": "REJECTED" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe("9876543210");
      expect(body.status).toBe("rejected");

      await app.close();
    });

    it("responde 404 cuando el escenario solicitado es NOT_FOUND", async () => {
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
});
