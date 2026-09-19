import { buildApp } from "../src/app";

/**
 * El orden del flujo de PSE (issue #64).
 *
 * Estas pruebas son la razón de fondo por la que la API de Simulación existe.
 * El sandbox de Wompi publica la URL de redirección en el mismo instante en que
 * resuelve el pago (medido: 1075 ms junto con APPROVED, 1650 ms junto con
 * DECLINED), así que contra el sandbox real **no hay forma de verificar que
 * exista una ventana en la que el pagador deba ser redirigido**. Acá sí.
 */
describe("PSE en el simulador de Wompi", () => {
  const psePayload = {
    amount_in_cents: 15000000,
    currency: "COP",
    reference: "orden-pse-123",
    customer_email: "cliente@example.com",
    redirect_url: "https://comercio.example.com/retorno",
    payment_method: {
      type: "PSE",
      user_type: 0,
      user_legal_id_type: "CC",
      user_legal_id: "1099888777",
      financial_institution_code: "1",
      payment_description: "Pago orden-pse-123",
    },
  };

  async function createPse(app: ReturnType<typeof buildApp>, bankCode = "1") {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: {
        ...psePayload,
        payment_method: {
          ...psePayload.payment_method,
          financial_institution_code: bankCode,
        },
      },
    });
    return response.json().data;
  }

  function readTransaction(app: ReturnType<typeof buildApp>, id: string) {
    return app
      .inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` })
      .then((response) => response.json().data);
  }

  it("queda PENDING y sin URL de redirección al crear, igual que Wompi real", async () => {
    const app = buildApp();

    const created = await createPse(app);

    expect(created.status).toBe("PENDING");
    expect(created.payment_method.extra.async_payment_url).toBeUndefined();

    await app.close();
  });

  /**
   * Esta es la ventana que el sandbox real nunca expone: la URL ya está
   * disponible y el pago todavía no se resolvió. Sin ella, un comercio no tendría
   * a dónde mandar al pagador.
   */
  it("publica la URL de redirección todavía en PENDING en la primera consulta", async () => {
    const app = buildApp();

    const created = await createPse(app);
    const firstRead = await readTransaction(app, created.id);

    expect(firstRead.status).toBe("PENDING");
    expect(firstRead.payment_method.extra.async_payment_url).toContain(created.id);

    await app.close();
  });

  it("resuelve el pago en la segunda consulta, como si el pagador ya hubiera pagado", async () => {
    const app = buildApp();

    const created = await createPse(app);
    await readTransaction(app, created.id);
    const secondRead = await readTransaction(app, created.id);

    expect(secondRead.status).toBe("APPROVED");
    // La URL sigue presente: Wompi no la borra al resolver.
    expect(secondRead.payment_method.extra.async_payment_url).toContain(created.id);

    await app.close();
  });

  /**
   * Mismos códigos de banco que el sandbox, para que una prueba pueda elegir el
   * desenlace en vez de depender del azar.
   */
  it("declina con el banco 2 y da error con el banco 3", async () => {
    const app = buildApp();

    const declined = await createPse(app, "2");
    await readTransaction(app, declined.id);
    expect((await readTransaction(app, declined.id)).status).toBe("DECLINED");

    const errored = await createPse(app, "3");
    await readTransaction(app, errored.id);
    expect((await readTransaction(app, errored.id)).status).toBe("ERROR");

    await app.close();
  });

  it("refleja la URL de retorno del comercio tal como se envió", async () => {
    const app = buildApp();

    const created = await createPse(app);

    expect(created.redirect_url).toBe(psePayload.redirect_url);

    await app.close();
  });

  it("no altera el flujo de tarjeta, que sigue resolviéndose al crear", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: {
        amount_in_cents: 5000000,
        currency: "COP",
        reference: "orden-tarjeta-1",
        customer_email: "cliente@example.com",
        payment_method: { type: "CARD", token: "tok_test_fake" },
      },
    });

    expect(response.json().data.status).toBe("APPROVED");

    await app.close();
  });
});

describe("GET /v1/sim/wompi/merchants/:publicKey", () => {
  it("entrega un acceptance_token para que el SDK pueda crear transacciones", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/sim/wompi/merchants/pub_test_cualquiera",
    });

    expect(response.statusCode).toBe(200);
    expect(typeof response.json().data.presigned_acceptance.acceptance_token).toBe("string");

    await app.close();
  });

  /**
   * El token real es de un solo uso: reutilizarlo da "El token de aceptación ya
   * fue usado". El mock devuelve uno distinto en cada llamada para que un SDK
   * que lo cachee no pase las pruebas por accidente.
   */
  it("entrega un token distinto en cada llamada", async () => {
    const app = buildApp();

    const read = async () =>
      (
        await app.inject({ method: "GET", url: "/v1/sim/wompi/merchants/pub_test_x" })
      ).json().data.presigned_acceptance.acceptance_token;

    expect(await read()).not.toBe(await read());

    await app.close();
  });
});
