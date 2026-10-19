import { buildSignedApp as buildApp } from "./helpers/signedRequests";

describe("Rapyd mock", () => {
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
    it("answers approved with the { status, data } envelope that Rapyd always uses", async () => {
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

    it("identifies the payment with the payment_ prefix that Rapyd uses", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: validRequestBody,
      });

      expect(response.json().data.id).toMatch(/^payment_[0-9a-f]{32}$/);

      await app.close();
    });

    it("reflects the amount in pesos, without converting it to cents", async () => {
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

    it("returns the currency as currency_code, not as currency", async () => {
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

    it("reflects the merchant reference and the receipt email", async () => {
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

    it("accepts the APPROVED scenario sent explicitly", async () => {
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

    it("answers DECLINED with status ERR and paid false when the scenario is DECLINED", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "DECLINED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status.status).toBe("ERROR");
      expect(body.data.status).toBe("ERR");
      expect(body.data.paid).toBe(false);
      expect(body.data.failure_code).toContain("51");

      await app.close();
    });

    it("answers EXPIRED with status EXP and paid false when the scenario is EXPIRED", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "EXPIRED" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.status).toBe("EXP");
      expect(body.data.paid).toBe(false);

      await app.close();
    });

    it("answers 504 Gateway Timeout when the scenario is TIMEOUT", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "TIMEOUT" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(504);
      expect(response.json().status.error_code).toBe("GATEWAY_TIMEOUT");

      await app.close();
    });

    it("simulates NETWORK_ERROR by answering with a 500 error", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
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
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "RATE_LIMIT" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(429);
      expect(response.json().status.error_code).toBe("TOO_MANY_REQUESTS");

      await app.close();
    });

    it("answers 500 when the scenario is SERVER_ERROR", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "SERVER_ERROR" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().status.error_code).toBe("SERVER_ERROR");

      await app.close();
    });

    it("answers with flapping (503 on the first attempts, success on the next one)", async () => {
      const app = buildApp();
      const flapBody = { ...validRequestBody, merchant_reference_id: "rapyd-flap-1" };

      const res1 = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "FLAPPING" },
        payload: flapBody,
      });
      expect(res1.statusCode).toBe(503);

      const res2 = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "FLAPPING" },
        payload: flapBody,
      });
      expect(res2.statusCode).toBe(503);

      const res3 = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "FLAPPING" },
        payload: flapBody,
      });
      expect(res3.statusCode).toBe(201);
      expect(res3.json().data.status).toBe("CLO");

      await app.close();
    });

    it("detects duplicate payments when the scenario is DUPLICATE_PAYMENT", async () => {
      const app = buildApp();
      const dupBody = { ...validRequestBody, merchant_reference_id: "rapyd-dup-1" };

      const res1 = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "DUPLICATE_PAYMENT" },
        payload: dupBody,
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulator-scenario": "DUPLICATE_PAYMENT" },
        payload: dupBody,
      });
      expect(res2.statusCode).toBe(409);
      expect(res2.json().status.error_code).toBe("DUPLICATE_MERCHANT_REFERENCE_ID");

      await app.close();
    });

    it("answers 501 for a scenario it cannot produce yet", async () => {
      // 501 y no 400: el escenario es legitimo, falta implementarlo (issue #65).
      // Lo importante es que no devuelva un aprobado falso.
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: { "x-simulate-scenario": "ESCENARIO_INVALIDO_RAPYD" },
        payload: validRequestBody,
      });

      expect(response.statusCode).toBe(501);
      expect(response.json().error).toContain("Escenario aun no soportado");

      await app.close();
    });
  });

  /*
   * El pago se crea antes de consultarse. Antes `buildStatusResponse` devolvía `CLO`,
   * `paid: true`, `amount: "0"` y la referencia vacía para cualquier identificador: un pago
   * inexistente pasaba por cobrado, y uno declinado se reportaba aprobado porque el método
   * no miraba el estado guardado.
   */
  describe("GET /v1/sim/rapyd/payments/:paymentId", () => {
    it("returns the created payment with its real identifier, envelope and amount", async () => {
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: {
          amount: "50000",
          currency: "COP",
          payment_method: { type: "co_visa_card" },
          merchant_reference_id: "orden-rapyd-456",
        },
      });

      const { data } = created.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${data.id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.status.status).toBe("SUCCESS");
      expect(body.data.id).toBe(data.id);
      expect(body.data.status).toBe("CLO");
      expect(body.data.paid).toBe(true);
      // El monto y la referencia son los que se mandaron, no `"0"` y cadena vacía.
      expect(body.data.amount).toBe("50000");
      expect(body.data.merchant_reference_id).toBe("orden-rapyd-456");

      await app.close();
    });

    it("returns 400 ERROR_GET_PAYMENT with Rapyd's envelope if the payment does not exist", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/rapyd/payments/payment_inexistente",
      });

      // 400 y no 404: es el código que midió el sandbox ante un identificador que no es
      // de un pago, y el que documenta Rapyd para un pago que no existe.
      expect(response.statusCode).toBe(400);
      expect(response.json().status.error_code).toBe("ERROR_GET_PAYMENT");

      await app.close();
    });
  });
});
