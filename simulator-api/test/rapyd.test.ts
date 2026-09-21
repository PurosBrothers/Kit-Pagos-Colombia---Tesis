import { buildApp } from "../src/app";

describe("mock de Rapyd", () => {
  /**
   * El monto va como string con dos decimales a proposito: es lo que la propia
   * documentacion de firma de Rapyd recomienda para no perder los ceros a la
   * derecha, y es lo que envia el RapydAdapter del SDK.
   */
  const validRequestBody = {
    amount: "150000.00",
    currency: "COP",
    merchant_reference_id: "orden-123",
    receipt_email: "cliente@example.com",
  };

  describe("POST /v1/sim/rapyd/payments", () => {
    it("responde aprobado con el sobre { status, data } que Rapyd usa siempre", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      // `status` describe el resultado de la llamada de API, no el del pago.
      expect(body.status.status).toBe("SUCCESS");
      expect(body.status.error_code).toBe("");
      expect(typeof body.status.operation_id).toBe("string");

      // El estado del pago vive en `data.status`.
      expect(body.data.status).toBe("CLO");
      expect(body.data.paid).toBe(true);

      await app.close();
    });

    it("identifica el pago con el prefijo payment_ que usa Rapyd", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: validRequestBody,
      });

      expect(response.json().data.id).toMatch(/^payment_[0-9a-f]{32}$/);

      await app.close();
    });

    it("refleja el monto en pesos, sin convertirlo a centavos", async () => {
      // Es la prueba que fija la diferencia con Wompi: si el adaptador o el mock
      // multiplicaran por 100, el monto de vuelta seria 15000000.
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: validRequestBody,
      });

      expect(response.json().data.amount).toBe("150000.00");

      await app.close();
    });

    it("devuelve la divisa como currency_code, no como currency", async () => {
      // La peticion la envia en `currency` y la respuesta la devuelve en
      // `currency_code`. Son nombres distintos en el contrato real de Rapyd, y
      // es un error facil de cometer al normalizar.
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: validRequestBody,
      });

      const body = response.json();
      expect(body.data.currency_code).toBe("COP");
      expect(body.data.currency).toBeUndefined();

      await app.close();
    });

    it("refleja la referencia del comercio y el correo del recibo", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: validRequestBody,
      });

      const body = response.json();
      expect(body.data.merchant_reference_id).toBe("orden-123");
      expect(body.data.receipt_email).toBe("cliente@example.com");

      await app.close();
    });

    it("acepta el escenario APPROVED enviado de forma explicita", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulate-scenario": "APPROVED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.status).toBe("CLO");

      await app.close();
    });

    it("responde 501 ante un escenario que todavia no sabe producir", async () => {
      // 501 y no 400: el escenario es legitimo, falta implementarlo (issue #65).
      // Lo importante es que no devuelva un aprobado falso.
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulate-scenario": "DECLINED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(501);
      expect(response.json().error).toContain("Escenario aun no soportado");

      await app.close();
    });
  });

  describe("GET /v1/sim/rapyd/payments/:paymentId", () => {
    it("devuelve el pago consultado con el mismo identificador y el sobre de Rapyd", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/rapyd/payments/payment_abc123",
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.status.status).toBe("SUCCESS");
      expect(body.data.id).toBe("payment_abc123");
      expect(body.data.status).toBe("CLO");

      await app.close();
    });
  });
});
