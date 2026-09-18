import { buildApp } from "../src/app";

/**
 * PSE en el simulador de Mercado Pago (issue #64).
 *
 * A diferencia de Wompi, donde el simulador existe para poder observar un orden
 * que el sandbox real colapsa (ver `wompi-pse.test.ts`), acá el simulador existe
 * por una razón distinta: la Orders API real **no se puede ejercitar con
 * credenciales de prueba** —devuelve `401` y exige un token de producción— y
 * completar el pago requiere que una persona entre al banco. Estas pruebas
 * verifican que el mock reproduce la forma que se midió contra la API real el 18
 * de septiembre de 2026.
 */
describe("PSE en el simulador de Mercado Pago", () => {
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
    config: { online: { callback_url: "https://comercio.example.com/retorno" } },
  };

  function createOrder(app: ReturnType<typeof buildApp>, scenario?: string) {
    return app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/orders",
      headers: scenario ? { "x-simulate-scenario": scenario } : {},
      payload: orderPayload,
    });
  }

  /**
   * La API real devuelve la URL del banco ya en la creación, que es la diferencia
   * de fondo con Wompi: acá no hay nada que sondear.
   */
  it("entrega la URL del banco en la misma respuesta de creación", async () => {
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

  it("usa identificadores de orden con prefijo ORD, que es lo que el SDK enruta", async () => {
    const app = buildApp();

    const order = (await createOrder(app)).json();

    expect(order.id).toMatch(/^ORD/);
    expect(order.transactions.payments[0].id).toMatch(/^PAY/);
  });

  /** El monto viaja como string sin decimales: la API real rechaza `"150000.00"`. */
  it("conserva el monto como string sin decimales", async () => {
    const app = buildApp();

    const order = (await createOrder(app)).json();

    expect(order.total_amount).toBe("150000");
    expect(order.transactions.payments[0].amount).toBe("150000");
    expect(order.currency).toBe("COP");
  });

  it("refleja la referencia del comercio y el banco elegido", async () => {
    const app = buildApp();

    const order = (await createOrder(app)).json();

    expect(order.external_reference).toBe("orden-mp-pse-123");
    expect(order.transactions.payments[0].payment_method.financial_institution).toBe(
      "1051",
    );
    expect(order.config.online.callback_url).toBe("https://comercio.example.com/retorno");
  });

  /**
   * La orden consultada después vuelve `processed` y sin URL: el pagador ya
   * transfirió y no hay a dónde redirigirlo. Es el paso que contra la pasarela
   * real exigiría que una persona entre al banco.
   */
  it("devuelve la orden ya pagada al consultarla, sin URL de redirección", async () => {
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
    expect(order.transactions.payments[0].payment_method.redirect_url).toBeUndefined();
  });

  it("permite consultar una orden que sigue esperando al pagador", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/sim/mercadopago/orders/ORD01TESTPENDING",
      headers: { "x-simulate-scenario": "PENDING" },
    });
    const order = response.json();

    expect(order.status).toBe("action_required");
    expect(order.transactions.payments[0].payment_method.redirect_url).toBeDefined();
  });

  /**
   * La pasarela real no rechaza el PSE al crearlo con un 201 y estado de rechazo:
   * responde 402 y la orden entera queda en `failed`. Se reproduce el código
   * porque es el que el SDK tiene que saber traducir.
   */
  it("reproduce el 402 de la pasarela cuando el pago falla", async () => {
    const app = buildApp();

    const response = await createOrder(app, "REJECTED");

    expect(response.statusCode).toBe(402);
    expect(response.json().errors[0].code).toBe("failed");
  });

  it("devuelve 404 para una orden inexistente", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/sim/mercadopago/orders/ORD01NOEXISTE",
      headers: { "x-simulate-scenario": "NOT_FOUND" },
    });

    expect(response.statusCode).toBe(404);
  });
});
