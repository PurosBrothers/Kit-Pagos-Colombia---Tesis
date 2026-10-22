import { createHmac } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { CreatePaymentRequest, PaymentTechnicalError } from "../../src/checkout/PaymentsPort";
import { createMercadoPagoPayments, MercadoPagoPaymentsConfig } from "../../src/payments/mercadopago";

const BASE_URL = "http://localhost:3000/v1/sim/mercadopago";
const WEBHOOK_SECRET = "mp_webhook_secret";

const config: MercadoPagoPaymentsConfig = {
  baseUrl: BASE_URL,
  accessToken: "APP_USR-access",
  publicKey: "APP_USR-public",
  webhookSecret: WEBHOOK_SECRET,
  retryDelayMs: 1,
  sleep: async () => undefined,
};

const payer = {
  fullName: "Pedro Pérez Gómez",
  email: "pedro@example.com",
  documentType: "CC" as const,
  documentNumber: "1020304050",
  phone: "3001234567",
  address: { streetName: "Calle 10", streetNumber: "5-20", neighborhood: "La Candelaria", city: "Bogotá", zipCode: "111711" },
};

const cardRequest: CreatePaymentRequest = {
  gateway: "mercadopago",
  orderReference: "ORD-A1",
  amountInPesos: 68000,
  description: "La Candelaria Cómics · 1 cómic",
  payer,
  method: { type: "CARD", cardToken: "card-token-1", installments: 3 },
  returnUrl: "https://tienda.example/orders/ORD-A1",
  payerIp: "190.24.1.10",
};

const pseRequest: CreatePaymentRequest = {
  ...cardRequest,
  method: { type: "PSE", bankCode: "1051", personType: "NATURAL" },
};

/** Una respuesta JSON como la de `fetch`. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Un `fetch` falso que responde según el método y la ruta, y guarda cada llamada. */
function fakeFetch(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: Array<{ method: string; url: string; init: RequestInit }> = [];
  const fetchMock = jest.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, url, init });
    const route = Object.keys(routes).find((key) => {
      const [routeMethod, routePath] = key.split(" ");
      return routeMethod === method && url.replace(BASE_URL, "").split("?")[0] === routePath;
    });
    if (!route) throw new Error(`Ruta no prevista en la prueba: ${method} ${url}`);
    return routes[route](init);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return calls;
}

const order = (status: string, extra: Record<string, unknown> = {}) => ({ id: "ORDTST01ABC", status, ...extra });

const CARD_LOOKUPS = {
  "GET /card_tokens/card-token-1": () => json(200, { id: "card-token-1", first_six_digits: "401354" }),
  "GET /payment_methods/search": () => json(200, { results: [{ id: "visa", payment_type_id: "credit_card" }] }),
};

