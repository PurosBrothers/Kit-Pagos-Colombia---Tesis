import * as http from "http";
import { AddressInfo } from "net";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { resetSimulatorState } from "../src/store/GatewayStores";
import { WebhookDispatchConfig } from "../src/webhooks/webhookDispatch";

/**
 * `POST /v1/sim/webhooks/trigger` (issue #122, paso 7; issue #130, bloque 1).
 *
 * El simulador firma con el perfil del servidor, y el receptor es `POST /v1/api/webhooks/:gateway`
 * de otra instancia con los mismos secretos: es la prueba de compatibilidad con el verificador
 * del SDK instalado, que es quien decide si la firma vale.
 */

const SERVER_ENV: Record<string, string> = {
  WOMPI_PUBLIC_KEY: "pub_test_server",
  WOMPI_PRIVATE_KEY: "prv_test_server",
  WOMPI_EVENTS_SECRET: "test_events_server",
  MERCADOPAGO_PUBLIC_KEY: "TEST-public-server",
  MERCADOPAGO_ACCESS_TOKEN: "TEST-access-server",
  MERCADOPAGO_WEBHOOK_SECRET: "mp_webhook_server",
  KUSHKI_PUBLIC_MERCHANT_ID: "kushki_public_server",
  KUSHKI_PRIVATE_MERCHANT_ID: "kushki_private_server",
  KUSHKI_WEBHOOK_SECRET: "kushki_webhook_server",
  RAPYD_API_ACCESS_KEY: "rapyd_access_server",
  RAPYD_API_SECRET_KEY: "rapyd_secret_server",
  RAPYD_WEBHOOK_URL: "https://comercio.example.com/webhooks/rapyd",
};

const REJECTED_BODY = { code: "WEBHOOK_SIGNATURE_INVALID", message: "Invalid webhook signature" };

let receiver: FastifyInstance;
let receiverBase: string;
const openApps: FastifyInstance[] = [];

function simulator(webhooks: Partial<WebhookDispatchConfig>, env: Record<string, string> = SERVER_ENV) {
  const app = buildApp({ credentialResolver: new CredentialResolver(env), webhooks });
  openApps.push(app);
  return app;
}

const towardsReceiver = () => ({ targetUrl: `${receiverBase}/v1/api/webhooks/{gateway}` });

beforeAll(async () => {
  receiver = buildApp({ credentialResolver: new CredentialResolver(SERVER_ENV), webhooks: {} });
  receiverBase = await receiver.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  resetSimulatorState();
});

afterAll(async () => {
  await receiver.close();
});

let sequence = 0;
const nextRef = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

/** Un cobro de cada pasarela creado por `/v1/sim`, y su identificador nativo. */
const CREATE: Record<string, (app: FastifyInstance) => Promise<string>> = {
  async wompi(app) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: {
        amount_in_cents: 5000000,
        currency: "COP",
        reference: nextRef("W"),
        customer_email: "comprador@example.com",
        payment_method: { type: "CARD", token: "tok_test_wompi_card_123", installments: 1 },
      },
    });
    return res.json().data.id;
  },
  async mercadopago(app) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/payments",
      headers: { "x-idempotency-key": nextRef("IDEM") },
      payload: {
        transaction_amount: 50000,
        token: "tok_test_card_456",
        description: "Compra",
        installments: 1,
        payment_method_id: "visa",
        payer: { email: "comprador@example.com" },
      },
    });
    return String(res.json().id);
  },
  async kushki(app) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sim/kushki/card/v1/charges",
      payload: {
        token: "tok_kushki_webhook",
        amount: { subtotalIva0: 50000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
      },
    });
    return res.json().ticketNumber;
  },
  async rapyd(app) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sim/rapyd/payments",
      payload: { amount: "50000.00", currency: "COP", payment_method: { type: "co_visa_card" } },
    });
    return res.json().data.id;
  },
};

const KUSHKI_TRANSFER_AMOUNT = { subtotalIva0: 50000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" };

/** El token de una transferencia de Kushki (PSE), todavía sin iniciar. */
async function kushkiTransferToken(app: FastifyInstance, scenario?: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/tokens",
    headers: scenario ? { "x-simulate-scenario": scenario } : {},
    payload: {
      amount: KUSHKI_TRANSFER_AMOUNT,
      bankId: "0001",
      callbackUrl: "https://comercio.example.com/retorno",
      userType: "0",
      documentType: "CC",
      documentNumber: "1020304050",
      paymentDescription: nextRef("KT"),
      email: "pagador@example.com",
      currency: "COP",
    },
  });
  return res.json().token;
}

