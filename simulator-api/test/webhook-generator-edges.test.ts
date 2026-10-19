import { FastifyBaseLogger, FastifyInstance } from "fastify";
import { Gateway } from "kit-pagos-colombia";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KushkiChargeResponse } from "../src/gateways/kushki/types";
import { MercadoPagoOrderResponse } from "../src/gateways/mercadopago/types";
import { RapydCheckout, RapydPayment } from "../src/gateways/rapyd/types";
import { StateMachine } from "../src/state/StateMachine";
import { startAutoEmission } from "../src/webhooks/autoEmission";
import { OutgoingWebhook, SignatureGenerator } from "../src/webhooks/SignatureGenerator";
import { WebhookDispatcher } from "../src/webhooks/webhookDispatch";

/**
 * Los casos en que el generador no emite, y los eventos de Rapyd que el trigger no alcanza
 * desde un cobro creado por `/v1/sim` (issue #122, paso 7).
 */

const SERVER_ENV: Record<string, string> = {
  KUSHKI_PUBLIC_MERCHANT_ID: "kushki_public_server",
  KUSHKI_PRIVATE_MERCHANT_ID: "kushki_private_server",
  KUSHKI_WEBHOOK_SECRET: "kushki_webhook_server",
  MERCADOPAGO_PUBLIC_KEY: "TEST-public-server",
  MERCADOPAGO_ACCESS_TOKEN: "TEST-access-server",
  MERCADOPAGO_WEBHOOK_SECRET: "mp_webhook_server",
  RAPYD_API_ACCESS_KEY: "rapyd_access_server",
  RAPYD_API_SECRET_KEY: "rapyd_secret_server",
  RAPYD_WEBHOOK_URL: "https://comercio.example.com/webhooks/rapyd",
};

const resolver = new CredentialResolver(SERVER_ENV);
const generator = new SignatureGenerator((gateway) => resolver.getServerCredentials(gateway));

const rapydPayment = (overrides: Partial<RapydPayment>): RapydPayment => ({
  id: "payment_0123456789abcdef0123456789abcdef",
  status: "CLO",
  amount: 50000,
  currency_code: "COP",
  merchant_reference_id: "R-1",
  paid: true,
  receipt_email: "",
  failure_code: "",
  failure_message: "",
  created_at: 1700000000,
  ...overrides,
});

let receiver: FastifyInstance;

beforeAll(async () => {
  receiver = buildApp({ credentialResolver: resolver, webhooks: {} });
  await receiver.ready();
});

afterAll(async () => {
  await receiver.close();
});

const verify = (gateway: string, webhook: OutgoingWebhook) =>
  receiver.inject({
    method: "POST",
    url: `/v1/api/webhooks/${gateway}${webhook.query ? `?${webhook.query}` : ""}`,
    headers: webhook.headers,
    payload: webhook.body,
  });

describe("Rapyd events the SDK translates", () => {
  it.each([
    [{ status: "ERR" as const, paid: false, failure_code: "ERROR_PROCESSING_CARD - [05]" }, "PAYMENT_FAILED", "DECLINED"],
    [{ status: "EXP" as const, paid: false }, "PAYMENT_EXPIRED", "EXPIRED"],
  ])("%o is %s and the SDK reads %s", async (overrides, type, newStatus) => {
    const webhook = generator.generate({ gateway: Gateway.RAPYD, kind: "payment", record: rapydPayment(overrides) });

    expect(JSON.parse(webhook.body).type).toBe(type);
    const res = await verify("rapyd", webhook);
    expect(res.statusCode).toBe(200);
    expect(res.json().newStatus).toBe(newStatus);
  });

  it("a paid checkout is notified with its payment", async () => {
    const checkout: RapydCheckout = {
      id: "checkout_1",
      status: "DON",
      redirect_url: "",
      payment: { id: "payment_1", status: "CLO", paid: true, amount: "50000", currency_code: "COP" },
    };

    const res = await verify("rapyd", generator.generate({ gateway: Gateway.RAPYD, kind: "checkout", record: checkout }));

    expect(res.json()).toMatchObject({ gatewayTransactionId: "payment_1", newStatus: "APPROVED" });
  });
});

