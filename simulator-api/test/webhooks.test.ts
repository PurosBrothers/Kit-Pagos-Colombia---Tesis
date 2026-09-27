import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { parseToleranceSeconds } from "../src/kit-pagos-api/routes/webhooks";
import {
  SignedWebhook,
  signKushki,
  signMercadoPago,
  signRapyd,
  signWompi,
} from "./helpers/webhookSignatures";

const SERVER_ENV = {
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

const signRapydForServer = (payload?: string) =>
  signRapyd(
    SERVER_ENV.RAPYD_API_SECRET_KEY,
    SERVER_ENV.RAPYD_API_ACCESS_KEY,
    SERVER_ENV.RAPYD_WEBHOOK_URL,
    payload,
  );

const REJECTED_BODY = {
  code: "WEBHOOK_SIGNATURE_INVALID",
  message: "Invalid webhook signature",
};

function buildWebhookApp(env: Record<string, string> = SERVER_ENV): FastifyInstance {
  return buildApp({ credentialResolver: new CredentialResolver(env) });
}

function postWebhook(
  app: FastifyInstance,
  gateway: string,
  webhook: SignedWebhook,
  extraHeaders: Record<string, string> = {},
) {
  return app.inject({
    method: "POST",
    url: `/v1/api/webhooks/${gateway}${webhook.query ? `?${webhook.query}` : ""}`,
    payload: webhook.payload,
    headers: { "content-type": "application/json", ...webhook.headers, ...extraHeaders },
  });
}

describe("POST /v1/api/webhooks/:gateway", () => {
  describe("valid signatures", () => {
    // Mercado Pago no firma el cuerpo, así que su estado se confirma con getPaymentStatus() (punto 69).
    it.each([
      ["wompi", () => signWompi(SERVER_ENV.WOMPI_EVENTS_SECRET), "APPROVED"],
      ["mercadopago", () => signMercadoPago(SERVER_ENV.MERCADOPAGO_WEBHOOK_SECRET), "PENDING"],
      ["kushki", () => signKushki(SERVER_ENV.KUSHKI_WEBHOOK_SECRET), "APPROVED"],
      ["rapyd", () => signRapydForServer(), "APPROVED"],
    ])("should return 200 with the normalized event for %s", async (gateway, sign, newStatus) => {
      const app = buildWebhookApp();

      const res = await postWebhook(app, gateway, sign());

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        gateway,
        eventType: expect.any(String),
        gatewayTransactionId: expect.any(String),
        newStatus,
      });

      await app.close();
    });
  });

  describe("rejections", () => {
    it("should return a generic 401 when the signature is invalid", async () => {
      const app = buildWebhookApp();

      const res = await postWebhook(app, "wompi", signWompi("not_the_server_secret"));

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(REJECTED_BODY);

      await app.close();
    });

    it("should answer a malformed body exactly like an invalid signature", async () => {
      const app = buildWebhookApp();

      const forged = await postWebhook(app, "wompi", signWompi("not_the_server_secret"));
      const malformed = await postWebhook(app, "wompi", {
        payload: "{ this is not json",
        headers: { "x-event-checksum": "abc" },
      });
      const empty = await postWebhook(app, "wompi", { payload: "", headers: {} });

      expect(malformed.statusCode).toBe(forged.statusCode);
      expect(malformed.body).toBe(forged.body);
      expect(empty.statusCode).toBe(forged.statusCode);
      expect(empty.body).toBe(forged.body);

      await app.close();
    });

    it("should reject a notification outside the tolerance window", async () => {
      const app = buildWebhookApp();
      const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

      const res = await postWebhook(
        app,
        "wompi",
        signWompi(SERVER_ENV.WOMPI_EVENTS_SECRET, "APPROVED", oneHourAgo),
      );

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(REJECTED_BODY);

      await app.close();
    });

    it("should read the tolerance window from WEBHOOK_TOLERANCE_SECONDS", async () => {
      const original = process.env.WEBHOOK_TOLERANCE_SECONDS;
      process.env.WEBHOOK_TOLERANCE_SECONDS = "0";
      try {
        const app = buildWebhookApp();
        const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

        const res = await postWebhook(
          app,
          "wompi",
          signWompi(SERVER_ENV.WOMPI_EVENTS_SECRET, "APPROVED", oneHourAgo),
        );

        expect(res.statusCode).toBe(200);
        await app.close();
      } finally {
        if (original === undefined) {
          delete process.env.WEBHOOK_TOLERANCE_SECONDS;
        } else {
          process.env.WEBHOOK_TOLERANCE_SECONDS = original;
        }
      }
    });

    it("should return 400 for an unsupported gateway", async () => {
      const app = buildWebhookApp();

      const res = await postWebhook(app, "paypal", signWompi(SERVER_ENV.WOMPI_EVENTS_SECRET));

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_REQUEST");

      await app.close();
    });
  });

  describe("raw body", () => {
    it("should verify against the exact bytes: reordering the keys breaks the signature", async () => {
      const app = buildWebhookApp();
      const signed = signRapydForServer('{"type":"PAYMENT_COMPLETED","data":{"id":"payment_rapyd_1"}}');
      const reordered = {
        payload: '{"data":{"id":"payment_rapyd_1"},"type":"PAYMENT_COMPLETED"}',
        headers: signed.headers,
      };

      const original = await postWebhook(app, "rapyd", signed);
      const tampered = await postWebhook(app, "rapyd", reordered);

      expect(JSON.parse(reordered.payload)).toEqual(JSON.parse(signed.payload));
      expect(original.statusCode).toBe(200);
      expect(tampered.statusCode).toBe(401);

      await app.close();
    });

    it("should keep whitespace intact, which a re-serialized body would lose", async () => {
      const app = buildWebhookApp();
      const spaced = '{ "transaction_id" : "TX-KUSHKI-1",  "transaction_status" : "APPROVAL" }';

      const res = await postWebhook(
        app,
        "kushki",
        signKushki(SERVER_ENV.KUSHKI_WEBHOOK_SECRET, spaced),
      );

      expect(res.statusCode).toBe(200);

      await app.close();
    });

    it("should not change how the other routes parse JSON", async () => {
      const app = buildWebhookApp();
      app.register(
        async (api: FastifyInstance) => {
          api.post("/echo-type", async (req) => ({ type: typeof req.body }));
        },
        { prefix: "/v1/api" },
      );

      const apiRoute = await app.inject({
        method: "POST",
        url: "/v1/api/echo-type",
        payload: { a: 1 },
      });
      const simRoute = await app.inject({
        method: "POST",
        url: "/v1/sim/wompi/transactions",
        payload: {
          amount_in_cents: 150000,
          currency: "COP",
          reference: "ORDER-RAW-PARSER",
          customer_email: "cliente@example.com",
          payment_method: { type: "CARD", token: "tok_test", installments: 1 },
        },
      });

      expect(apiRoute.json()).toEqual({ type: "object" });
      expect(simRoute.statusCode).toBe(201);

      await app.close();
    });
  });

  describe("where the secret comes from", () => {
    it("should ignore a webhookSecret sent by header", async () => {
      const app = buildWebhookApp();

      const res = await postWebhook(app, "wompi", signWompi("attacker_secret"), {
        "x-gateway-webhook-secret": "attacker_secret",
      });

      expect(res.statusCode).toBe(401);

      await app.close();
    });

    it("should not let client credential headers choose the verification secret", async () => {
      const { WOMPI_EVENTS_SECRET: _omitted, ...envWithoutEventsSecret } = SERVER_ENV;
      const app = buildWebhookApp(envWithoutEventsSecret);

      const res = await postWebhook(app, "wompi", signWompi("prv_test_attacker"), {
        "x-gateway-public-key": "pub_test_attacker",
        "x-gateway-private-key": "prv_test_attacker",
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(REJECTED_BODY);

      await app.close();
    });

    it("should reject when the server has no webhook secret, without falling back to the private key", async () => {
      const { WOMPI_EVENTS_SECRET: _omitted, ...envWithoutEventsSecret } = SERVER_ENV;
      const app = buildWebhookApp(envWithoutEventsSecret);

      const res = await postWebhook(app, "wompi", signWompi(SERVER_ENV.WOMPI_PRIVATE_KEY));

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(REJECTED_BODY);

      await app.close();
    });
  });

  describe("Rapyd webhook URL", () => {
    it("should ignore an x-webhook-url header and verify against RAPYD_WEBHOOK_URL", async () => {
      const app = buildWebhookApp();

      const res = await postWebhook(app, "rapyd", signRapydForServer(), {
        "x-webhook-url": "https://otro-comercio.example.com/webhooks/rapyd",
      });

      expect(res.statusCode).toBe(200);

      await app.close();
    });

    it("should reject with the generic 401 when RAPYD_WEBHOOK_URL is not configured, even if the header supplies it", async () => {
      const { RAPYD_WEBHOOK_URL: _omitted, ...envWithoutUrl } = SERVER_ENV;
      const app = buildWebhookApp(envWithoutUrl);

      const res = await postWebhook(app, "rapyd", signRapydForServer(), {
        "x-webhook-url": SERVER_ENV.RAPYD_WEBHOOK_URL,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(REJECTED_BODY);

      await app.close();
    });
  });

  describe("Mercado Pago data.id from the query string", () => {
    it("should verify an uppercase Orders API id signed in lowercase and report it as sent", async () => {
      const app = buildWebhookApp();
      const orderId = "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3";

      const res = await postWebhook(
        app,
        "mercadopago",
        signMercadoPago(SERVER_ENV.MERCADOPAGO_WEBHOOK_SECRET, undefined, orderId),
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().gatewayTransactionId).toBe(orderId);

      await app.close();
    });

    it("should take the signed data.id from the URL when the body does not carry it", async () => {
      const app = buildWebhookApp();

      const res = await postWebhook(
        app,
        "mercadopago",
        signMercadoPago(SERVER_ENV.MERCADOPAGO_WEBHOOK_SECRET, undefined, "1234567890", null),
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().gatewayTransactionId).toBe("1234567890");

      await app.close();
    });

    it("should reject a body whose data.id differs from the signed one in the URL", async () => {
      const app = buildWebhookApp();

      const res = await postWebhook(
        app,
        "mercadopago",
        signMercadoPago(SERVER_ENV.MERCADOPAGO_WEBHOOK_SECRET, undefined, "1234567890", "9999999999"),
      );

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(REJECTED_BODY);

      await app.close();
    });

    it("should reject a repeated data.id parameter instead of picking one", async () => {
      const app = buildWebhookApp();
      const signed = signMercadoPago(SERVER_ENV.MERCADOPAGO_WEBHOOK_SECRET);

      const res = await postWebhook(app, "mercadopago", {
        ...signed,
        query: `${signed.query}&data.id=9999999999`,
      });

      expect(res.statusCode).toBe(401);

      await app.close();
    });
  });
});

describe("parseToleranceSeconds", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["abc", undefined],
    ["-5", undefined],
    ["1.5", undefined],
    ["0", 0],
    ["600", 600],
  ])("should parse %p as %p", (raw, expected) => {
    expect(parseToleranceSeconds(raw)).toBe(expected);
  });
});
