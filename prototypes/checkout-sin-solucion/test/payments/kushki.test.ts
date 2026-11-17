import { createHmac } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { CreatePaymentRequest, PaymentTechnicalError } from "../../src/checkout/PaymentsPort";
import { createKushkiPayments, KushkiPaymentsConfig } from "../../src/payments/kushki";

const BASE_URL = "http://localhost:3000/v1/sim/kushki";
const WEBHOOK_SECRET = "kushki_webhook_secret";

const config: KushkiPaymentsConfig = {
  baseUrl: BASE_URL,
  publicMerchantId: "public-merchant",
  privateMerchantId: "private-merchant",
  webhookSecret: WEBHOOK_SECRET,
  retryDelayMs: 1,
  sleep: async () => undefined,
};

const payer = {
  fullName: "Pedro Pérez",
  email: "pedro@example.com",
  documentType: "CC" as const,
  documentNumber: "1020304050",
  phone: "3001234567",
  address: { streetName: "Calle 10", streetNumber: "5-20", neighborhood: "La Candelaria", city: "Bogotá", zipCode: "111711" },
};

const cardRequest: CreatePaymentRequest = {
  gateway: "kushki",
  orderReference: "ORD-K1",
  amountInPesos: 74000,
  description: "La Candelaria Cómics · 1 cómic",
  payer,
  method: { type: "CARD", cardToken: "a".repeat(32), installments: 1 },
  returnUrl: "http://localhost:4000/orders/ORD-K1",
  payerIp: "190.24.1.10",
};

const pseRequest: CreatePaymentRequest = {
  ...cardRequest,
  method: { type: "PSE", bankCode: "0001", personType: "NATURAL" },
};

const AMOUNT = { subtotalIva0: 74000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: Array<{ method: string; url: string; init: RequestInit }> = [];
  globalThis.fetch = jest.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, url, init });
    const route = routes[`${method} ${url.replace(BASE_URL, "")}`];
    if (!route) throw new Error(`Ruta no prevista en la prueba: ${method} ${url}`);
    return route(init);
  }) as unknown as typeof fetch;
  return calls;
}

const headersOf = (call: { init: RequestInit }) => call.init.headers as Record<string, string>;
const bodyOf = (call: { init: RequestInit }) => JSON.parse(String(call.init.body));

