import { createHash } from "node:crypto";
import {
  CreatePaymentRequest,
  IncomingWebhook,
  PaymentTechnicalError,
} from "../../src/checkout/PaymentsPort";
import { createWompiPayments as createPayments, WompiPaymentsConfig } from "../../src/payments/wompi";
import * as fs from "node:fs";
import * as path from "node:path";

let tokenizeCard: (card: any, config: any) => Promise<string>;

beforeAll(() => {
  const clientPath = path.resolve(__dirname, "../../src/payments/browser/client.js");
  const code = fs.readFileSync(clientPath, "utf8");
  const factory = new Function("fetch", code.replace("export async function tokenizeCard", "return async function tokenizeCard"));
  tokenizeCard = (card, config) => factory(globalThis.fetch)(card, config);
});

const DEFAULT_INTEGRITY_SECRET = "test_integrity_kit_pagos_simulator";
const EVENTS_SECRET = "events_secret_123";

describe("Wompi payments module (Prototype A - Direct Integration)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const baseConfig: Partial<WompiPaymentsConfig> = {
    baseUrl: "http://localhost:3000/v1/sim/wompi",
    publicKey: "pub_test_dummy",
    privateKey: "prv_test_dummy",
    integritySecret: DEFAULT_INTEGRITY_SECRET,
    eventsSecret: EVENTS_SECRET,
    retryDelayMs: 1,
    pollIntervalMs: 1,
    pollTimeoutMs: 100,
    maxRetries: 2,
    sleep: async () => undefined,
  };

  const address = { streetName: "Calle 10", streetNumber: "5-20", neighborhood: "La Candelaria", city: "Bogotá", zipCode: "111711" };

  const sampleCardRequest: CreatePaymentRequest = {
    gateway: "wompi",
    orderReference: "ORD-001",
    amountInPesos: 50000,
    description: "Camiseta",
    payer: {
      fullName: "Carlos Gomez",
      email: "carlos@example.com",
      documentType: "CC",
      documentNumber: "1020304050",
      phone: "3001234567",
      address,
    },
    payerIp: "190.24.1.10",
    method: {
      type: "CARD",
      cardToken: "tok_test_123",
      installments: 1,
    },
    returnUrl: "http://localhost:4000/orders/ORD-001",
  };

  const samplePseRequest: CreatePaymentRequest = {
    gateway: "wompi",
    orderReference: "ORD-002",
    amountInPesos: 75000,
    description: "Suscripción",
    payer: {
      fullName: "Maria Perez",
      email: "maria@example.com",
      documentType: "CC",
      documentNumber: "987654321",
      phone: "3109876543",
      address,
    },
    payerIp: "190.24.1.10",
    method: {
      type: "PSE",
      bankCode: "1007",
      personType: "NATURAL",
    },
    returnUrl: "http://localhost:4000/orders/ORD-002",
  };

  describe("publicConfig()", () => {
    it("should return public key and base URL from configuration", () => {
      const payments = createPayments(baseConfig);
      expect(payments.publicConfig()).toEqual({
        publicKey: "pub_test_dummy",
        baseUrl: "http://localhost:3000/v1/sim/wompi",
      });
    });

    it("should fallback to environment variables when config is not provided", () => {
      const prevBase = process.env.WOMPI_BASE_URL;
      const prevKey = process.env.WOMPI_PUBLIC_KEY;
      try {
        process.env.WOMPI_BASE_URL = "http://env-base.test/v1";
        process.env.WOMPI_PUBLIC_KEY = "pub_env_key";
        const payments = createPayments();
        expect(payments.publicConfig()).toEqual({
          publicKey: "pub_env_key",
          baseUrl: "http://env-base.test/v1",
        });
      } finally {
        process.env.WOMPI_BASE_URL = prevBase;
        process.env.WOMPI_PUBLIC_KEY = prevKey;
      }
    });
  });

  describe("the environment of the skeleton", () => {
    const names = [
      "WOMPI_BASE_URL",
      "WOMPI_PUBLIC_KEY",
      "WOMPI_PRIVATE_KEY",
      "WOMPI_INTEGRITY_SECRET",
      "CHECKOUT_ENVIRONMENT",
      "CHECKOUT_SIMULATOR_URL",
    ];
    const sandboxKeys = {
      WOMPI_PUBLIC_KEY: "pub_test_x",
      WOMPI_PRIVATE_KEY: "prv_test_x",
      WOMPI_INTEGRITY_SECRET: "test_integrity_x",
    };

    // Deja solo estas variables y devuelve las de antes, borrando las que no existían.
    function withEnv(values: Record<string, string>, run: () => void): void {
      const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
      for (const name of names) delete process.env[name];
      Object.assign(process.env, values);
      try {
        run();
      } finally {
        for (const name of names) {
          if (saved[name] === undefined) delete process.env[name];
          else process.env[name] = saved[name];
        }
      }
    }

    it("should charge in Wompi's official sandbox by default", () => {
      withEnv(sandboxKeys, () => {
        expect(createPayments().publicConfig().baseUrl).toBe("https://sandbox.wompi.co/v1");
      });
    });

    it("should charge in the simulator's Wompi routes when the environment is the simulator", () => {
      withEnv({ CHECKOUT_ENVIRONMENT: "simulator", CHECKOUT_SIMULATOR_URL: "http://localhost:3000/" }, () => {
        expect(createPayments().publicConfig().baseUrl).toBe("http://localhost:3000/v1/sim/wompi");
      });
    });

    it("should stop at start-up when the sandbox keys are missing, naming them", () => {
      withEnv({ WOMPI_PUBLIC_KEY: "pub_test_x" }, () => {
        expect(() => createPayments()).toThrow(/WOMPI_PRIVATE_KEY, WOMPI_INTEGRITY_SECRET/);
      });
    });

    it("should not ask for the sandbox keys when WOMPI_BASE_URL says where to charge", () => {
      withEnv({ WOMPI_BASE_URL: "http://localhost:3000/v1/sim/wompi" }, () => {
        expect(() => createPayments()).not.toThrow();
      });
    });
  });

  describe("listPseBanks()", () => {
    it("should list financial institutions and map them to PseBankOption[]", async () => {
      const mockBanks = [
        { financial_institution_code: "1", financial_institution_name: "Banco que aprueba" },
        { financial_institution_code: "2", financial_institution_name: "Banco que declina" },
      ];

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: mockBanks }),
      } as Response);

      const payments = createPayments(baseConfig);
      const banks = await payments.listPseBanks();

      expect(banks).toEqual([
        { code: "1", name: "Banco que aprueba" },
        { code: "2", name: "Banco que declina" },
      ]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/wompi/pse/financial_institutions",
        expect.objectContaining({
          method: "GET",
          headers: { Authorization: "Bearer pub_test_dummy" },
        }),
      );
    });

    it("should retry on 503 and succeed if subsequent attempt passes", async () => {
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          return { ok: false, status: 503, statusText: "Service Unavailable" } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ financial_institution_code: "1", financial_institution_name: "Banco OK" }],
          }),
        } as Response;
      });

      const payments = createPayments(baseConfig);
      const banks = await payments.listPseBanks();

      expect(callCount).toBe(2);
      expect(banks).toEqual([{ code: "1", name: "Banco OK" }]);
    });

    it("should throw PaymentTechnicalError when 5xx persists past maxRetries", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      const payments = createPayments(baseConfig);
      await expect(payments.listPseBanks()).rejects.toThrow(PaymentTechnicalError);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("should throw PaymentTechnicalError on network error after retries", async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));

      const payments = createPayments(baseConfig);
      await expect(payments.listPseBanks()).rejects.toThrow(PaymentTechnicalError);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("should throw standard Error on 401 client error without retrying", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { reason: "Llave no válida" } }),
      } as Response);

      const payments = createPayments(baseConfig);
      await expect(payments.listPseBanks()).rejects.toThrow(/Llave no válida/);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("should throw PaymentTechnicalError if response data is not an array", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "not-an-array" }),
      } as Response);

      const payments = createPayments(baseConfig);
      await expect(payments.listPseBanks()).rejects.toThrow(PaymentTechnicalError);
    });
  });

  describe("createPayment()", () => {
    const mockAcceptance = (token = "acc_test_token") => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          presigned_acceptance: {
            acceptance_token: token,
            permalink: "http://localhost:3000/v1/sim/wompi/terms",
          },
        },
      }),
    });

    it("should create a card payment with acceptance token and integrity signature", async () => {
      let createPayload: any;
      globalThis.fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
        if (url.includes("/merchants/")) {
          return mockAcceptance();
        }
        if (url.endsWith("/transactions")) {
          createPayload = JSON.parse(opts.body);
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: "tx-wompi-card-1",
                status: "PENDING",
                amount_in_cents: 5000000,
                reference: "ORD-001",
              },
            }),
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const payments = createPayments(baseConfig);
      const snapshot = await payments.createPayment(sampleCardRequest);

      expect(snapshot).toEqual({
        transactionId: "tx-wompi-card-1",
        status: "PENDING",
        nativeStatus: "PENDING",
        redirectUrl: undefined,
      });

      // Validar monto en centavos y firma de integridad
      expect(createPayload.amount_in_cents).toBe(5000000);
      expect(createPayload.currency).toBe("COP");
      expect(createPayload.reference).toBe("ORD-001");
      expect(createPayload.acceptance_token).toBe("acc_test_token");

      const expectedSignature = createHash("sha256")
        .update(`ORD-0015000000COP${DEFAULT_INTEGRITY_SECRET}`)
        .digest("hex");
      expect(createPayload.signature).toBe(expectedSignature);
      expect(createPayload.payment_method).toEqual({
        type: "CARD",
        token: "tok_test_123",
        installments: 1,
      });
    });

    it("should create a PSE payment and poll until async_payment_url appears", async () => {
      let pollCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("/merchants/")) {
          return mockAcceptance();
        }
        if (url.endsWith("/transactions")) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: "tx-pse-100",
                status: "PENDING",
                amount_in_cents: 7500000,
                reference: "ORD-002",
                payment_method: { type: "PSE", extra: {} },
              },
            }),
          };
        }
        if (url.includes("/transactions/tx-pse-100")) {
          pollCount++;
          if (pollCount === 1) {
            // Primera consulta: todavía sin URL
            return {
              ok: true,
              status: 200,
              json: async () => ({
                data: {
                  id: "tx-pse-100",
                  status: "PENDING",
                  payment_method: { type: "PSE", extra: {} },
                },
              }),
            };
          }
          // Segunda consulta: publica la URL de redirección
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: "tx-pse-100",
                status: "PENDING",
                payment_method: {
                  type: "PSE",
                  extra: { async_payment_url: "http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=100" },
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const payments = createPayments(baseConfig);
      const snapshot = await payments.createPayment(samplePseRequest);

      expect(snapshot).toEqual({
        transactionId: "tx-pse-100",
        status: "PENDING",
        nativeStatus: "PENDING",
        redirectUrl: "http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=100",
      });
      expect(pollCount).toBe(2);
    });

    it("should return DECLINED for a business rejection without throwing", async () => {
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("/merchants/")) {
          return mockAcceptance();
        }
        if (url.endsWith("/transactions")) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: "tx-declined-1",
                status: "DECLINED",
                amount_in_cents: 5000000,
                reference: "ORD-001",
              },
            }),
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const payments = createPayments(baseConfig);
      const snapshot = await payments.createPayment(sampleCardRequest);

      expect(snapshot).toEqual({
        transactionId: "tx-declined-1",
        status: "DECLINED",
        nativeStatus: "DECLINED",
        redirectUrl: undefined,
      });
    });

    it("should handle a PSE payment that resolves to DECLINED during polling", async () => {
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("/merchants/")) {
          return mockAcceptance();
        }
        if (url.endsWith("/transactions")) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: "tx-pse-declined",
                status: "PENDING",
                payment_method: { type: "PSE", extra: {} },
              },
            }),
          };
        }
        if (url.includes("/transactions/tx-pse-declined")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: "tx-pse-declined",
                status: "DECLINED",
                status_message: "Transacción RECHAZADA en Sandbox",
                payment_method: {
                  type: "PSE",
                  extra: { async_payment_url: "http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=99" },
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const payments = createPayments(baseConfig);
      const snapshot = await payments.createPayment(samplePseRequest);

      expect(snapshot).toEqual({
        transactionId: "tx-pse-declined",
        status: "DECLINED",
        nativeStatus: "DECLINED",
        redirectUrl: undefined,
      });
    });

    it("should throw PaymentTechnicalError if PSE polling reaches timeout without URL or settled status", async () => {
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("/merchants/")) {
          return mockAcceptance();
        }
        if (url.endsWith("/transactions")) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: "tx-pse-timeout",
                status: "PENDING",
                payment_method: { type: "PSE", extra: {} },
              },
            }),
          };
        }
        if (url.includes("/transactions/tx-pse-timeout")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: "tx-pse-timeout",
                status: "PENDING",
                payment_method: { type: "PSE", extra: {} },
              },
            }),
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      // Con pollTimeoutMs bajo y sleep real para agotar el tiempo
      const payments = createPayments({
        ...baseConfig,
        pollTimeoutMs: 15,
        pollIntervalMs: 5,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });

      await expect(payments.createPayment(samplePseRequest)).rejects.toThrow(PaymentTechnicalError);
    });

    it("should throw PaymentTechnicalError when acceptance token lookup fails technically", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
      } as Response);

      const payments = createPayments(baseConfig);
      await expect(payments.createPayment(sampleCardRequest)).rejects.toThrow(PaymentTechnicalError);
    });

    it("should throw standard Error when acceptance token returns 404", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { reason: "La entidad solicitada no existe" } }),
      } as Response);

      const payments = createPayments(baseConfig);
      await expect(payments.createPayment(sampleCardRequest)).rejects.toThrow(/La entidad solicitada no existe/);
    });

    it("should throw standard Error on 422 validation error at creation", async () => {
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("/merchants/")) return mockAcceptance();
        return {
          ok: false,
          status: 422,
          json: async () => ({
            error: {
              type: "INPUT_VALIDATION_ERROR",
              messages: { signature: ["La firma es inválida"] },
            },
          }),
        };
      });

      const payments = createPayments(baseConfig);
      await expect(payments.createPayment(sampleCardRequest)).rejects.toThrow(/signature/);
    });

    it("should throw PaymentTechnicalError if transaction creation returns 201 without id", async () => {
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("/merchants/")) return mockAcceptance();
        return {
          ok: true,
          status: 201,
          json: async () => ({ data: {} }),
        };
      });

      const payments = createPayments(baseConfig);
      await expect(payments.createPayment(sampleCardRequest)).rejects.toThrow(PaymentTechnicalError);
    });
  });

  describe("getPaymentStatus()", () => {
    it("should return the snapshot with translated status and native status", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "tx-wompi-123",
            status: "APPROVED",
            amount_in_cents: 5000000,
          },
        }),
      } as Response);

      const payments = createPayments(baseConfig);
      const snapshot = await payments.getPaymentStatus("tx-wompi-123");

      expect(snapshot).toEqual({
        transactionId: "tx-wompi-123",
        status: "APPROVED",
        nativeStatus: "APPROVED",
        redirectUrl: undefined,
      });
    });

    it("should translate VOIDED and ERROR to DECLINED", async () => {
      const payments = createPayments(baseConfig);

      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: "tx-voided", status: "VOIDED" } }),
      } as Response);
      const s1 = await payments.getPaymentStatus("tx-voided");
      expect(s1.status).toBe("DECLINED");
      expect(s1.nativeStatus).toBe("VOIDED");

      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: "tx-error", status: "ERROR" } }),
      } as Response);
      const s2 = await payments.getPaymentStatus("tx-error");
      expect(s2.status).toBe("DECLINED");
      expect(s2.nativeStatus).toBe("ERROR");
    });

    it("should include redirectUrl when present in transaction query", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "tx-pse-active",
            status: "PENDING",
            payment_method: {
              type: "PSE",
              extra: { async_payment_url: "https://banco.test/pay" },
            },
          },
        }),
      } as Response);

      const payments = createPayments(baseConfig);
      const snapshot = await payments.getPaymentStatus("tx-pse-active");

      expect(snapshot.redirectUrl).toBe("https://banco.test/pay");
      expect(snapshot.status).toBe("PENDING");
    });

    it("should throw standard Error on 404 not found without retrying", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { type: "NOT_FOUND_ERROR", reason: "La entidad solicitada no existe" } }),
      } as Response);

      const payments = createPayments(baseConfig);
      await expect(payments.getPaymentStatus("tx-inexistente")).rejects.toThrow(/Transacción no encontrada/);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("should throw PaymentTechnicalError when query fails with 500 after retries", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      const payments = createPayments(baseConfig);
      await expect(payments.getPaymentStatus("tx-error-500")).rejects.toThrow(PaymentTechnicalError);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("should throw standard Error on 400 or other 4xx error when querying transaction", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { reason: "Petición inválida" } }),
      } as Response);

      const payments = createPayments(baseConfig);
      await expect(payments.getPaymentStatus("tx-bad-request")).rejects.toThrow(/Petición inválida/);
    });

    it("should throw PaymentTechnicalError if acceptance token response is empty", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { presigned_acceptance: {} } }),
      } as Response);

      const payments = createPayments(baseConfig);
      await expect(payments.createPayment(sampleCardRequest)).rejects.toThrow(PaymentTechnicalError);
    });
  });

  describe("verifyWebhook()", () => {
    const buildWebhookBody = (
      txId: string,
      status: string,
      amountInCents: number,
      timestamp: number,
      secret: string,
    ): string => {
      const checksum = createHash("sha256")
        .update(`${txId}${status}${amountInCents}${timestamp}${secret}`)
        .digest("hex");

      return JSON.stringify({
        event: "transaction.updated",
        data: {
          transaction: {
            id: txId,
            status,
            amount_in_cents: amountInCents,
          },
        },
        environment: "test",
        signature: {
          properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
          checksum,
        },
        timestamp,
        sent_at: new Date(timestamp * 1000).toISOString(),
      });
    };

    it("should verify a valid webhook signature and return WebhookNotification", async () => {
      const now = Math.floor(Date.now() / 1000);
      const rawBody = buildWebhookBody("tx-wh-1", "APPROVED", 5000000, now, EVENTS_SECRET);
      const webhook: IncomingWebhook = {
        rawBody,
        headers: { "content-type": "application/json" },
        query: {},
      };

      const payments = createPayments(baseConfig);
      const notification = await payments.verifyWebhook(webhook);

      expect(notification).toEqual({
        transactionId: "tx-wh-1",
        status: "APPROVED",
        nativeStatus: "APPROVED",
      });
    });

    it("should return null when the checksum does not match", async () => {
      const now = Math.floor(Date.now() / 1000);
      const rawBody = buildWebhookBody("tx-wh-1", "APPROVED", 5000000, now, "wrong_secret");
      const webhook: IncomingWebhook = {
        rawBody,
        headers: { "content-type": "application/json" },
        query: {},
      };

      const payments = createPayments(baseConfig);
      const notification = await payments.verifyWebhook(webhook);

      expect(notification).toBeNull();
    });

    it("should return null when rawBody is empty or invalid JSON", async () => {
      const payments = createPayments(baseConfig);

      expect(await payments.verifyWebhook({ rawBody: "", headers: {}, query: {} })).toBeNull();
      expect(await payments.verifyWebhook({ rawBody: "not-json", headers: {}, query: {} })).toBeNull();
    });

    it("should return null when eventsSecret is not configured", async () => {
      const now = Math.floor(Date.now() / 1000);
      const rawBody = buildWebhookBody("tx-wh-1", "APPROVED", 5000000, now, EVENTS_SECRET);
      const payments = createPayments({ ...baseConfig, eventsSecret: "" });

      expect(await payments.verifyWebhook({ rawBody, headers: {}, query: {} })).toBeNull();
    });

    it("should return null when required webhook fields are missing", async () => {
      const payments = createPayments(baseConfig);

      const noTx = JSON.stringify({ data: {}, signature: { properties: [], checksum: "abc" }, timestamp: 1 });
      expect(await payments.verifyWebhook({ rawBody: noTx, headers: {}, query: {} })).toBeNull();

      const noSig = JSON.stringify({ data: { transaction: { id: "1" } }, timestamp: 1 });
      expect(await payments.verifyWebhook({ rawBody: noSig, headers: {}, query: {} })).toBeNull();
    });
  });

  describe("browser client: tokenizeCard()", () => {
    it("should send formatted card details and return token id", async () => {
      let requestBody: any;
      let authHeader: string | undefined;

      globalThis.fetch = jest.fn().mockImplementation(async (_url: string, opts: any) => {
        requestBody = JSON.parse(opts.body);
        authHeader = opts.headers["Authorization"];
        return {
          ok: true,
          status: 201,
          json: async () => ({
            status: "CREATED",
            data: { id: "tok_sim_card_123", brand: "VISA" },
          }),
        };
      });

      const token = await tokenizeCard(
        {
          number: "4242 4242 4242 4242",
          cvc: "123",
          expMonth: "8",
          expYear: "2029",
          cardHolder: "Juan Gomez",
        },
        { publicKey: "pub_test_dummy", baseUrl: "http://localhost:3000/v1/sim/wompi" },
      );

      expect(token).toBe("tok_sim_card_123");
      expect(authHeader).toBe("Bearer pub_test_dummy");
      expect(requestBody).toEqual({
        number: "4242424242424242",
        cvc: "123",
        exp_month: "08",
        exp_year: "29",
        card_holder: "Juan Gomez",
      });
    });

    it("should throw when publicKey is missing in config", async () => {
      await expect(
        tokenizeCard(
          { number: "4242", cvc: "1", expMonth: "1", expYear: "25", cardHolder: "A" },
          {} as any,
        ),
      ).rejects.toThrow(/falta publicKey/);
    });

    it("should throw when Wompi returns validation messages on 422", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: {
            type: "INPUT_VALIDATION_ERROR",
            messages: { number: ['debe coincidir con el patron "^\\d{12,19}$"'] },
          },
        }),
      } as Response);

      await expect(
        tokenizeCard(
          { number: "42", cvc: "123", expMonth: "12", expYear: "29", cardHolder: "A" },
          { publicKey: "pub_test_dummy" },
        ),
      ).rejects.toThrow(/Wompi rechazó la tokenización: number: debe coincidir/);
    });

    it("should throw when Wompi returns an error reason", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { reason: "Header de autorización no enviado" },
        }),
      } as Response);

      await expect(
        tokenizeCard(
          { number: "4242424242424242", cvc: "123", expMonth: "12", expYear: "29", cardHolder: "A" },
          { publicKey: "pub_test_dummy" },
        ),
      ).rejects.toThrow(/Header de autorización no enviado/);
    });

    it("should throw if response is ok but lacks data.id", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ data: {} }),
      } as Response);

      await expect(
        tokenizeCard(
          { number: "4242424242424242", cvc: "123", expMonth: "12", expYear: "29", cardHolder: "A" },
          { publicKey: "pub_test_dummy" },
        ),
      ).rejects.toThrow(/falta data.id/);
    });
  });
});