/** Una transferencia de Kushki iniciada: el pagador ya salió hacia el banco. */
async function initiatedKushkiTransfer(app: FastifyInstance, scenario?: string): Promise<string> {
  const token = await kushkiTransferToken(app, scenario);
  await app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/init",
    payload: { token, amount: KUSHKI_TRANSFER_AMOUNT },
  });
  return token;
}

const trigger = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/sim/webhooks/trigger", payload: payload as Record<string, unknown> });

interface ReturnedWebhook {
  method: string;
  query: string | null;
  headers: Record<string, string>;
  body: string;
}

/** Envía al receptor, por `inject`, un webhook devuelto por el trigger. */
function replay(gateway: string, webhook: ReturnedWebhook, body = webhook.body) {
  return receiver.inject({
    method: "POST",
    url: `/v1/api/webhooks/${gateway}${webhook.query ? `?${webhook.query}` : ""}`,
    headers: { ...webhook.headers, "content-type": "application/json" },
    payload: body,
  });
}

/** Cambia un carácter del identificador dentro del cuerpo: un byte que la firma cubre. */
function alterIdByte(body: string, id: string): string {
  const altered = id.slice(0, -1) + (id.endsWith("0") ? "1" : "0");
  expect(body).toContain(id);
  return body.replace(id, altered);
}

describe("POST /v1/sim/webhooks/trigger: the signed webhook reaches /v1/api/webhooks/:gateway", () => {
  it.each(Object.keys(CREATE))(
    "%s: delivered and accepted; one altered byte of a signed field is rejected",
    async (gateway) => {
      const app = simulator(towardsReceiver());
      const transactionId = await CREATE[gateway](app);

      const res = await trigger(app, { gateway, transactionId });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ delivered: true, receiverStatus: 200 });
      const webhook: ReturnedWebhook = res.json().webhook;
      expect(webhook.method).toBe("POST");

      const accepted = await replay(gateway, webhook);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().gatewayTransactionId).toBe(transactionId);

      const tampered = await replay(gateway, webhook, alterIdByte(webhook.body, transactionId));
      expect(tampered.statusCode).toBe(401);
      expect(tampered.json()).toEqual(REJECTED_BODY);
    },
  );

  /*
   * https://docs.kushki.com/co/notifications/one-time-payments/webhook-card/ (consultada el 7
   * de octubre de 2026) lista los dos campos aparte, y en sus ejemplos tienen valores distintos.
   */
  it("kushki: ticket_number carries the ticket and transaction_id is a distinct, stable 18-digit id", async () => {
    const app = simulator(towardsReceiver());
    const ticket = await CREATE.kushki(app);

    const bodyOf = async () =>
      JSON.parse((await trigger(app, { gateway: "kushki", transactionId: ticket })).json().webhook.body);
    const first = await bodyOf();
    const second = await bodyOf();

    expect(first.ticket_number).toBe(ticket);
    expect(first.transaction_id).toMatch(/^\d{18}$/);
    expect(first.transaction_id).not.toBe(ticket);
    expect(second.transaction_id).toBe(first.transaction_id);
  });

  /*
   * https://docs.kushki.com/co/notifications/one-time-payments/webhook-transfer-in/ (consultada el
   * 7 de octubre de 2026, igual en la versión en inglés): el webhook de transferencia trae
   * `ticketNumber` en camelCase y el estado en `status`, sin `transaction_id` ni
   * `transaction_status`.
   */
  it("kushki transfer: the trigger closes the initiated transfer and notifies it with the documented body", async () => {
    const app = simulator(towardsReceiver());
    const token = await initiatedKushkiTransfer(app);

    const res = await trigger(app, { gateway: "kushki", transactionId: token });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ delivered: true, receiverStatus: 200 });
    const webhook: ReturnedWebhook = res.json().webhook;
    const body = JSON.parse(webhook.body);
    expect(body).toMatchObject({
      token,
      status: "approvedTransaction",
      amount: KUSHKI_TRANSFER_AMOUNT,
      currency: "COP",
      bankId: "0001",
      documentType: "CC",
      documentNumber: "1020304050",
      email: "pagador@example.com",
      callbackUrl: "https://comercio.example.com/retorno",
    });
    expect(body.ticketNumber).toMatch(/^\d{16}$/);
    expect(typeof body.completedAt).toBe("number");
    expect(body.amount).not.toHaveProperty("extraTaxes");
    expect(body).not.toHaveProperty("responseCode");
    expect(body).not.toHaveProperty("responseText");
    expect(body.trazabilityCode).toMatch(/^\d+$/);
    expect(body).not.toHaveProperty("transaction_id");
    expect(body).not.toHaveProperty("transaction_status");

    const accepted = await replay("kushki", webhook);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      eventType: "transaction.updated",
      gateway: "kushki",
      gatewayTransactionId: token,
      newStatus: "APPROVED",
    });

    const tampered = await replay("kushki", webhook, alterIdByte(webhook.body, token));
    expect(tampered.statusCode).toBe(401);
  });

  /*
   * El ejemplo declinado de la misma página trae `responseCode` y `responseText` y no trae
   * `ticketNumber`.
   */
  it("kushki transfer: a declined transfer carries the decline code and no ticketNumber", async () => {
    const app = simulator(towardsReceiver());
    const token = await initiatedKushkiTransfer(app, "DECLINED");

    const res = await trigger(app, { gateway: "kushki", transactionId: token });

    expect(res.statusCode).toBe(200);
    const webhook: ReturnedWebhook = res.json().webhook;
    const body = JSON.parse(webhook.body);
    expect(body).toMatchObject({
      token,
      status: "declinedTransaction",
      responseCode: "T003",
      responseText: "Monto inválido",
    });
    expect(body).not.toHaveProperty("ticketNumber");
    expect(body).not.toHaveProperty("trazabilityCode");

    const accepted = await replay("kushki", webhook);
    expect(accepted.statusCode).toBe(200);
  });

  it("kushki transfer: the approved webhook carries the trazabilityCode the init returned", async () => {
    const app = simulator(towardsReceiver());
    const token = await kushkiTransferToken(app);
    const init = await app.inject({
      method: "POST",
      url: "/v1/sim/kushki/transfer/v1/init",
      payload: { token, amount: KUSHKI_TRANSFER_AMOUNT },
    });

    const res = await trigger(app, { gateway: "kushki", transactionId: token });
    const body = JSON.parse(res.json().webhook.body);

    expect(body.trazabilityCode).toBe(init.json().trazabilityCode);
  });

  /*
   * Wompi firma solo los campos de `signature.properties`, y Mercado Pago solo el manifiesto
   * (`data.id` del query, `x-request-id` y `ts`). Un byte fuera de eso no cambia la firma:
   * es el diseño de las dos pasarelas, no un defecto del simulador.
   */
  it.each([
    ["wompi", '"environment":"test"', '"environment":"tesT"'],
    ["mercadopago", '"live_mode":false', '"live_mode":true'],
  ])("%s: a byte outside the signed fields is not detected, by the gateway's design", async (gateway, from, to) => {
    const app = simulator(towardsReceiver());
    const transactionId = await CREATE[gateway](app);
    const webhook: ReturnedWebhook = (await trigger(app, { gateway, transactionId })).json().webhook;

    expect(webhook.body).toContain(from);
    const res = await replay(gateway, webhook, webhook.body.replace(from, to));

    expect(res.statusCode).toBe(200);
  });

  it("Mercado Pago PSE: an order notification carries only data.id in the query, like the payment one", async () => {
    const app = simulator(towardsReceiver());
    const created = await app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/orders",
      headers: { "x-idempotency-key": nextRef("IDEM") },
      payload: {
        type: "online",
        external_reference: nextRef("MPO"),
        total_amount: "50000",
        processing_mode: "automatic",
        transactions: { payments: [{ amount: "50000", payment_method: { id: "pse", type: "bank_transfer" } }] },
        payer: { email: "pagador@example.com" },
      },
    });
    const transactionId = created.json().id;

    const res = await trigger(app, { gateway: "mercadopago", transactionId });

    expect(res.json()).toMatchObject({ delivered: true, receiverStatus: 200 });
    expect(res.json().webhook.query).toBe(`data.id=${transactionId}&type=order`);
    expect(JSON.parse(res.json().webhook.body).type).toBe("order");
  });
});