describe("Kushki payments module (prototype D, direct integration)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should give the browser the public merchant id and the API root to tokenize", () => {
    expect(createKushkiPayments(config).publicConfig()).toEqual({ publicKey: "public-merchant", baseUrl: BASE_URL });
  });

  it("should list the banks with the public id and drop the placeholder that heads the list", async () => {
    const calls = fakeFetch({
      "GET /transfer/v1/bankList": () =>
        json(200, [
          { code: "0", name: "A continuación seleccione su banco" },
          { code: "0001", name: "Kushki bank Colombia" },
        ]),
    });

    await expect(createKushkiPayments(config).listPseBanks()).resolves.toEqual([{ code: "0001", name: "Kushki bank Colombia" }]);
    expect(headersOf(calls[0])["Public-Merchant-Id"]).toBe("public-merchant");
    expect(headersOf(calls[0])["Private-Merchant-Id"]).toBeUndefined();
  });

  describe("createPayment with a card", () => {
    it("should charge the token with the private id, the amount as tax parts and the full response", async () => {
      const calls = fakeFetch({
        "POST /card/v1/charges": () =>
          json(201, { ticketNumber: "922513792073660814", details: { transactionStatus: "APPROVAL" } }),
      });

      await expect(createKushkiPayments(config).createPayment(cardRequest)).resolves.toEqual({
        transactionId: "922513792073660814",
        status: "APPROVED",
        nativeStatus: "APPROVAL",
      });
      expect(headersOf(calls[0])["Private-Merchant-Id"]).toBe("private-merchant");
      expect(bodyOf(calls[0])).toEqual({
        token: "a".repeat(32),
        amount: AMOUNT,
        contactDetails: {
          documentType: "CC",
          documentNumber: "1020304050",
          firstName: "Pedro",
          lastName: "Pérez",
          email: "pedro@example.com",
          phoneNumber: "+573001234567",
        },
        metadata: { orderReference: "ORD-K1" },
        fullResponse: true,
      });
    });

    it("should send the installments as months only when there is more than one", async () => {
      const calls = fakeFetch({
        "POST /card/v1/charges": () => json(201, { ticketNumber: "1", details: { transactionStatus: "APPROVAL" } }),
      });

      await createKushkiPayments(config).createPayment({ ...cardRequest, method: { type: "CARD", cardToken: "t", installments: 3 } });

      expect(bodyOf(calls[0]).months).toBe(3);
    });

    it("should map a declined charge to DECLINED", async () => {
      fakeFetch({ "POST /card/v1/charges": () => json(201, { ticketNumber: "2", details: { transactionStatus: "DECLINED" } }) });

      await expect(createKushkiPayments(config).createPayment(cardRequest)).resolves.toMatchObject({ status: "DECLINED" });
    });

    it("should fail with Kushki's code when the amount differs from the one the token was issued for", async () => {
      fakeFetch({
        "POST /card/v1/charges": () => json(400, { code: "K220", message: "Monto de la transacción es diferente al monto de la venta inicial" }),
      });

      const error = await createKushkiPayments(config).createPayment(cardRequest).catch((e) => e);

      expect(error).not.toBeInstanceOf(PaymentTechnicalError);
      expect((error as Error).message).toBe("K220: Monto de la transacción es diferente al monto de la venta inicial");
    });

    it("should refuse a card without a browser token", async () => {
      await expect(
        createKushkiPayments(config).createPayment({ ...cardRequest, method: { type: "CARD", installments: 1 } }),
      ).rejects.toThrow("token del navegador");
    });

    /**
     * La forma medida el 24 de octubre de 2026 con la tarjeta «Sin Fondos» de kushki.md §1 (punto
     * 122): el banco rechaza con 400, el motivo va en `details` y `ticketNumber` llega vacío. Los
     * identificadores son inventados.
     */
    function declinedCharge(responseCode: string, responseText: string): Record<string, unknown> {
      return {
        code: responseCode,
        message: "Transacción declinada.",
        details: { ticketNumber: "", transactionId: "883641052193877226", responseCode, responseText },
        transactionReference: "0b7d5e2a-3c4f-4a8e-9f61-2d0c7b9a4e15",
      };
    }

    it.each([
      ["021", "Tarjeta sin fondos", "INSUFFICIENT_FUNDS"],
      ["017", "Tarjeta no válida", "INVALID_CARD_DATA"],
      ["022", "Imposible verificar cvv", "INVALID_CARD_DATA"],
      ["023", "Tarjeta bloqueada por el banco", "CARD_RESTRICTED"],
      ["019", "Tarjeta no compatible", "UNKNOWN"],
    ])("should take the bank's 400 %s (%s) as a decline with the %s category", async (code, reason, category) => {
      fakeFetch({ "POST /card/v1/charges": () => json(400, declinedCharge(code, reason)) });

      await expect(createKushkiPayments(config).createPayment(cardRequest)).resolves.toEqual({
        transactionId: "883641052193877226",
        status: "DECLINED",
        nativeStatus: "DECLINED",
        declineReason: { code, category },
      });
    });

    it("should use the transactionReference when the decline brings no transactionId", async () => {
      const body = declinedCharge("021", "Tarjeta sin fondos");
      delete (body.details as Record<string, unknown>).transactionId;
      fakeFetch({ "POST /card/v1/charges": () => json(400, body) });

      await expect(createKushkiPayments(config).createPayment(cardRequest)).resolves.toMatchObject({
        transactionId: "0b7d5e2a-3c4f-4a8e-9f61-2d0c7b9a4e15",
      });
    });

    // Medido el mismo día: el K220 también trae `details`, con `responseCode: "K220"`.
    it("should keep the K220 that brings details as an error, not as a decline", async () => {
      const reason = "Monto de la transacción es diferente al monto de la venta inicial";
      fakeFetch({
        "POST /card/v1/charges": () =>
          json(400, { code: "K220", message: reason, details: { ticketNumber: "", transactionId: "1", responseCode: "K220", responseText: reason } }),
      });

      await expect(createKushkiPayments(config).createPayment(cardRequest)).rejects.toThrow(`K220: ${reason}`);
    });
  });

  describe("createPayment with PSE (Transfer In)", () => {
    it("should ask for a transfer token, start it with the amount again and hand back the bank URL", async () => {
      const calls = fakeFetch({
        "POST /transfer/v1/tokens": () => json(201, { token: "b".repeat(32) }),
        "POST /transfer/v1/init": () => json(201, { redirectUrl: "https://api-uat.kushkipagos.com/transfer/v1/agent?token=x" }),
      });

      await expect(createKushkiPayments(config).createPayment(pseRequest)).resolves.toEqual({
        transactionId: "b".repeat(32),
        status: "PENDING",
        nativeStatus: "initializedTransaction",
        redirectUrl: "https://api-uat.kushkipagos.com/transfer/v1/agent?token=x",
      });
      expect(headersOf(calls[0])["Public-Merchant-Id"]).toBe("public-merchant");
      expect(bodyOf(calls[0])).toEqual({
        bankId: "0001",
        callbackUrl: "http://localhost:4000/orders/ORD-K1",
        userType: "0",
        documentType: "CC",
        documentNumber: "1020304050",
        email: "pedro@example.com",
        currency: "COP",
        paymentDescription: "ORD-K1",
        amount: AMOUNT,
      });
      expect(headersOf(calls[1])["Private-Merchant-Id"]).toBe("private-merchant");
      expect(bodyOf(calls[1])).toEqual({ token: "b".repeat(32), amount: AMOUNT });
    });

    it("should mark a company payer as userType 1", async () => {
      const calls = fakeFetch({
        "POST /transfer/v1/tokens": () => json(201, { token: "c".repeat(32) }),
        "POST /transfer/v1/init": () => json(201, { redirectUrl: "https://banco.example" }),
      });

      await createKushkiPayments(config).createPayment({ ...pseRequest, method: { type: "PSE", bankCode: "0001", personType: "LEGAL" } });

      expect(bodyOf(calls[0]).userType).toBe("1");
    });

    it("should fail as technical when the transfer starts without a bank URL", async () => {
      fakeFetch({
        "POST /transfer/v1/tokens": () => json(201, { token: "d".repeat(32) }),
        "POST /transfer/v1/init": () => json(201, {}),
      });

      await expect(createKushkiPayments(config).createPayment(pseRequest)).rejects.toBeInstanceOf(PaymentTechnicalError);
    });
  });

  describe("getPaymentStatus", () => {
    it.each([
      ["initializedTransaction", "PENDING"],
      ["approvedTransaction", "APPROVED"],
      ["declinedTransaction", "DECLINED"],
    ])("should map the transfer status %s to %s", async (native, expected) => {
      fakeFetch({ [`GET /transfer/v1/status/${"e".repeat(32)}`]: () => json(200, { status: native, token: "e".repeat(32) }) });

      await expect(createKushkiPayments(config).getPaymentStatus("e".repeat(32))).resolves.toEqual({
        transactionId: "e".repeat(32),
        status: expected,
        nativeStatus: native,
      });
    });

    it("should take the PSE network code of a declined transfer as its reason", async () => {
      fakeFetch({
        [`GET /transfer/v1/status/${"e".repeat(32)}`]: () =>
          json(200, { status: "declinedTransaction", token: "e".repeat(32), responseCode: "00011" }),
      });

      await expect(createKushkiPayments(config).getPaymentStatus("e".repeat(32))).resolves.toMatchObject({
        status: "DECLINED",
        declineReason: { code: "00011", category: "INSUFFICIENT_FUNDS" },
      });
    });

    it("should explain that a card charge cannot be queried, since Kushki answers 400 for a card ticket", async () => {
      fakeFetch({ "GET /transfer/v1/status/922513792073660814": () => json(400, { code: "T001", message: "Cuerpo de la petición inválido." }) });

      await expect(createKushkiPayments(config).getPaymentStatus("922513792073660814")).rejects.toThrow(
        "Kushki no permite consultar el cobro con tarjeta 922513792073660814",
      );
    });
  });

  describe("verifyWebhook", () => {
    const sign = (rawBody: string, kushkiId: string, secret = WEBHOOK_SECRET) => ({
      "x-kushki-id": kushkiId,
      "x-kushki-signature": createHmac("sha256", secret).update(`${rawBody}.${kushkiId}`).digest("hex"),
    });

    it("should verify a card notice and take its ticket and status", async () => {
      const rawBody = JSON.stringify({ ticket_number: "922513792073660814", transaction_status: "APPROVAL" });

      await expect(
        createKushkiPayments(config).verifyWebhook({ rawBody, headers: sign(rawBody, "1760000000"), query: {} }),
      ).resolves.toEqual({ transactionId: "922513792073660814", status: "APPROVED", nativeStatus: "APPROVAL" });
    });

    it("should verify a transfer notice and take its token and status", async () => {
      const rawBody = JSON.stringify({ token: "f".repeat(32), status: "approvedTransaction", ticketNumber: "123" });

      await expect(
        createKushkiPayments(config).verifyWebhook({ rawBody, headers: sign(rawBody, "1760000000"), query: {} }),
      ).resolves.toEqual({ transactionId: "f".repeat(32), status: "APPROVED", nativeStatus: "approvedTransaction" });
    });

    it("should reject a body changed after signing, and any notice without the secret", async () => {
      const rawBody = JSON.stringify({ ticket_number: "1", transaction_status: "DECLINED" });
      const headers = sign(rawBody, "1760000000");

      await expect(
        createKushkiPayments(config).verifyWebhook({ rawBody: rawBody.replace("DECLINED", "APPROVAL"), headers, query: {} }),
      ).resolves.toBeNull();
      await expect(createKushkiPayments({ ...config, webhookSecret: "" }).verifyWebhook({ rawBody, headers, query: {} })).resolves.toBeNull();
    });
  });

  describe("tokenizeCard in the browser", () => {
    let tokenizeCard: (card: any, config: any) => Promise<string>;
    beforeAll(() => {
      const code = fs.readFileSync(path.resolve(__dirname, "../../src/payments/browser/client.js"), "utf8");
      const factory = new Function("fetch", code.replace("export async function tokenizeCard", "return async function tokenizeCard"));
      tokenizeCard = (card, publicConfig) => factory(globalThis.fetch)(card, publicConfig);
    });

    const card = { number: "4242 4242 4242 4242", cvc: "123", expMonth: "8", expYear: "2030", cardHolder: "Pedro Pérez" };
    const browserConfig = { gateway: "kushki", publicKey: "public-merchant", baseUrl: BASE_URL, amountInPesos: "74000" };

    it("should tokenize for the order total with the public merchant id", async () => {
      const calls = fakeFetch({ "POST /card/v1/tokens": () => json(201, { token: "g".repeat(32) }) });

      await expect(tokenizeCard(card, browserConfig)).resolves.toBe("g".repeat(32));
      expect(headersOf(calls[0])["Public-Merchant-Id"]).toBe("public-merchant");
      expect(bodyOf(calls[0])).toEqual({
        card: { name: "Pedro Pérez", number: "4242424242424242", cvv: "123", expiryMonth: "08", expiryYear: "30" },
        totalAmount: 74000,
        currency: "COP",
      });
    });

    it("should refuse to tokenize without the order total, which Kushki binds to the token", async () => {
      await expect(tokenizeCard(card, { ...browserConfig, amountInPesos: undefined })).rejects.toThrow("monto del cobro");
    });
  });
});
