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

    it("responde 501 ante un escenario no soportado", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: {
          "x-idempotency-key": "prueba-idempotencia",
          "x-simulate-scenario": "TIMEOUT_NO_SOPORTADO",
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