describe("Wompi card 4111: created PENDING, ends DECLINED and is notified without a GET", () => {
  it("the trigger advances the transaction and the webhook says DECLINED", async () => {
    const app = simulator(towardsReceiver());
    const token = (
      await app.inject({
        method: "POST",
        url: "/v1/sim/wompi/tokens/cards",
        headers: { authorization: "Bearer pub_test_server" },
        payload: { number: "4111111111111111", cvc: "123", exp_month: "12", exp_year: "30", card_holder: "Pedro Perez" },
      })
    ).json().data.id;
    const created = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: {
        amount_in_cents: 5000000,
        currency: "COP",
        reference: nextRef("W4111"),
        customer_email: "comprador@example.com",
        payment_method: { type: "CARD", token, installments: 1 },
      },
    });
    expect(created.json().data.status).toBe("PENDING");
    const transactionId = created.json().data.id;

    const res = await trigger(app, { gateway: "wompi", transactionId });
    const event = await replay("wompi", res.json().webhook);

    expect(res.json()).toMatchObject({ delivered: true, receiverStatus: 200 });
    expect(JSON.parse(res.json().webhook.body).data.transaction.status).toBe("DECLINED");
    expect(event.json()).toMatchObject({ gatewayTransactionId: transactionId, newStatus: "DECLINED" });
  });
});

