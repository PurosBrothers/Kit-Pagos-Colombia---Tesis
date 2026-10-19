import { FastifyInstance } from "fastify";
import { buildSignedApp as buildApp } from "./helpers/signedRequests";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { resetSimulatorState } from "../src/store/GatewayStores";
import { WebhookDispatchConfig } from "../src/webhooks/webhookDispatch";

/**
 * Emisión automática del webhook al cambiar de estado (issue #122, paso 7).
 *
 * Es opcional y está apagada por omisión: DA-03 eligió el disparo manual y sigue siendo el
 * comportamiento sin configuración. Se enciende solo con una URL destino **y**
 * `SIMULATOR_WEBHOOK_AUTO=true`.
 */

const SERVER_ENV = {
  WOMPI_PUBLIC_KEY: "pub_test_server",
  WOMPI_PRIVATE_KEY: "prv_test_server",
  WOMPI_EVENTS_SECRET: "test_events_server",
  KUSHKI_PUBLIC_MERCHANT_ID: "kushki_public_server",
  KUSHKI_PRIVATE_MERCHANT_ID: "kushki_private_server",
  KUSHKI_WEBHOOK_SECRET: "kushki_webhook_server",
};

const TARGET = "http://127.0.0.1:9/hook";
const openApps: FastifyInstance[] = [];

function simulator(webhooks: Partial<WebhookDispatchConfig>) {
  const app = buildApp({ credentialResolver: new CredentialResolver(SERVER_ENV), webhooks });
  openApps.push(app);
  return app;
}

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  resetSimulatorState();
});

async function wompiCardQueriedTwice(app: FastifyInstance) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/sim/wompi/transactions",
    payload: {
      amount_in_cents: 5000000,
      currency: "COP",
      reference: `W-${Date.now()}`,
      customer_email: "comprador@example.com",
      payment_method: { type: "CARD", token: "tok_test_wompi_card_123", installments: 1 },
    },
  });
  const id = created.json().data.id;
  const first = await app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` });
  const second = await app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` });
  return { id, first, second };
}

/** Deja correr lo que la emisión lanzó sin esperar. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("automatic webhook emission", () => {
  it("fires once per transition when enabled: PENDING to APPROVED, and not on the idempotent second query", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const app = simulator({ targetUrl: TARGET, auto: true });

    const { id, first, second } = await wompiCardQueriedTwice(app);
    await settle();

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(TARGET);
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.data.transaction).toMatchObject({ id, status: "APPROVED" });
  });

  it("fires for a Kushki transfer when the query closes it, and not when init starts it", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const app = simulator({ targetUrl: TARGET, auto: true });
    const amount = { subtotalIva0: 50000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" };

    const token = (
      await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/tokens",
        payload: {
          amount,
          bankId: "0001",
          callbackUrl: "https://comercio.example.com/retorno",
          userType: "0",
          documentType: "CC",
          documentNumber: "1020304050",
          paymentDescription: `KT-${Date.now()}`,
          email: "pagador@example.com",
          currency: "COP",
        },
      })
    ).json().token;
    await app.inject({ method: "POST", url: "/v1/sim/kushki/transfer/v1/init", payload: { token, amount } });
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();

    await app.inject({ method: "GET", url: `/v1/sim/kushki/transfer/v1/status/${token}` });
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({ token, status: "approvedTransaction" });
  });

  it.each([
    ["a target without the opt-in", { targetUrl: TARGET }],
    ["the opt-in without a target", { auto: true }],
    ["no configuration", {}],
  ])("never fires with %s", async (_name, webhooks: Partial<WebhookDispatchConfig>) => {
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const app = simulator(webhooks);

    await wompiCardQueriedTwice(app);
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not fail or delay the gateway response when the delivery fails", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const app = simulator({ targetUrl: TARGET, auto: true });

    const { first } = await wompiCardQueriedTwice(app);
    await settle();

    expect(first.statusCode).toBe(200);
    expect(first.json().data.status).toBe("APPROVED");
  });

  it("stops firing once the app that enabled it is closed", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const enabled = simulator({ targetUrl: TARGET, auto: true });
    await enabled.close();
    openApps.splice(openApps.indexOf(enabled), 1);
    const plain = simulator({});

    await wompiCardQueriedTwice(plain);
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
