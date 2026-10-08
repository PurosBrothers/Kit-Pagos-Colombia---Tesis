import { buildApp } from "../src/app";

/**
 * PSE en el simulador de Mercado Pago (issue #64).
 *
 * A diferencia de Wompi, donde el simulador existe para poder observar un orden
 * que el sandbox real colapsa (ver `wompi-pse.test.ts`), aquí el simulador existe
 * por una razón distinta: la Orders API real **no se puede ejercitar con
 * credenciales de prueba** —devuelve `401` y exige un token de producción— y
 * completar el pago requiere que una persona entre al banco. Estas pruebas
 * verifican que el mock reproduce la forma que se midió contra la API real el 18
 * de septiembre de 2026.
 */
describe("PSE in the Mercado Pago simulator", () => {
  const orderPayload = {
    type: "online",
    total_amount: "150000",
    external_reference: "orden-mp-pse-123",
    processing_mode: "automatic",
    payer: {
      email: "cliente@example.com",
      entity_type: "individual",
      identification: { type: "CC", number: "1099888777" },
      first_name: "Juan",
      last_name: "Perez Gomez",
      phone: { area_code: "57", number: "3001234567" },
      address: {
        street_name: "Calle 10",
        street_number: "100",
        city: "Bogota",
        zip_code: "110111",
        neighborhood: "Centro",
      },
    },
    transactions: {
      payments: [
        {
          amount: "150000",
          payment_method: {
            id: "pse",
            type: "bank_transfer",
            financial_institution: "1051",
          },
        },
      ],
    },
    additional_info: { "payer.ip_address": "200.100.50.25" },
    config: {
      online: { callback_url: "https://comercio.example.com/retorno" },
    },
  };

  function createOrder(app: ReturnType<typeof buildApp>, scenario?: string) {
    return app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/orders",
      // La llave de idempotencia va siempre: la API de órdenes no crea nada sin ella, así
      // que el mock tampoco.
      headers: {
        "x-idempotency-key": "prueba-idempotencia",
        ...(scenario ? { "x-simulate-scenario": scenario } : {}),
      },
      payload: orderPayload,
    });
  }

  /**
   * La API de órdenes se queja distinto que la de pagos por el mismo header que faltaba:
   * `errors[]` con `empty_required_header` en vez de `message`. El mock reproduce las dos
   * formas porque son las dos que el SDK puede recibir.
   */
  it("rejects an order without an idempotency key, with the shape of the orders API", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/orders",
      payload: orderPayload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].code).toBe("empty_required_header");

    await app.close();
  });

  /**
   * La API real devuelve la URL del banco ya en la creación, que es la diferencia
   * de fondo con Wompi: aquí no hay nada que sondear.
   */
  it("delivers the bank URL in the same creation response", async () => {
    const app = buildApp();

    const response = await createOrder(app);
    const order = response.json();

    expect(response.statusCode).toBe(201);
    expect(order.status).toBe("action_required");
    expect(order.status_detail).toBe("waiting_transfer");
    expect(order.transactions.payments[0].payment_method.redirect_url).toMatch(
      /^https:\/\/www\.mercadopago\.com\.co\/payments\//,
    );
  });

  it("uses order identifiers with the ORD prefix, which is what the SDK routes", async () => {
    const app = buildApp();

    const order = (await createOrder(app)).json();

    expect(order.id).toMatch(/^ORD/);
    expect(order.transactions.payments[0].id).toMatch(/^PAY/);
  });

  /** El monto viaja como string sin decimales: la API real rechaza `"150000.00"`. */
  it("keeps the amount as a string without decimals", async () => {
    const app = buildApp();

    const order = (await createOrder(app)).json();

    expect(order.total_amount).toBe("150000");
    expect(order.transactions.payments[0].amount).toBe("150000");
    expect(order.currency).toBe("COP");
  });

  it("reflects the merchant reference and the chosen bank", async () => {
    const app = buildApp();

    const order = (await createOrder(app)).json();

    expect(order.external_reference).toBe("orden-mp-pse-123");
    expect(
      order.transactions.payments[0].payment_method.financial_institution,
    ).toBe("1051");
    expect(order.config.online.callback_url).toBe(
      "https://comercio.example.com/retorno",
    );
  });

  /**
   * La orden consultada después vuelve `processed` y sin URL: el pagador ya
   * transfirió y no hay a dónde redirigirlo. Es el paso que contra la pasarela
   * real exigiría que una persona entre al banco.
   */
  it("returns the order already paid when queried, without a redirect URL", async () => {
    const app = buildApp();

    const created = (await createOrder(app)).json();
    const response = await app.inject({
      method: "GET",
      url: `/v1/sim/mercadopago/orders/${created.id}`,
    });
    const order = response.json();

    expect(response.statusCode).toBe(200);
    expect(order.id).toBe(created.id);
    expect(order.status).toBe("processed");
    // `processed | accredited`: el detalle cambia con el estado. Antes la orden pagada
    // seguía diciendo `waiting_transfer`.
    expect(order.status_detail).toBe("accredited");
    expect(
      order.transactions.payments[0].payment_method.redirect_url,
    ).toBeUndefined();
  });

  /**
   * El pagador que nunca vuelve del banco. Antes de esta ronda, `PENDING` se aceptaba con
   * `201` y la primera consulta respondía `processed`: el escenario se ignoraba, que es
   * el mismo defecto que el issue reporta.
   */
  it("with PENDING the order keeps waiting for the payer on every query, with its URL", async () => {
    const app = buildApp();

    const created = (await createOrder(app, "PENDING")).json();

    for (const _ of [1, 2]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/orders/${created.id}`,
      });
      const order = response.json();

      expect(response.statusCode).toBe(200);
      expect(order.status).toBe("action_required");
      expect(order.status_detail).toBe("waiting_transfer");
      expect(order.transactions.payments[0].payment_method.redirect_url).toBeDefined();
    }
  });

  it("creates the order waiting for the payer, with the redirect URL", async () => {
    // El estado que espera al pagador se observa **al crear**, no consultando. Antes esta
    // prueba pedía una orden que no existía con `PENDING` y la ruta respondía
    // `action_required`: la consulta fabricaba el estado y además lo decidía con la
    // cabecera. Ahora la creación deja la orden en `action_required` con su URL, y la
    // consulta la cierra, que es el orden real del flujo.
    const app = buildApp();

    const response = await createOrder(app);
    const order = response.json();

    expect(response.statusCode).toBe(201);
    expect(order.status).toBe("action_required");
    expect(
      order.transactions.payments[0].payment_method.redirect_url,
    ).toBeDefined();
  });

  it("does not change an order already queried even if it is queried again", async () => {
    // La tabla mueve `action_required` a `processed` una sola vez. Consultar de nuevo
    // devuelve lo mismo, que es el criterio 1 del issue aplicado a las órdenes: el
    // resultado de una consulta no puede depender de cuántas veces se hizo.
    const app = buildApp();

    const created = (await createOrder(app)).json();

    const first = await app.inject({
      method: "GET",
      url: `/v1/sim/mercadopago/orders/${created.id}`,
    });
    const second = await app.inject({
      method: "GET",
      url: `/v1/sim/mercadopago/orders/${created.id}`,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("processed");
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("processed");
    expect(second.json()).toEqual(first.json());
  });

  it("returns the merchant's external reference, which used to be lost", async () => {
    // Antes la ruta de consulta armaba la orden de cero y no incluía
    // `external_reference`, a propósito porque "el simulador no guarda estado entre el POST
    // y el GET". Con la orden guardada, la referencia que mandó el comercio vuelve intacta,
    // y es contra ella que se concilia del lado del comercio.
    const app = buildApp();

    const created = (await createOrder(app)).json();

    const response = await app.inject({
      method: "GET",
      url: `/v1/sim/mercadopago/orders/${created.id}`,
    });

    expect(response.json().external_reference).toBe("orden-mp-pse-123");
    expect(response.json().total_amount).toBe("150000");
  });

  it("returns 404 if the order does not exist", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/sim/mercadopago/orders/ORD01JZZZZZZZZZZZZZZZZZZZZZZZ",
    });

    // Medido contra la API real el 5 de octubre de 2026, con el token `APP_USR-`.
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      errors: [{ code: "order_not_found", message: "Order not found." }],
    });
  });

  /**
   * La pasarela real no rechaza el PSE al crearlo con un 201 y estado de rechazo:
   * responde 402 con el sobre `errors[]` y la orden entera en `data`. Medido el 7 de
   * octubre de 2026 (`docs/testing-data/mercado-pago.md`, «El `402` de una orden de PSE
   * que falla»).
   */
  it("reproduces the gateway's 402 when the payment fails, with details and the whole order in data", async () => {
    const app = buildApp();

    const response = await createOrder(app, "REJECTED");

    expect(response.statusCode).toBe(402);
    const { errors, data } = response.json();
    const payment = data.transactions.payments[0];

    expect(errors).toEqual([
      {
        code: "failed",
        message: "The following transactions failed",
        details: [`${payment.id}: processing_error`],
      },
    ]);
    expect(data).toMatchObject({
      status: "failed",
      status_detail: "failed",
      total_amount: "150000",
      total_paid_amount: "0",
      currency: "COP",
      external_reference: "orden-mp-pse-123",
      payer: { entity_type: "individual" },
      config: { online: { callback_url: "https://comercio.example.com/retorno" } },
    });
    expect(data.id).toMatch(/^ORD/);
    expect(payment).toMatchObject({ status: "failed", status_detail: "processing_error" });
    expect(payment.payment_method).toEqual({
      id: "pse",
      type: "bank_transfer",
      financial_institution: "1051",
    });
  });

  it("keeps the failed order: the query answers it bare and failed, every time", async () => {
    const app = buildApp();

    const created = (await createOrder(app, "REJECTED")).json().data;

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/orders/${created.id}`,
      });

      // Medido: 200 con la orden suelta, sin el sobre `data` y sin la llave `payer`.
      expect(response.statusCode).toBe(200);
      const order = response.json();
      expect(order).not.toHaveProperty("data");
      expect(order).not.toHaveProperty("payer");
      expect(order).toMatchObject({
        id: created.id,
        status: "failed",
        status_detail: "failed",
        total_paid_amount: "0",
        last_updated_date: created.last_updated_date,
      });
    }
  });

  it("returns 404 for a nonexistent order", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/sim/mercadopago/orders/ORD01NOEXISTE",
      headers: { "x-simulate-scenario": "NOT_FOUND" },
    });

    expect(response.statusCode).toBe(404);
  });
});
