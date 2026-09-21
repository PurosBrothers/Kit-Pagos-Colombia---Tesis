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

  describe("POST /v1/sim/kushki/card/v1/charges", () => {
    it("crea un cargo aprobado con el estado nativo APPROVAL y el monto desglosado", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.ticketNumber).toMatch(/^[0-9a-f]{18}$/);
      expect(body.details.transactionStatus).toBe("APPROVAL");
      expect(body.details.subtotalIva0).toBe(50000);
      expect(body.details.currencyCode).toBe("COP");
      expect(body.details.approvedTransactionAmount).toBe(50000);
      expect(typeof body.transactionReference).toBe("string");

      await app.close();
    });

    it("acepta APPROVED explícito y lo traduce al valor nativo APPROVAL", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulate-scenario": "APPROVED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().details.transactionStatus).toBe("APPROVAL");

      await app.close();
    });

    it("devuelve DECLINED en el cuerpo, con el mismo HTTP que una aprobación", async () => {
      // Kushki comunica el rechazo de negocio en el estado dentro del cuerpo, no con un
      // código HTTP distinto. Este caso protege ese detalle del contrato: un adaptador que
      // decidiera mirando `response.ok` reportaría este rechazo como aprobado.
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulate-scenario": "DECLINED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().details.transactionStatus).toBe("DECLINED");

      await app.close();
    });

    it("devuelve INITIALIZED para un cargo pendiente", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulate-scenario": "PENDING" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().details.transactionStatus).toBe("INITIALIZED");

      await app.close();
    });

    it("rechaza un cobro sin token con el mismo 400 K001 de la API real", async () => {
      // Medido: `POST /card/v1/charges` sin token, o con el literal "simulated-token" que
      // el SDK mandaba, responde `400 K001`. El mock lo exige para que ningún cambio
      // futuro pueda dejar de mandar el token del comercio y seguir en verde (punto 50).
      const app = buildApp();

      const sinToken = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        payload: { ...validRequestBody, token: undefined },
      });

      expect(sinToken.statusCode).toBe(400);
      expect(sinToken.json().code).toBe("K001");

      const tokenSimulado = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        payload: { ...validRequestBody, token: "simulated-token" },
      });

      expect(tokenSimulado.statusCode).toBe(400);
      expect(tokenSimulado.json().code).toBe("K001");

      await app.close();
    });

    it("devuelve EXPIRED para un cargo expirado", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulator-scenario": "EXPIRED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.details.transactionStatus).toBe("DECLINED");
      expect(body.details.responseText).toBe("Transacción expirada");

      await app.close();
    });

    it("responde 504 Gateway Timeout cuando el escenario es TIMEOUT", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulator-scenario": "TIMEOUT" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(504);
      expect(response.json().code).toBe("K504");

      await app.close();
    });

    it("simula NETWORK_ERROR respondiendo con error 500", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
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
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulator-scenario": "RATE_LIMIT" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(429);
      expect(response.json().code).toBe("K429");

      await app.close();
    });

    it("responde 500 cuando el escenario es SERVER_ERROR", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulator-scenario": "SERVER_ERROR" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().code).toBe("K500");

      await app.close();
    });

    it("responde con flapping (503 en intentos iniciales, éxito en el siguiente)", async () => {
      const app = buildApp();
      const flapBody = { ...validRequestBody, token: "tok_kushki_flap_1" };

      const res1 = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulator-scenario": "FLAPPING" },
        payload: flapBody,
      });
      expect(res1.statusCode).toBe(503);

      const res2 = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulator-scenario": "FLAPPING" },
        payload: flapBody,
      });
      expect(res2.statusCode).toBe(503);

      const res3 = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulator-scenario": "FLAPPING" },
        payload: flapBody,
      });
      expect(res3.statusCode).toBe(201);
      expect(res3.json().details.transactionStatus).toBe("APPROVAL");

      await app.close();
    });

    it("detecta pagos duplicados cuando el escenario es DUPLICATE_PAYMENT", async () => {
      const app = buildApp();
      const dupBody = { ...validRequestBody, token: "tok_kushki_dup_1" };

      const res1 = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulator-scenario": "DUPLICATE_PAYMENT" },
        payload: dupBody,
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulator-scenario": "DUPLICATE_PAYMENT" },
        payload: dupBody,
      });
      expect(res2.statusCode).toBe(409);
      expect(res2.json().code).toBe("K409");

      await app.close();
    });

    it("responde 501 para escenarios aún no implementados", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulate-scenario": "ESCENARIO_DESCONOCIDO_KUSHKI" },
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
      expect(body.details.transactionStatus).toBe("APPROVAL");
      expect(body.details.subtotalIva0).toBe(50000);
      expect(body.details.currencyCode).toBe("COP");

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
      expect(response.json().details.transactionStatus).toBe("DECLINED");

      await app.close();
    });
  });
});
