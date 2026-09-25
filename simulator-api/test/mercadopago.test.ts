import { buildApp } from "../src/app";

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
