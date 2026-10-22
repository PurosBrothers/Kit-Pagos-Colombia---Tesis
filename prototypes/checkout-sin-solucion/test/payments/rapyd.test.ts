import { createHmac } from "node:crypto";
import { CreatePaymentRequest, PaymentTechnicalError } from "../../src/checkout/PaymentsPort";
import { createRapydPayments, RapydPaymentsConfig } from "../../src/payments/rapyd";

const SIMULATOR_URL = "http://localhost:3000/v1/sim/rapyd";
const SANDBOX_URL = "https://sandboxapi.rapyd.net/v1";
const WEBHOOK_URL = "https://tienda.example/webhooks/rapyd";

const config: RapydPaymentsConfig = {
  baseUrl: SIMULATOR_URL,
  accessKey: "access-key",
  secretKey: "secret-key",
  webhookUrl: WEBHOOK_URL,
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
  gateway: "rapyd",
  orderReference: "ORD-R1",
  amountInPesos: 68000,
  description: "La Candelaria Cómics · 1 cómic",
  payer,
  method: { type: "CARD", installments: 1 },
  returnUrl: "http://localhost:4000/orders/ORD-R1",
  payerIp: "190.24.1.10",
};

const pseRequest: CreatePaymentRequest = {
  ...cardRequest,
  method: { type: "PSE", bankCode: "co_pse_banco_davivienda_bank", personType: "NATURAL" },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(baseUrl: string, routes: Record<string, (init: RequestInit) => Response>) {
  const calls: Array<{ method: string; url: string; init: RequestInit }> = [];
  globalThis.fetch = jest.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, url, init });
    const route = routes[`${method} ${url.replace(baseUrl, "")}`];
    if (!route) throw new Error(`Ruta no prevista en la prueba: ${method} ${url}`);
    return route(init);
  }) as unknown as typeof fetch;
  return calls;
}

const headersOf = (call: { init: RequestInit }) => call.init.headers as Record<string, string>;
const bodyOf = (call: { init: RequestInit }) => JSON.parse(String(call.init.body));
const ok = (data: unknown) => json(200, { status: { status: "SUCCESS" }, data });

/** La fórmula de la documentación, escrita aparte para comparar con lo que manda el módulo. */
function expectedSignature(toSign: string, secret = "secret-key"): string {
  return Buffer.from(createHmac("sha256", secret).update(toSign).digest("hex")).toString("base64");
}

