import { buildApp } from "../src/app";

/**
 * Página de pago alojada de Rapyd: el camino de tarjeta.
 *
 * Existe como ruta aparte de `/payments` porque así es en Rapyd, y porque el cobro directo
 * de una tarjeta no es viable: con un método guardado responde
 * `ERROR_CARD_NOT_AUTHENTICATED`, y la variante que cobra exige el número de la tarjeta en
 * la petición. Ver el punto 50 del architecture-log.
 */
describe("página de pago de Rapyd", () => {
  const validCheckoutBody = {
    amount: "150000.00",
    currency: "COP",
    country: "CO",
    merchant_reference_id: "orden-tarjeta-1",
    payment_method_type_categories: ["card"],
    receipt_email: "cliente@example.com",
  };

  /** La URL de redirección es absoluta; `inject` necesita solo la ruta. */
  function rutaDePago(redirectUrl: string): string {
    return new URL(redirectUrl).pathname;
  }

  async function crearCheckout(app: ReturnType<typeof buildApp>) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/rapyd/checkout",
      payload: validCheckoutBody,
    });

    return { statusCode: response.statusCode, data: response.json().data };
  }

  describe("POST /v1/sim/rapyd/checkout", () => {
    it("crea la página con el prefijo checkout_ y una URL de redirección", async () => {
      const app = buildApp();

      const { statusCode, data } = await crearCheckout(app);

      // 200, el código que se midió para esta ruta. `POST /v1/payments` responde 201:
      // es la misma API y no usa el mismo código para crear.
      expect(statusCode).toBe(200);
      expect(data.id).toMatch(/^checkout_[0-9a-f]{32}$/);
      expect(typeof data.redirect_url).toBe("string");
      expect(data.redirect_url.length).toBeGreaterThan(0);

      await app.close();
    });

    /**
     * Que el pago venga vacío no es una simplificación del mock: es lo que devuelve Rapyd,
     * porque en ese momento nadie pagó todavía. Un adaptador que leyera `payment.id` al
     * crear se quedaría sin identificador, y por eso el SDK usa el del checkout.
     */
    it("nace NEW y con el pago en null, porque nadie pagó todavía", async () => {
      const app = buildApp();

      const { data } = await crearCheckout(app);

      expect(data.status).toBe("NEW");
      expect(data.payment.id).toBeNull();
      expect(data.payment.status).toBeNull();

      await app.close();
    });

    it("refleja el monto y la divisa tal como llegaron", async () => {
      const app = buildApp();

      const { data } = await crearCheckout(app);

      // El monto viaja como string: si el adaptador lo convirtiera a número, Rapyd
      // rechazaría la firma del cuerpo serializado.
      expect(data.payment.amount).toBe("150000.00");
      expect(data.payment.currency_code).toBe("COP");
      expect(data.payment.merchant_reference_id).toBe("orden-tarjeta-1");

      await app.close();
    });

    it("rechaza una página sin monto, divisa o país", async () => {
      const app = buildApp();

      for (const faltante of ["amount", "currency", "country"]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          payload: { ...validCheckoutBody, [faltante]: undefined },
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
    it("sigue pendiente mientras nadie visite la página, aunque se consulte", async () => {
      const app = buildApp();
      const { data } = await crearCheckout(app);

      for (const _ of [1, 2]) {
        const consulta = await app.inject({
          method: "GET",
          url: `/v1/sim/rapyd/checkout/${data.id}`,
        });

        expect(consulta.statusCode).toBe(200);
        expect(consulta.json().data.status).toBe("NEW");
        expect(consulta.json().data.payment.id).toBeNull();
      }

      await app.close();
    });

    it("queda pagada cuando el pagador visita la URL de redirección", async () => {
      const app = buildApp();
      const { data } = await crearCheckout(app);

      const visita = await app.inject({ method: "GET", url: rutaDePago(data.redirect_url) });

      expect(visita.statusCode).toBe(200);
      expect(visita.json().paid).toBe(true);

      const consulta = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/checkout/${data.id}`,
      });

      expect(consulta.json().data.status).toBe("DON");
      expect(consulta.json().data.payment.id).toMatch(/^payment_[0-9a-f]{32}$/);
      expect(consulta.json().data.payment.status).toBe("CLO");
      expect(consulta.json().data.payment.paid).toBe(true);

      await app.close();
    });

    it("conserva el monto y la referencia después del pago", async () => {
      const app = buildApp();
      const { data } = await crearCheckout(app);

      await app.inject({ method: "GET", url: rutaDePago(data.redirect_url) });
      const pagada = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/checkout/${data.id}`,
      });

      expect(pagada.json().data.payment.amount).toBe("150000.00");
      expect(pagada.json().data.payment.merchant_reference_id).toBe("orden-tarjeta-1");

      await app.close();
    });

    it("responde con el error nativo de Rapyd ante una página que no existe", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/rapyd/checkout/checkout_noexiste",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().status.error_code).toBe("ERROR_GET_CHECKOUT_PAGE");

      await app.close();
    });
  });
});