describe("events without a documented body are not emitted", () => {
  const notDocumented = { code: "WEBHOOK_EVENT_NOT_DOCUMENTED" };

  it.each([
    ["ACT", { status: "ACT" as const, paid: false }],
    ["REV", { status: "REV" as const }],
    ["unpaid CLO", { status: "CLO" as const, paid: false }],
  ])("Rapyd %s", (_label, overrides) => {
    expect(() =>
      generator.generate({ gateway: Gateway.RAPYD, kind: "payment", record: rapydPayment(overrides) }),
    ).toThrow(expect.objectContaining(notDocumented));
  });

  it("a Rapyd checkout with no payment yet", () => {
    const checkout = {
      id: "checkout_1",
      status: "NEW",
      redirect_url: "",
      payment: { id: null, status: null, amount: "50000", currency_code: "COP" },
    } as RapydCheckout;

    expect(() => generator.generate({ gateway: Gateway.RAPYD, kind: "checkout", record: checkout })).toThrow(
      expect.objectContaining(notDocumented),
    );
  });

  it("a Kushki charge still INITIALIZED", () => {
    const charge = {
      ticketNumber: "123456789012345678",
      transactionReference: "ref",
      details: { transactionStatus: "INITIALIZED" },
    } as KushkiChargeResponse;

    expect(() => generator.generate({ gateway: Gateway.KUSHKI, kind: "charge", record: charge })).toThrow(
      expect.objectContaining(notDocumented),
    );
  });

  it("a Mercado Pago order that is not processed", () => {
    const order = { id: "ORD01", status: "action_required" } as MercadoPagoOrderResponse;

    expect(() => generator.generate({ gateway: Gateway.MERCADOPAGO, kind: "order", record: order })).toThrow(
      expect.objectContaining(notDocumented),
    );
  });

  it("Rapyd without RAPYD_WEBHOOK_URL, because the registered URL is part of the signature", () => {
    const withoutUrl = { ...SERVER_ENV };
    delete withoutUrl.RAPYD_WEBHOOK_URL;
    const bare = new CredentialResolver(withoutUrl);
    const unsigned = new SignatureGenerator((gateway) => bare.getServerCredentials(gateway));

    expect(() => unsigned.generate({ gateway: Gateway.RAPYD, kind: "payment", record: rapydPayment({}) })).toThrow(
      expect.objectContaining({ code: "WEBHOOK_SECRET_NOT_CONFIGURED" }),
    );
  });
});

describe("auto emission by machine", () => {
  const fakeLog = () => ({ info: jest.fn(), warn: jest.fn() }) as unknown as FastifyBaseLogger & {
    info: jest.Mock;
    warn: jest.Mock;
  };

  /** Una máquina de una sola transición, con el nombre de la que se quiere probar. */
  function machineNamed<T extends { status: string }>(name: string, to: string) {
    return new StateMachine<T, string>(
      [{ from: ["FROM"], on: "query", to }],
      { statusOf: (record) => record.status, withStatus: (record, status) => ({ ...record, status }) },
      name,
    );
  }

  afterEach(() => jest.restoreAllMocks());

  it("a Rapyd payment that closes is posted to the target", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const dispatcher = new WebhookDispatcher({ targetUrl: "http://127.0.0.1:9/{gateway}", auto: true, timeoutMs: 1000 });
    const stop = startAutoEmission(generator, dispatcher, fakeLog());
    try {
      machineNamed<RapydPayment>("rapyd.payment", "CLO").transition(rapydPayment({ status: "FROM" as never }), "query");
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      stop();
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://127.0.0.1:9/rapyd");
  });

  it("skips with a warning, without fetching, an event it cannot sign or a machine it does not know", () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const log = fakeLog();
    const dispatcher = new WebhookDispatcher({ targetUrl: "http://127.0.0.1:9/hook", auto: true, timeoutMs: 1000 });
    const stop = startAutoEmission(generator, dispatcher, log);
    try {
      machineNamed("kushki.transfer", "APPROVED").transition({ status: "FROM" }, "query");
      machineNamed("unnamed", "APPROVED").transition({ status: "FROM" }, "query");
    } finally {
      stop();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatchObject({ machine: "kushki.transfer", code: "WEBHOOK_EVENT_NOT_DOCUMENTED" });
  });

  it("warns and stays off when SIMULATOR_WEBHOOK_AUTO is true without a target", () => {
    const log = fakeLog();

    startAutoEmission(generator, new WebhookDispatcher({ auto: true, timeoutMs: 1000 }), log)();

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("SIMULATOR_WEBHOOK_TARGET_URL"));
  });
});