describe("Mercado Pago payments module (prototype A, direct integration)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should give the browser the public key and the API root to tokenize", () => {
    expect(createMercadoPagoPayments(config).publicConfig()).toEqual({ publicKey: "APP_USR-public", baseUrl: BASE_URL });
  });

  describe("listPseBanks", () => {
    it("should read the banks nested inside the pse payment method", async () => {
      fakeFetch({
        "GET /payment_methods": () =>
          json(200, [
            { id: "visa", payment_type_id: "credit_card" },
            { id: "pse", financial_institutions: [{ id: "1007", description: "Bancolombia" }, { id: 1051, description: "Davivienda" }] },
          ]),
      });

      await expect(createMercadoPagoPayments(config).listPseBanks()).resolves.toEqual([
        { code: "1007", name: "Bancolombia" },
        { code: "1051", name: "Davivienda" },
      ]);
    });

    it("should return no banks when the account has no PSE", async () => {
      fakeFetch({ "GET /payment_methods": () => json(200, [{ id: "visa" }]) });

      await expect(createMercadoPagoPayments(config).listPseBanks()).resolves.toEqual([]);
    });
  });

  describe("createPayment with a card", () => {
    it("should find the card brand from the token and create an order with it", async () => {
      const calls = fakeFetch({
        ...CARD_LOOKUPS,
        "POST /orders": () => json(201, order("processed")),
      });

      const snapshot = await createMercadoPagoPayments(config).createPayment(cardRequest);

      expect(snapshot).toEqual({ transactionId: "ORDTST01ABC", status: "APPROVED", nativeStatus: "processed" });
      expect(calls[1].url).toBe(`${BASE_URL}/payment_methods/search?public_key=APP_USR-public&bins=401354`);
      const post = calls.find((call) => call.method === "POST")!;
      const headers = post.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer APP_USR-access");
      expect(headers["X-Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.parse(String(post.init.body))).toEqual({
        type: "online",
        processing_mode: "automatic",
        total_amount: "68000",
        external_reference: "ORD-A1",
        payer: { email: payer.email, identification: { type: "CC", number: "1020304050" } },
        transactions: {
          payments: [
            { amount: "68000", payment_method: { id: "visa", type: "credit_card", token: "card-token-1", installments: 3 } },
          ],
        },
      });
    });

    it("should turn the 402 of a failed order into a decline, not an error", async () => {
      fakeFetch({
        ...CARD_LOOKUPS,
        "POST /orders": () => json(402, { errors: [{ code: "failed" }], data: order("failed") }),
      });

      await expect(createMercadoPagoPayments(config).createPayment(cardRequest)).resolves.toEqual({
        transactionId: "ORDTST01ABC",
        status: "DECLINED",
        nativeStatus: "failed",
      });
    });

    it("should refuse a card without a browser token", async () => {
      await expect(
        createMercadoPagoPayments(config).createPayment({ ...cardRequest, method: { type: "CARD", installments: 1 } }),
      ).rejects.toThrow("token del navegador");
    });

    it("should fail with the gateway message on a 400, without retrying", async () => {
      const calls = fakeFetch({
        ...CARD_LOOKUPS,
        "POST /orders": () => json(400, { errors: [{ code: "required_properties", message: "payer is required" }] }),
      });

      const error = await createMercadoPagoPayments(config).createPayment(cardRequest).catch((e) => e);

      expect(error).not.toBeInstanceOf(PaymentTechnicalError);
      expect((error as Error).message).toBe("required_properties: payer is required");
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    });

    it("should retry a 5xx with the same idempotency key, so that a retry cannot charge twice", async () => {
      const calls = fakeFetch({
        ...CARD_LOOKUPS,
        "POST /orders": () => json(503, {}),
      });

      const error = await createMercadoPagoPayments(config).createPayment(cardRequest).catch((e) => e);

      expect(error).toBeInstanceOf(PaymentTechnicalError);
      const keys = calls
        .filter((call) => call.method === "POST")
        .map((call) => (call.init.headers as Record<string, string>)["X-Idempotency-Key"]);
      expect(keys).toHaveLength(3);
      expect(new Set(keys).size).toBe(1);
    });
  });

  describe("createPayment with PSE", () => {
    it("should send the full payer, its IP and the return URL, and hand back the bank URL", async () => {
      const calls = fakeFetch({
        "POST /orders": () =>
          json(201, order("action_required", {
            transactions: { payments: [{ payment_method: { redirect_url: "https://banco.example/pse" } }] },
          })),
      });

      const snapshot = await createMercadoPagoPayments(config).createPayment({ ...pseRequest, payerIp: "::ffff:190.24.1.10" });

      expect(snapshot).toEqual({
        transactionId: "ORDTST01ABC",
        status: "PENDING",
        nativeStatus: "action_required",
        redirectUrl: "https://banco.example/pse",
      });
      const body = JSON.parse(String(calls[0].init.body));
      expect(body.payer).toEqual({
        email: payer.email,
        entity_type: "individual",
        identification: { type: "CC", number: "1020304050" },
        first_name: "Pedro",
        last_name: "Pérez Gómez",
        phone: { area_code: "57", number: "3001234567" },
        address: { street_name: "Calle 10", street_number: "5-20", neighborhood: "La Candelaria", city: "Bogotá", zip_code: "111711" },
      });
      expect(body.transactions.payments[0].payment_method).toEqual({ id: "pse", type: "bank_transfer", financial_institution: "1051" });
      expect(body.additional_info).toEqual({ "payer.ip_address": "190.24.1.10" });
      expect(body.config).toEqual({ online: { callback_url: "https://tienda.example/orders/ORD-A1" } });
    });

    it("should name a company payer as an association and write a local IPv6 as IPv4", async () => {
      const calls = fakeFetch({ "POST /orders": () => json(201, order("action_required")) });

      await createMercadoPagoPayments(config).createPayment({
        ...pseRequest,
        method: { type: "PSE", bankCode: "1051", personType: "LEGAL" },
        payerIp: "::1",
      });

      const body = JSON.parse(String(calls[0].init.body));
      expect(body.payer.entity_type).toBe("association");
      expect(body.additional_info["payer.ip_address"]).toBe("127.0.0.1");
    });

    it("should keep an order born without the bank URL as pending, for the query to settle", async () => {
      fakeFetch({ "POST /orders": () => json(201, order("processing")) });

      await expect(createMercadoPagoPayments(config).createPayment(pseRequest)).resolves.toEqual({
        transactionId: "ORDTST01ABC",
        status: "PENDING",
        nativeStatus: "processing",
      });
    });
  });

  describe("getPaymentStatus", () => {
    it.each([
      ["processed", "APPROVED"],
      ["action_required", "PENDING"],
      ["processing", "PENDING"],
      ["failed", "DECLINED"],
      ["canceled", "DECLINED"],
      ["expired", "DECLINED"],
    ])("should map the order status %s to %s and keep the native one", async (native, expected) => {
      fakeFetch({ "GET /orders/ORDTST01ABC": () => json(200, order(native)) });

      await expect(createMercadoPagoPayments(config).getPaymentStatus("ORDTST01ABC")).resolves.toEqual({
        transactionId: "ORDTST01ABC",
        status: expected,
        nativeStatus: native,
      });
    });
  });

  describe("verifyWebhook", () => {
    const signedHeaders = (dataId: string, requestId = "req-1", ts = "1760000000000", secret = WEBHOOK_SECRET) => ({
      "x-request-id": requestId,
      "x-signature": `ts=${ts},v1=${createHmac("sha256", secret)
        .update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`)
        .digest("hex")}`,
    });
    const rawBody = JSON.stringify({ action: "order.processed", type: "order", data: { id: "ORDTST01ABC" } });

    it("should verify the signature over the URL data.id and then query the order", async () => {
      const calls = fakeFetch({ "GET /orders/ORDTST01ABC": () => json(200, order("processed")) });

      const notification = await createMercadoPagoPayments(config).verifyWebhook({
        rawBody,
        headers: signedHeaders("ORDTST01ABC"),
        query: { "data.id": "ORDTST01ABC", type: "order" },
      });

      expect(notification).toEqual({ transactionId: "ORDTST01ABC", status: "APPROVED", nativeStatus: "processed" });
      expect(calls).toHaveLength(1);
    });

    it("should reject a signature made with another secret", async () => {
      await expect(
        createMercadoPagoPayments(config).verifyWebhook({
          rawBody,
          headers: signedHeaders("ORDTST01ABC", "req-1", "1760000000000", "otro"),
          query: { "data.id": "ORDTST01ABC" },
        }),
      ).resolves.toBeNull();
    });

    it("should reject a body that names another order than the signed URL", async () => {
      await expect(
        createMercadoPagoPayments(config).verifyWebhook({
          rawBody: JSON.stringify({ data: { id: "ORDTST01OTRA" } }),
          headers: signedHeaders("ORDTST01ABC"),
          query: { "data.id": "ORDTST01ABC" },
        }),
      ).resolves.toBeNull();
    });

    it("should accept no webhook without the webhook secret", async () => {
      await expect(
        createMercadoPagoPayments({ ...config, webhookSecret: "" }).verifyWebhook({
          rawBody,
          headers: signedHeaders("ORDTST01ABC"),
          query: { "data.id": "ORDTST01ABC" },
        }),
      ).resolves.toBeNull();
    });

    it("should take a signed notice of a Payments API payment as received without querying", async () => {
      const calls = fakeFetch({});

      const notification = await createMercadoPagoPayments(config).verifyWebhook({
        rawBody: JSON.stringify({ type: "payment", data: { id: "184748322702" } }),
        headers: signedHeaders("184748322702"),
        query: { "data.id": "184748322702", type: "payment" },
      });

      expect(notification).toEqual({ transactionId: "184748322702", status: "PENDING", nativeStatus: "payment" });
      expect(calls).toHaveLength(0);
    });
  });

  describe("tokenizeCard in the browser", () => {
    let tokenizeCard: (card: any, config: any) => Promise<string>;
    beforeAll(() => {
      const code = fs.readFileSync(path.resolve(__dirname, "../../src/payments/browser/client.js"), "utf8");
      const factory = new Function("fetch", code.replace("export async function tokenizeCard", "return async function tokenizeCard"));
      tokenizeCard = (card, publicConfig) => factory(globalThis.fetch)(card, publicConfig);
    });

    const card = { number: "4013 5406 8274 6260", cvc: "123", expMonth: "11", expYear: "30", cardHolder: "APRO Ruiz", docType: "CC", docNumber: "1020304050" };

    it("should post the card to card_tokens with the public key and return the token id", async () => {
      const calls = fakeFetch({ "POST /card_tokens": () => json(201, { id: "tok-mp-1" }) });

      await expect(tokenizeCard(card, { gateway: "mercadopago", publicKey: "APP_USR-public", baseUrl: BASE_URL })).resolves.toBe("tok-mp-1");

      expect(calls[0].url).toBe(`${BASE_URL}/card_tokens?public_key=APP_USR-public`);
      expect(JSON.parse(String(calls[0].init.body))).toEqual({
        card_number: "4013540682746260",
        expiration_month: 11,
        expiration_year: 2030,
        security_code: "123",
        cardholder: { name: "APRO Ruiz", identification: { type: "CC", number: "1020304050" } },
      });
    });

    it("should surface the reason Mercado Pago gives for refusing the card", async () => {
      fakeFetch({ "POST /card_tokens": () => json(400, { cause: [{ code: "E301", description: "invalid card_number" }] }) });

      await expect(tokenizeCard(card, { gateway: "mercadopago", publicKey: "APP_USR-public", baseUrl: BASE_URL })).rejects.toThrow(
        "invalid card_number",
      );
    });
  });
});