describe("the target comes only from the server configuration", () => {
  it.each([
    [{ url: "http://169.254.169.254/latest/meta-data" }],
    [{ targetUrl: "http://127.0.0.1:1/" }],
    [{ transactionId: "http://attacker.example/hook" }],
    [{ gateway: "https://attacker.example" }],
  ])("rejects %o with 400 and never fetches", async (override) => {
    const app = simulator(towardsReceiver());
    const transactionId = await CREATE.wompi(app);
    const fetchSpy = jest.spyOn(globalThis, "fetch");

    const res = await trigger(app, { gateway: "wompi", transactionId, ...override });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_REQUEST");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without a configured target answers 409 with the webhook to replay, and does not fetch", async () => {
    const app = simulator({});
    const transactionId = await CREATE.kushki(app);
    const fetchSpy = jest.spyOn(globalThis, "fetch");

    const res = await trigger(app, { gateway: "kushki", transactionId });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "WEBHOOK_TARGET_NOT_CONFIGURED", delivered: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await replay("kushki", res.json().webhook)).statusCode).toBe(200);
  });

  it.each([
    ["ftp://comercio.example.com/hook"],
    ["not a url"],
    ["https://user:pass@comercio.example.com/hook"],
  ])("refuses to start with SIMULATOR_WEBHOOK_TARGET_URL %s", (targetUrl) => {
    expect(() => buildApp({ webhooks: { targetUrl } })).toThrow("SIMULATOR_WEBHOOK_TARGET_URL");
  });

  it("reads the target from SIMULATOR_WEBHOOK_TARGET_URL when buildApp gets no override", async () => {
    const previous = process.env.SIMULATOR_WEBHOOK_TARGET_URL;
    process.env.SIMULATOR_WEBHOOK_TARGET_URL = `${receiverBase}/v1/api/webhooks/{gateway}`;
    try {
      const app = buildApp({ credentialResolver: new CredentialResolver(SERVER_ENV) });
      openApps.push(app);
      const transactionId = await CREATE.rapyd(app);

      const res = await trigger(app, { gateway: "rapyd", transactionId });

      expect(res.json()).toMatchObject({ delivered: true, receiverStatus: 200 });
    } finally {
      if (previous === undefined) delete process.env.SIMULATOR_WEBHOOK_TARGET_URL;
      else process.env.SIMULATOR_WEBHOOK_TARGET_URL = previous;
    }
  });
});

describe("what the trigger cannot do", () => {
  it("answers 404 for a transaction the simulator does not have", async () => {
    const app = simulator(towardsReceiver());

    const res = await trigger(app, { gateway: "wompi", transactionId: "no-such-transaction" });

    expect(res.statusCode).toBe(404);
  });

  it("answers 400 for an unknown gateway or a missing transactionId", async () => {
    const app = simulator(towardsReceiver());

    expect((await trigger(app, { gateway: "paypal", transactionId: "x" })).statusCode).toBe(400);
    expect((await trigger(app, { gateway: "wompi" })).statusCode).toBe(400);
    const notAnObject = await app.inject({
      method: "POST",
      url: "/v1/sim/webhooks/trigger",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(["wompi", "x"]),
    });
    expect(notAnObject.statusCode).toBe(400);
  });

  it("answers 409 when the server has no secret for that gateway, and does not fetch", async () => {
    const withoutWompiSecret = { ...SERVER_ENV };
    delete withoutWompiSecret.WOMPI_EVENTS_SECRET;
    const app = simulator(towardsReceiver(), withoutWompiSecret);
    const transactionId = await CREATE.wompi(app);
    const fetchSpy = jest.spyOn(globalThis, "fetch");

    const res = await trigger(app, { gateway: "wompi", transactionId });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("WEBHOOK_SECRET_NOT_CONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /*
   * La página del webhook de transferencia lo describe «cuando se complete un pago con
   * transferencia»: un token que todavía no se inició no tiene nada que notificar.
   */
  it("answers 409 for an event Kushki does not notify: a transfer whose token was not initiated", async () => {
    const app = simulator(towardsReceiver());
    const token = await kushkiTransferToken(app);

    const res = await trigger(app, { gateway: "kushki", transactionId: token });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("WEBHOOK_EVENT_NOT_DOCUMENTED");
  });

  it("answers 502 when the target does not answer within the timeout", async () => {
    const silent = http.createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as AddressInfo;
    try {
      const app = simulator({ targetUrl: `http://127.0.0.1:${port}/hook`, timeoutMs: 100 });
      const transactionId = await CREATE.wompi(app);

      const res = await trigger(app, { gateway: "wompi", transactionId });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ code: "WEBHOOK_DELIVERY_FAILED", delivered: false });
      expect(res.json().webhook.body).toContain(transactionId);
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
