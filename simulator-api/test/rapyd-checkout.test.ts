import { buildApp } from "../src/app";

/**
 * Página de pago alojada de Rapyd: el camino de tarjeta.
 *
 * Existe como ruta aparte de `/payments` porque así es en Rapyd, y porque el cobro directo
 * de una tarjeta no es viable: con un método guardado responde
 * `ERROR_CARD_NOT_AUTHENTICATED`, y la variante que cobra exige el número de la tarjeta en
 * la petición. Ver el punto 50 del architecture-log.
 */
describe("Rapyd payment page", () => {
  const validCheckoutBody = {
    amount: "150000.00",
    currency: "COP",
    country: "CO",
    merchant_reference_id: "orden-tarjeta-1",
    payment_method_type_categories: ["card"],
    receipt_email: "cliente@example.com",
  };

  /** La URL de redirección es absoluta; `inject` necesita solo la ruta. */
  function paymentRoute(redirectUrl: string): string {
    return new URL(redirectUrl).pathname;
  }

  async function createCheckout(app: ReturnType<typeof buildApp>) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/rapyd/checkout",
      payload: validCheckoutBody,
    });

    return { statusCode: response.statusCode, data: response.json().data };
  }

  describe("POST /v1/sim/rapyd/checkout", () => {
    it("creates the page with the checkout_ prefix and a redirect URL", async () => {
      const app = buildApp();

      const { statusCode, data } = await createCheckout(app);

      // 200, el código que se midió para esta ruta. `POST /v1/payments` responde 201:
      // es la misma API y no usa el mismo código para crear.
      expect(statusCode).toBe(200);
      expect(data.id).toMatch(/^checkout_[0-9a-f]{32}$/);
      expect(typeof data.redirect_url).toBe("string");
      expect(data.redirect_url.length).toBeGreaterThan(0);

      await app.close();
    });

    it("builds the redirect URL from the creating request's host", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/checkout",
        headers: { host: "simulator.example.com:8443" },
        payload: validCheckoutBody,
      });
      const { id, redirect_url } = response.json().data;

      expect(redirect_url).toBe(
        `http://simulator.example.com:8443/v1/sim/rapyd/checkout/${id}/pagar`,
      );

      await app.close();
    });

    it("builds the redirect URL on SIMULATOR_PUBLIC_ORIGIN when it is configured", async () => {
      const app = buildApp({ publicOrigin: "https://kit-pagos-colombia.onrender.com" });

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/checkout",
        headers: { host: "10.0.0.7:10000" },
        payload: validCheckoutBody,
      });
      const { id, redirect_url } = response.json().data;

      expect(redirect_url).toBe(`https://kit-pagos-colombia.onrender.com/v1/sim/rapyd/checkout/${id}/pagar`);

      await app.close();
    });

    /**
     * Que el pago venga vacío no es una simplificación del mock: es lo que devuelve Rapyd,
     * porque en ese momento nadie pagó todavía. Un adaptador que leyera `payment.id` al
     * crear se quedaría sin identificador, y por eso el SDK usa el del checkout.
     */
    it("is born NEW with the payment as null, because nobody has paid yet", async () => {
      const app = buildApp();

      const { data } = await createCheckout(app);

      expect(data.status).toBe("NEW");
      expect(data.payment.id).toBeNull();
      expect(data.payment.status).toBeNull();

      await app.close();
    });

    it("reflects the amount and the currency as they arrived", async () => {
      const app = buildApp();

      const { data } = await createCheckout(app);

      // El monto viaja como string: si el adaptador lo convirtiera a número, Rapyd
      // rechazaría la firma del cuerpo serializado.
      expect(data.payment.amount).toBe("150000.00");
      expect(data.payment.currency_code).toBe("COP");
      expect(data.payment.merchant_reference_id).toBe("orden-tarjeta-1");

      await app.close();
    });

    it("rejects a page without amount, currency or country", async () => {
      const app = buildApp();

      for (const missing of ["amount", "currency", "country"]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          payload: { ...validCheckoutBody, [missing]: undefined },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().status.error_code).toBe("MISSING_REQUIRED_FIELD");
      }

      await app.close();
    });
  });

  describe("GET /v1/sim/rapyd/checkout/:checkoutId", () => {
    /**
     * Consultar no paga: contra el sandbox real una página creada y no visitada se queda en
     * `NEW` indefinidamente. Que el mock la dejara pendiente hasta la visita es lo que hace
     * que el ejemplo tenga que recorrer el flujo en el orden real.
     */
    it("stays pending while nobody visits the page, even if it is queried", async () => {
      const app = buildApp();
      const { data } = await createCheckout(app);

      for (const _ of [1, 2]) {
        const queryResponse = await app.inject({
          method: "GET",
          url: `/v1/sim/rapyd/checkout/${data.id}`,
        });

        expect(queryResponse.statusCode).toBe(200);
        expect(queryResponse.json().data.status).toBe("NEW");
        expect(queryResponse.json().data.payment.id).toBeNull();
      }

      await app.close();
    });

    it("is paid when the payer visits the redirect URL", async () => {
      const app = buildApp();
      const { data } = await createCheckout(app);

      const visit = await app.inject({ method: "GET", url: paymentRoute(data.redirect_url) });

      expect(visit.statusCode).toBe(200);
      expect(visit.json().paid).toBe(true);

      const queryResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/checkout/${data.id}`,
      });

      expect(queryResponse.json().data.status).toBe("DON");
      expect(queryResponse.json().data.payment.id).toMatch(/^payment_[0-9a-f]{32}$/);
      expect(queryResponse.json().data.payment.status).toBe("CLO");
      expect(queryResponse.json().data.payment.paid).toBe(true);

      await app.close();
    });

    it("keeps the amount and the reference after the payment", async () => {
      const app = buildApp();
      const { data } = await createCheckout(app);

      await app.inject({ method: "GET", url: paymentRoute(data.redirect_url) });
      const paidResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/checkout/${data.id}`,
      });

      expect(paidResponse.json().data.payment.amount).toBe("150000.00");
      expect(paidResponse.json().data.payment.merchant_reference_id).toBe("orden-tarjeta-1");

      await app.close();
    });

    it("answers with Rapyd's native error for a page that does not exist", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/rapyd/checkout/checkout_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      });

      // Medido contra el sandbox el 5 de octubre de 2026.
      expect(response.statusCode).toBe(400);
      expect(response.json().status.error_code).toBe("ERROR_GET_HOSTED_PAGE_PAYMENT");
      expect(response.json().status.message).toMatch(
        /^The request tried to retrieve a hosted page, but the page was not found\./,
      );

      await app.close();
    });
  });
});