describe("Rapyd payments module (prototype A, direct integration)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should give the browser nothing, since the card is typed in Rapyd's page", () => {
    expect(createRapydPayments(config).publicConfig()).toEqual({});
  });

  it("should sign each request with the method, the path and query, the salt, the timestamp and both keys", async () => {
    const calls = fakeFetch(SIMULATOR_URL, { "GET /payment_methods/country?country=CO": () => ok([]) });

    await createRapydPayments(config).listPseBanks();

    const { salt, timestamp, signature, access_key } = headersOf(calls[0]);
    expect(access_key).toBe("access-key");
    expect(salt).toMatch(/^[0-9a-f]{16}$/);
    expect(signature).toBe(
      expectedSignature(`get/v1/sim/rapyd/payment_methods/country?country=CO${salt}${timestamp}access-keysecret-key`),
    );
  });

  describe("listPseBanks", () => {
    const catalog = [
      { type: "co_visa_card", name: "Visa" },
      { type: "co_pse_banco_davivienda_bank", name: "Banco Davivienda" },
      { type: "co_pse_banco_de_bogota_bank", name: "Banco de Bogotá" },
    ];

    it("should take the co_pse_ methods of the Colombian catalog as the banks", async () => {
      fakeFetch(SIMULATOR_URL, { "GET /payment_methods/country?country=CO": () => ok(catalog) });

      await expect(createRapydPayments(config).listPseBanks()).resolves.toEqual([
        { code: "co_pse_banco_davivienda_bank", name: "Banco Davivienda" },
        { code: "co_pse_banco_de_bogota_bank", name: "Banco de Bogotá" },
      ]);
    });

    it("should keep, in the sandbox, only the banks the sandbox charges", async () => {
      fakeFetch(SANDBOX_URL, { "GET /payment_methods/country?country=CO": () => ok(catalog) });

      await expect(createRapydPayments({ ...config, baseUrl: SANDBOX_URL }).listPseBanks()).resolves.toEqual([
        { code: "co_pse_banco_davivienda_bank", name: "Banco Davivienda" },
      ]);
    });
  });

  describe("createPayment", () => {
    it("should send a card payment to Rapyd's checkout page, limited to cards", async () => {
      const calls = fakeFetch(SIMULATOR_URL, {
        "POST /checkout": () =>
          ok({ id: "checkout_abc", status: "NEW", redirect_url: "https://sandboxcheckout.rapyd.net/?token=checkout_abc" }),
      });

      await expect(createRapydPayments(config).createPayment(cardRequest)).resolves.toEqual({
        transactionId: "checkout_abc",
        status: "PENDING",
        nativeStatus: "NEW",
        redirectUrl: "https://sandboxcheckout.rapyd.net/?token=checkout_abc",
      });
      const body = bodyOf(calls[0]);
      expect(body).toEqual({
        amount: "68000.00",
        currency: "COP",
        country: "CO",
        merchant_reference_id: "ORD-R1",
        payment_method_type_categories: ["card"],
        receipt_email: "pedro@example.com",
        complete_payment_url: "http://localhost:4000/orders/ORD-R1",
        error_payment_url: "http://localhost:4000/orders/ORD-R1",
      });
      const { salt, timestamp, signature, idempotency } = headersOf(calls[0]);
      expect(idempotency).toMatch(/^[0-9a-f-]{36}$/);
      expect(signature).toBe(
        expectedSignature(`post/v1/sim/rapyd/checkout${salt}${timestamp}access-keysecret-key${String(calls[0].init.body)}`),
      );
    });

    it("should create the customer and then the PSE payment with the bank's own method", async () => {
      const calls = fakeFetch(SIMULATOR_URL, {
        "POST /customers": () => ok({ id: "cus_1" }),
        "POST /payments": () => ok({ id: "payment_1", status: "ACT", redirect_url: "https://banco.example/pse" }),
      });

      await expect(createRapydPayments(config).createPayment(pseRequest)).resolves.toEqual({
        transactionId: "payment_1",
        status: "PENDING",
        nativeStatus: "ACT",
        redirectUrl: "https://banco.example/pse",
      });
      expect(bodyOf(calls[0])).toEqual({ name: "Pedro Pérez", email: "pedro@example.com", phone_number: "3001234567" });
      expect(bodyOf(calls[1])).toEqual({
        amount: "68000.00",
        currency: "COP",
        customer: "cus_1",
        payment_method: {
          type: "co_pse_banco_davivienda_bank",
          fields: { customer_identification_type: "CC", customer_identification_number: "1020304050" },
        },
        merchant_reference_id: "ORD-R1",
        complete_payment_url: "http://localhost:4000/orders/ORD-R1",
        error_payment_url: "http://localhost:4000/orders/ORD-R1",
      });
    });

    it("should fail with Rapyd's error code on a 400", async () => {
      fakeFetch(SIMULATOR_URL, {
        "POST /customers": () => ok({ id: "cus_1" }),
        "POST /payments": () => json(400, { status: { status: "ERROR", error_code: "ERROR_GET_GATEWAY", message: "" } }),
      });

      const error = await createRapydPayments(config).createPayment(pseRequest).catch((e) => e);

      expect(error).not.toBeInstanceOf(PaymentTechnicalError);
      expect((error as Error).message).toBe("ERROR_GET_GATEWAY:");
    });

    it("should fail as technical when the resource comes back without the page to redirect to", async () => {
      fakeFetch(SIMULATOR_URL, { "POST /checkout": () => ok({ id: "checkout_abc", status: "NEW" }) });

      await expect(createRapydPayments(config).createPayment(cardRequest)).rejects.toBeInstanceOf(PaymentTechnicalError);
    });
  });

  describe("getPaymentStatus", () => {
    it("should read a checkout nobody has paid as pending", async () => {
      fakeFetch(SIMULATOR_URL, { "GET /checkout/checkout_abc": () => ok({ id: "checkout_abc", status: "NEW", payment: { id: null } }) });

      await expect(createRapydPayments(config).getPaymentStatus("checkout_abc")).resolves.toEqual({
        transactionId: "checkout_abc",
        status: "PENDING",
        nativeStatus: "NEW",
      });
    });

    it("should read the payment inside a paid checkout, and keep the checkout id", async () => {
      fakeFetch(SIMULATOR_URL, {
        "GET /checkout/checkout_abc": () => ok({ id: "checkout_abc", status: "DON", payment: { id: "payment_9", status: "CLO", paid: true } }),
      });

      await expect(createRapydPayments(config).getPaymentStatus("checkout_abc")).resolves.toEqual({
        transactionId: "checkout_abc",
        status: "APPROVED",
        nativeStatus: "CLO",
      });
    });

    it.each([
      ["CLO", true, "APPROVED"],
      ["CLO", false, "DECLINED"],
      ["ACT", false, "PENDING"],
      ["ERR", false, "DECLINED"],
      ["EXP", false, "DECLINED"],
    ])("should map a payment in %s (paid: %s) to %s", async (native, paid, expected) => {
      fakeFetch(SIMULATOR_URL, { "GET /payments/payment_1": () => ok({ id: "payment_1", status: native, paid }) });

      await expect(createRapydPayments(config).getPaymentStatus("payment_1")).resolves.toEqual({
        transactionId: "payment_1",
        status: expected,
        nativeStatus: native,
      });
    });
  });

  describe("verifyWebhook", () => {
    const sign = (rawBody: string, url = WEBHOOK_URL) => {
      const salt = "abcdef0123456789";
      const timestamp = "1760000000";
      return { salt, timestamp, signature: expectedSignature(`${url}${salt}${timestamp}access-keysecret-key${rawBody}`) };
    };

    it.each([
      ["PAYMENT_COMPLETED", "CLO", true, "APPROVED"],
      ["PAYMENT_FAILED", "ERR", false, "DECLINED"],
      ["PAYMENT_EXPIRED", "EXP", false, "DECLINED"],
      // Lo que mandó el sandbox con 3DS: el aviso de cambio, todavía en `ACT`, junto al cierre.
      ["PAYMENT_UPDATED", "ACT", false, "PENDING"],
      ["PAYMENT_UPDATED", "CLO", true, "APPROVED"],
    ])("should verify a %s event in %s (paid: %s) and map it to %s", async (type, status, paid, expected) => {
      const rawBody = JSON.stringify({ type, data: { id: "payment_1", status, paid } });

      await expect(
        createRapydPayments(config).verifyWebhook({ rawBody, headers: sign(rawBody), query: {} }),
      ).resolves.toEqual({ transactionId: "payment_1", status: expected, nativeStatus: status });
    });

    it("should hand back the order a card payment carries, since its id is the payment's and not the checkout's", async () => {
      const rawBody = JSON.stringify({
        type: "PAYMENT_COMPLETED",
        data: { id: "payment_1", status: "CLO", merchant_reference_id: "ORD-1" },
      });

      await expect(
        createRapydPayments(config).verifyWebhook({ rawBody, headers: sign(rawBody), query: {} }),
      ).resolves.toStrictEqual({ transactionId: "payment_1", status: "APPROVED", nativeStatus: "CLO", orderReference: "ORD-1" });
    });

    it("should reject a signature made for another webhook URL, or any notice without the registered URL", async () => {
      const rawBody = JSON.stringify({ type: "PAYMENT_COMPLETED", data: { id: "payment_1", status: "CLO" } });

      await expect(
        createRapydPayments(config).verifyWebhook({ rawBody, headers: sign(rawBody, "https://otra.example/webhook"), query: {} }),
      ).resolves.toBeNull();
      await expect(
        createRapydPayments({ ...config, webhookUrl: "" }).verifyWebhook({ rawBody, headers: sign(rawBody), query: {} }),
      ).resolves.toBeNull();
    });
  });
});
