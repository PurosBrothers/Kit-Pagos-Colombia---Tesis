import { buildApp } from "../src/app";

describe("mock de Kushki", () => {
  const validRequestBody = {
    token: "tok_kushki_test",
    amount: {
      subtotalIva0: 50000,
      subtotalIva: 0,
      iva: 0,
      ice: 0,
      currency: "COP",
    },
    contactDetails: {
      email: "cliente@example.com",
    },
  };

  describe("POST /v1/sim/kushki/charges", () => {
    it("crea un cargo aprobado con el estado nativo APPROVAL y el monto desglosado", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/charges",
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ticketNumber).toMatch(/^[0-9a-f]{18}$/);
      expect(body.transaction_status).toBe("APPROVAL");
      expect(body.amount).toEqual(validRequestBody.amount);
      expect(typeof body.transactionReference).toBe("string");

      await app.close();
    });

    it("acepta APPROVED explícito y lo traduce al valor nativo APPROVAL", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/charges",
        headers: { "x-simulate-scenario": "APPROVED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().transaction_status).toBe("APPROVAL");

      await app.close();
    });

    it("devuelve DECLINED en el cuerpo, manteniendo HTTP 200", async () => {
      // Kushki comunica el rechazo de negocio mediante transaction_status, no
      // con un código HTTP 4xx. Este caso protege ese detalle del contrato.
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/charges",
        headers: { "x-simulate-scenario": "DECLINED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().transaction_status).toBe("DECLINED");

      await app.close();
    });

    it("devuelve INITIALIZED para un cargo pendiente", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/charges",
        headers: { "x-simulate-scenario": "PENDING" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().transaction_status).toBe("INITIALIZED");

      await app.close();
    });

    it("responde 501 para escenarios aún no implementados", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/charges",
        headers: { "x-simulate-scenario": "TIMEOUT" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(501);
      expect(response.json().error).toContain("Escenario aún no soportado");

      await app.close();
    });
  });

  describe("GET /v1/sim/kushki/charges/:ticketNumber", () => {
    it("consulta un cargo aprobado conservando el ticketNumber solicitado", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/charges/kushki-ticket-123",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ticketNumber).toBe("kushki-ticket-123");
      expect(body.transaction_status).toBe("APPROVAL");
      expect(body.amount).toEqual({
        subtotalIva0: 50000,
        subtotalIva: 0,
        iva: 0,
        ice: 0,
        currency: "COP",
      });

      await app.close();
    });

    it("consulta un cargo rechazado sin convertirlo en error HTTP", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/charges/kushki-declined-123",
        headers: { "x-simulate-scenario": "REJECTED" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().transaction_status).toBe("DECLINED");

      await app.close();
    });
  });
});
