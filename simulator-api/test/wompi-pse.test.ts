import { buildSignedApp as buildApp } from "./helpers/signedRequests";
import { wompiTransactions } from "../src/store/GatewayStores";

/**
 * El orden del flujo de PSE (issue #64).
 *
 * Estas pruebas son la razón de fondo por la que la API de Simulación existe.
 * El sandbox de Wompi publica la URL de redirección en el mismo instante en que
 * resuelve el pago (medido: 1075 ms junto con APPROVED, 1650 ms junto con
 * DECLINED), así que contra el sandbox real **no hay forma de verificar que
 * exista una ventana en la que el pagador deba ser redirigido**. Aquí sí.
 */
describe("PSE in the Wompi simulator", () => {
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

  it("stays PENDING and without a redirect URL on creation, like the real Wompi", async () => {
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
  it("publishes the redirect URL while still PENDING on the first query", async () => {
    const app = buildApp();

    const created = await createPse(app);
    const firstRead = await readTransaction(app, created.id);

    expect(firstRead.status).toBe("PENDING");
    expect(firstRead.payment_method.extra.async_payment_url).toContain(created.id.replace(/-/g, ""));

    await app.close();
  });

  /**
   * Medido el 6 de octubre de 2026 (`docs/testing-data/wompi.md`, sección 3): la URL es
   * `…/v1/pse/redirect?ticket_id=<id sin guiones>`. El host sale de la petición que creó el
   * PSE y no de la consulta, que aquí llega con el `Host` por omisión de `inject`.
   */
  it("builds the bank URL from the creating request's host, with the ticket id without dashes", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { host: "simulator.example.com:8443" },
      payload: psePayload,
    });
    const created = response.json().data;
    const firstRead = await readTransaction(app, created.id);

    expect(created.id).toContain("-");
    expect(firstRead.payment_method.extra.async_payment_url).toBe(
      `http://simulator.example.com:8443/v1/sim/wompi/pse/redirect?ticket_id=${created.id.replace(/-/g, "")}`,
    );

    await app.close();
  });

  it("publishes the bank URL and the terms permalink on SIMULATOR_PUBLIC_ORIGIN when it is configured", async () => {
    // El host de la petición es el del balanceador; el origen configurado es el público.
    const app = buildApp({ publicOrigin: "https://kit-pagos-colombia.onrender.com" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers: { host: "10.0.0.7:10000" },
      payload: psePayload,
    });
    const created = response.json().data;
    const firstRead = await readTransaction(app, created.id);
    const merchant = await app.inject({
      method: "GET",
      url: "/v1/sim/wompi/merchants/pub_test_x",
      headers: { host: "10.0.0.7:10000" },
    });

    expect(firstRead.payment_method.extra.async_payment_url).toBe(
      `https://kit-pagos-colombia.onrender.com/v1/sim/wompi/pse/redirect?ticket_id=${created.id.replace(/-/g, "")}`,
    );
    expect(merchant.json().data.presigned_acceptance.permalink).toBe(
      "https://kit-pagos-colombia.onrender.com/v1/sim/wompi/terms",
    );

    await app.close();
  });

  it("serves the bank redirect it publishes, as a page that says it is simulated and moves nothing", async () => {
    const app = buildApp();

    const created = await createPse(app);
    const bankUrl = new URL((await readTransaction(app, created.id)).payment_method.extra.async_payment_url);
    const page = await app.inject({ method: "GET", url: `${bankUrl.pathname}${bankUrl.search}` });

    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("Redirección simulada al banco");
    expect(page.body).not.toContain(bankUrl.searchParams.get("ticket_id"));
    expect(wompiTransactions.findById(created.id)?.status).toBe("PENDING");

    await app.close();
  });

  it("resolves the payment on the second query, as if the payer had already paid", async () => {
    const app = buildApp();

    const created = await createPse(app);
    await readTransaction(app, created.id);
    const secondRead = await readTransaction(app, created.id);

    expect(secondRead.status).toBe("APPROVED");
    // La URL sigue presente: Wompi no la borra al resolver.
    expect(secondRead.payment_method.extra.async_payment_url).toContain(created.id.replace(/-/g, ""));

    await app.close();
  });

  /**
   * Mismos códigos de banco que el sandbox, para que una prueba pueda elegir el
   * desenlace en vez de depender del azar.
   */
  it("declines with bank 2 and errors with bank 3", async () => {
    const app = buildApp();

    const declined = await createPse(app, "2");
    await readTransaction(app, declined.id);
    expect((await readTransaction(app, declined.id)).status).toBe("DECLINED");

    const errored = await createPse(app, "3");
    await readTransaction(app, errored.id);
    expect((await readTransaction(app, errored.id)).status).toBe("ERROR");

    await app.close();
  });

  it("reflects the merchant's return URL as it was sent", async () => {
    const app = buildApp();

    const created = await createPse(app);

    expect(created.redirect_url).toBe(psePayload.redirect_url);

    await app.close();
  });

  it("resolves the card on the first query, without publishing a bank URL", async () => {
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

    // La tarjeta nace pendiente igual que el PSE, pero avanza distinto: no tiene banco al
    // que redirigir, así que la primera consulta ya la resuelve.
    expect(response.json().data.status).toBe("PENDING");

    const queried = await app.inject({
      method: "GET",
      url: `/v1/sim/wompi/transactions/${response.json().data.id}`,
    });

    expect(queried.json().data.status).toBe("APPROVED");
    expect(queried.json().data.payment_method?.extra?.async_payment_url).toBeUndefined();

    await app.close();
  });
});

describe("GET /v1/sim/wompi/merchants/:publicKey", () => {
  it("delivers an acceptance_token so the SDK can create transactions", async () => {
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
  it("delivers a different token on every call", async () => {
    const app = buildApp();

    const read = async () =>
      (
        await app.inject({ method: "GET", url: "/v1/sim/wompi/merchants/pub_test_x" })
      ).json().data.presigned_acceptance.acceptance_token;

    expect(await read()).not.toBe(await read());

    await app.close();
  });

  it("builds the terms permalink from the request's host", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/sim/wompi/merchants/pub_test_x",
      headers: { host: "simulator.example.com:8443" },
    });

    expect(response.json().data.presigned_acceptance.permalink).toBe(
      "http://simulator.example.com:8443/v1/sim/wompi/terms",
    );

    await app.close();
  });

  it("serves the terms page its permalink points to, as a page that says it is simulated", async () => {
    // Con el token de la API configurado y sin `Authorization`: la abre el navegador del
    // pagador, que no tiene ese token, y `/v1/sim` está exento en `authHook`.
    const app = buildApp({ authOptions: { expectedToken: "api-token-de-prueba" } });

    const merchant = await app.inject({ method: "GET", url: "/v1/sim/wompi/merchants/pub_test_x" });
    const { permalink } = merchant.json().data.presigned_acceptance;

    const page = await app.inject({ method: "GET", url: new URL(permalink).pathname });

    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("API de Simulación");
    expect(page.body).toContain("no son los términos de Wompi");

    await app.close();
  });
});
