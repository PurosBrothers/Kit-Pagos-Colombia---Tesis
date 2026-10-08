import * as http from "http";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * El trigger de webhooks exige el mismo `API_AUTH_TOKEN` que `/v1/api` (decisión de Joan,
 * 6 de octubre de 2026): devuelve el webhook firmado con los secretos del servidor, así que
 * abierto es un oráculo de firma. El resto de `/v1/sim` sigue exento, porque el SDK le habla
 * sin ese token.
 */

const TOKEN = "trigger_test_token_0123456789";

const SERVER_ENV = {
  WOMPI_PUBLIC_KEY: "pub_test_server",
  WOMPI_PRIVATE_KEY: "prv_test_server",
  WOMPI_EVENTS_SECRET: "test_events_server",
};

const MISSING = {
  error: "Unauthorized",
  message: "Missing or malformed Authorization header. Expected 'Bearer <token>'.",
};
const INVALID = { error: "Unauthorized", message: "Invalid authorization token." };

const openApps: FastifyInstance[] = [];

function simulator(expectedToken: string | undefined) {
  const app = buildApp({
    credentialResolver: new CredentialResolver(SERVER_ENV),
    authOptions: { expectedToken, logger: { warn: () => undefined } },
    webhooks: {},
  });
  openApps.push(app);
  return app;
}

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  resetSimulatorState();
});

async function wompiTransaction(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
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
  expect(res.statusCode).toBe(201);
  return res.json().data.id;
}

const trigger = (app: FastifyInstance, transactionId: string, headers: Record<string, string> = {}, url = "/v1/sim/webhooks/trigger") =>
  app.inject({ method: "POST", url, headers, payload: { gateway: "wompi", transactionId } });

describe("POST /v1/sim/webhooks/trigger with API_AUTH_TOKEN configured", () => {
  it("answers 401 with the /v1/api body when the Authorization header is missing", async () => {
    const app = simulator(TOKEN);
    const res = await trigger(app, await wompiTransaction(app));

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(MISSING);
  });

  it("answers 401 with the /v1/api body for a wrong token, and /v1/api answers the same", async () => {
    const app = simulator(TOKEN);
    const wrong = { authorization: "Bearer not_the_token" };

    const res = await trigger(app, await wompiTransaction(app), wrong);
    const api = await app.inject({ method: "GET", url: "/v1/api/wompi/banks", headers: wrong });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(INVALID);
    expect(api.json()).toEqual(INVALID);
  });

  it("reaches the trigger with the right token and still returns the signed webhook", async () => {
    const app = simulator(TOKEN);

    const res = await trigger(app, await wompiTransaction(app), { authorization: `Bearer ${TOKEN}` });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "WEBHOOK_TARGET_NOT_CONFIGURED", delivered: false });
    expect(res.json().webhook.headers["x-event-checksum"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the rest of /v1/sim exempt: the gateway mocks answer without the token", async () => {
    const app = simulator(TOKEN);
    const id = await wompiTransaction(app);

    const res = await app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` });

    expect(res.statusCode).toBe(200);
  });

  /*
   * Cada variante o la enruta Fastify al trigger —y entonces tiene que exigir el token— o no
   * la enruta y responde 404. Lo que no puede pasar es llegar al handler sin token: eso se ve
   * en un 400, 409 o 200 y en un `webhook` en el cuerpo.
   */
  it.each([
    ["a trailing slash", "/v1/sim/webhooks/trigger/"],
    ["a query string", "/v1/sim/webhooks/trigger?x=1"],
    ["an empty query string", "/v1/sim/webhooks/trigger?"],
    ["a fragment-like query", "/v1/sim/webhooks/trigger?/v1/sim/wompi"],
    ["a leading double slash", "//v1/sim/webhooks/trigger"],
    ["an inner double slash", "/v1/sim//webhooks/trigger"],
    ["upper case", "/V1/SIM/WEBHOOKS/TRIGGER"],
    ["mixed case in the protected segment", "/v1/sim/Webhooks/trigger"],
    ["a percent-encoded letter", "/v1/sim/%77ebhooks/trigger"],
    ["a percent-encoded slash", "/v1/sim%2Fwebhooks/trigger"],
    ["a dot segment", "/v1/sim/wompi/../webhooks/trigger"],
    ["a semicolon parameter", "/v1/sim/webhooks;x=1/trigger"],
  ])("%s (%s) cannot reach the trigger without the token", async (_label, url) => {
    const app = simulator(TOKEN);
    const transactionId = await wompiTransaction(app);

    const res = await trigger(app, transactionId, {}, url);

    expect([401, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain("x-event-checksum");
  });

  /*
   * `inject` normaliza la URL antes de que llegue a Fastify (resuelve `..`). Un cliente HTTP
   * real la manda tal cual, así que estas variantes se prueban también por un socket.
   */
  it.each([
    ["/v1/sim/wompi/../webhooks/trigger"],
    ["/v1/sim/./webhooks/trigger"],
    ["//v1/sim/webhooks/trigger"],
    ["/v1/sim/webhooks/trigger/"],
    ["/v1/sim/%77ebhooks/trigger"],
    ["/v1/sim/webhooks/trigger?x=1"],
  ])("over a real socket, %s cannot reach the trigger without the token", async (rawPath) => {
    const app = simulator(TOKEN);
    const transactionId = await wompiTransaction(app);
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = new URL(base);

    const { statusCode, body } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, method: "POST", path: rawPath, headers: { "content-type": "application/json" } },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ gateway: "wompi", transactionId }));
    });

    expect([401, 404]).toContain(statusCode);
    expect(body).not.toContain("x-event-checksum");
  });

  it("the query string variant is routed to the trigger and gets the 401", async () => {
    const app = simulator(TOKEN);

    const res = await trigger(app, await wompiTransaction(app), {}, "/v1/sim/webhooks/trigger?x=1");

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/sim/webhooks/trigger without API_AUTH_TOKEN", () => {
  it("is open in local development mode, like /v1/api, and warns", async () => {
    const warn = jest.fn();
    const app = buildApp({
      credentialResolver: new CredentialResolver(SERVER_ENV),
      authOptions: { expectedToken: undefined, logger: { warn } },
      webhooks: {},
    });
    openApps.push(app);

    const res = await trigger(app, await wompiTransaction(app));

    expect(res.statusCode).toBe(409);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("API_AUTH_TOKEN no está definido"));
  });
});
