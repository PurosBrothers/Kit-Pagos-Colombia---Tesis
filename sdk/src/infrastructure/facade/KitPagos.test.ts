import * as crypto from "crypto";
import { KitPagos } from "./KitPagos";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { expectTransaction } from "../../test-support/payment-result";

describe("KitPagos", () => {
  const originalFetch = global.fetch;

  const wompiCredentials: Credentials = {
    publicKey: "pub_test_wompi_123",
    privateKey: "prv_test_wompi_456",
  };

  const validRequest: CreatePaymentRequest = {
    amount: new Amount("150000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ORDER-1042"),
    payer: new Payer({ email: "cliente@example.com" }),
  };

  const approvedWompiResponse = {
    data: {
      id: "wompi-tx-abc-123",
      status: "APPROVED",
      amount_in_cents: 15000000,
      currency: "COP",
      reference: "ORDER-1042",
      customer_email: "cliente@example.com",
    },
  };

  /** Configuración mínima y válida para consumir el mock de la API de Simulación. */
  function buildConfiguredSdk(baseUrl?: string): KitPagos {
    return new KitPagos({
      gateway: Gateway.WOMPI,
      credentials: { [Gateway.WOMPI]: wompiCredentials },
      baseUrl,
    });
  }

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("createPayment()", () => {
    it("should return an approved Transaction, going through the real chain", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiResponse,
      });

      const transaction = expectTransaction(await buildConfiguredSdk().createPayment(validRequest));

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.isFinal()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("wompi-tx-abc-123");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.WOMPI);
      expect(transaction.amount.getValue()).toBe("150000.00");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.orderReference.getValue()).toBe("ORDER-1042");
      // El correo llega desde la respuesta, no desde el relleno del normalizador.
      expect(transaction.payer.email).toBe("cliente@example.com");
    });

    it("should send the configured credentials as a Bearer token to the gateway", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiResponse,
      });
      global.fetch = mockFetch;

      await buildConfiguredSdk().createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${wompiCredentials.publicKey}`,
          },
        })
      );
    });

    it("should target the baseUrl configured by the merchant instead of the default one", async () => {
      // Desde el issue #64 el baseUrl es la raíz de la API, no el endpoint de
      // transacciones: el adaptador le agrega la ruta que corresponda.
      const simulatorRoot = "http://localhost:4000/v1/sim/wompi";
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiResponse,
      });
      global.fetch = mockFetch;

      await buildConfiguredSdk(simulatorRoot).createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        `${simulatorRoot}/transactions`,
        expect.objectContaining({ method: "POST" })
      );
    });

    it("should throw when the SDK was never configured", async () => {
      await expect(new KitPagos().createPayment(validRequest)).rejects.toThrow(
        "No active gateway has been configured"
      );
    });

    it("should throw KitPagosError(INVALID_CREDENTIALS) when the active gateway has no credentials", async () => {
      const kitPagos = new KitPagos({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.KUSHKI]: wompiCredentials },
      });

      await expect(kitPagos.createPayment(validRequest)).rejects.toThrow(KitPagosError);

      try {
        await kitPagos.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
      }
    });

    it("should create a payment through the configured Kushki adapter", async () => {
      const kitPagos = new KitPagos({
        gateway: Gateway.KUSHKI,
        credentials: { [Gateway.KUSHKI]: wompiCredentials },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-ticket-123",
          transaction_status: "APPROVAL",
          amount: { subtotalIva0: 150000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
          transactionReference: "kushki-reference-123",
        }),
      });

      const transaction = expectTransaction(
        await kitPagos.createPayment(validRequest),
      );

      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.KUSHKI);
    });

    it("should propagate KitPagosError(CONNECTION_FAILED) when the gateway is unreachable", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      try {
        await buildConfiguredSdk().createPayment(validRequest);
        fail("Should have thrown KitPagosError");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
      }
    });
  });

  describe("getPaymentStatus()", () => {
    it("should return the normalized Transaction when status query succeeds", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedWompiResponse,
      });
      global.fetch = mockFetch;

      const transaction = await buildConfiguredSdk().getPaymentStatus("wompi-tx-abc-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/wompi/transactions/wompi-tx-abc-123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer ${wompiCredentials.publicKey}`,
          }),
        })
      );
      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("wompi-tx-abc-123");
    });

    it("should propagate KitPagosError(RESOURCE_NOT_FOUND) when transaction is not found", async () => {
      const notFoundPayload = {
        error: {
          type: "NOT_FOUND",
          reason: "Transaction not found",
        },
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => notFoundPayload,
      });

      try {
        await buildConfiguredSdk().getPaymentStatus("non-existent-id");
        fail("Should have thrown KitPagosError");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.RESOURCE_NOT_FOUND);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
      }
    });
  });

  describe("validateWebhook()", () => {
    describe("4 gateways with valid signatures", () => {
      it("should validate and parse a valid Wompi webhook event", () => {
        const timestamp = 1602113476;
        const txId = "wompi-tx-999";
        const status = "APPROVED";
        const secret = wompiCredentials.privateKey;

        const checksum = crypto
          .createHash("sha256")
          .update(`${txId}${status}${timestamp}${secret}`)
          .digest("hex");

        const payload = JSON.stringify({
          event: "transaction.updated",
          data: {
            transaction: { id: txId, status },
          },
          timestamp,
          signature: {
            properties: ["data.transaction.id", "data.transaction.status"],
            checksum,
          },
        });

        const headers = { "x-event-checksum": checksum };
        const sdk = buildConfiguredSdk();

        const event = sdk.validateWebhook(payload, headers);

        expect(event.gateway).toBe(Gateway.WOMPI);
        expect(event.gatewayTransactionId).toBe(txId);
        expect(event.newStatus).toBe("APPROVED");
        expect(event.eventType).toBe("transaction.updated");
      });

      it("should validate and parse a valid Rapyd webhook event", () => {
        const rapydSecret = "rapyd_sec_key_456";
        const rapydAccessKey = "rapyd_access_123";
        const salt = "random_salt_xyz";
        const timestamp = "1727001234";
        const webhookUrl = "https://tienda.example.com/webhooks/rapyd";

        const payload = JSON.stringify({
          type: "PAYMENT_COMPLETED",
          data: {
            id: "rapyd-pay-001",
            status: "CLO",
            paid: true,
          },
        });

        const toSign = webhookUrl + salt + timestamp + rapydAccessKey + rapydSecret + payload;
        const signature = crypto
          .createHmac("sha256", rapydSecret)
          .update(toSign)
          .digest("base64");

        const headers = {
          signature,
          access_key: rapydAccessKey,
          salt,
          timestamp,
          "x-webhook-url": webhookUrl,
        };

        const sdk = new KitPagos({
          gateway: Gateway.RAPYD,
          credentials: {
            [Gateway.RAPYD]: { publicKey: rapydAccessKey, privateKey: rapydSecret },
          },
        });

        const event = sdk.validateWebhook(payload, headers);

        expect(event.gateway).toBe(Gateway.RAPYD);
        expect(event.gatewayTransactionId).toBe("rapyd-pay-001");
        expect(event.newStatus).toBe("APPROVED");
      });

      it("should validate and parse a valid Mercado Pago webhook event", () => {
        const mpSecret = "mp_secret_key_789";
        const dataId = "mp-tx-555";
        const requestId = "req-mp-uuid";
        const ts = "1702500000";

        const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
        const v1 = crypto.createHmac("sha256", mpSecret).update(manifest).digest("hex");

        const payload = JSON.stringify({
          action: "payment.updated",
          status: "approved",
          data: { id: dataId },
        });

        const headers = {
          "x-signature": `ts=${ts},v1=${v1}`,
          "x-request-id": requestId,
        };

        const sdk = new KitPagos({
          gateway: Gateway.MERCADOPAGO,
          credentials: {
            [Gateway.MERCADOPAGO]: { publicKey: "mp_pub", privateKey: mpSecret },
          },
        });

        const event = sdk.validateWebhook(payload, headers);

        expect(event.gateway).toBe(Gateway.MERCADOPAGO);
        expect(event.gatewayTransactionId).toBe(dataId);
        expect(event.newStatus).toBe("APPROVED");
      });

      it("should validate and parse a valid Kushki webhook event", () => {
        const kushkiSecret = "kushki_sig_id_321";
        const kushkiId = "1702500000";

        const payload = JSON.stringify({
          transaction_status: "APPROVAL",
          transaction_id: "kushki-tx-888",
        });

        const signature = crypto
          .createHmac("sha256", kushkiSecret)
          .update(`${payload}.${kushkiId}`)
          .digest("hex");

        const headers = {
          "x-kushki-signature": signature,
          "x-kushki-id": kushkiId,
        };

        const sdk = new KitPagos({
          gateway: Gateway.KUSHKI,
          credentials: {
            [Gateway.KUSHKI]: { publicKey: "kushki_pub", privateKey: kushkiSecret },
          },
        });

        const event = sdk.validateWebhook(payload, headers);

        expect(event.gateway).toBe(Gateway.KUSHKI);
        expect(event.gatewayTransactionId).toBe("kushki-tx-888");
        expect(event.newStatus).toBe("APPROVED");
      });
    });

    describe("security: tampered signatures and data leakage prevention", () => {
      it("should throw KitPagosError(WEBHOOK_SIGNATURE_INVALID) when signature is tampered by a single character", () => {
        const timestamp = 1602113476;
        const txId = "wompi-tx-999";
        const status = "APPROVED";
        const secret = wompiCredentials.privateKey;

        const checksum = crypto
          .createHash("sha256")
          .update(`${txId}${status}${timestamp}${secret}`)
          .digest("hex");

        const payload = JSON.stringify({
          event: "transaction.updated",
          data: {
            transaction: { id: txId, status },
          },
          timestamp,
          signature: {
            properties: ["data.transaction.id", "data.transaction.status"],
            checksum,
          },
        });

        // Alterar un único carácter de la firma
        const tamperedChecksum = (checksum[0] === "a" ? "b" : "a") + checksum.slice(1);
        const headers = { "x-event-checksum": tamperedChecksum };

        const sdk = buildConfiguredSdk();

        expect(() => sdk.validateWebhook(payload, headers)).toThrow(KitPagosError);

        try {
          sdk.validateWebhook(payload, headers);
          fail("Should have thrown KitPagosError");
        } catch (error) {
          const sdkError = error as KitPagosError;
          expect(sdkError.code).toBe(KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID);
          expect(sdkError.gateway).toBe(Gateway.WOMPI);
        }
      });

      it("should not leak the payload or received signature in the KitPagosError instance", () => {
        const payload = JSON.stringify({ secret_sensitive_info: "card-number-1234" });
        const invalidChecksum = "tampered_signature_string_xyz";
        const headers = { "x-event-checksum": invalidChecksum };

        const sdk = buildConfiguredSdk();

        try {
          sdk.validateWebhook(payload, headers);
          fail("Should have thrown KitPagosError");
        } catch (error) {
          const sdkError = error as KitPagosError;
          // Decisión 22: originalPayload debe ser null para no fugar datos sensibles
          expect(sdkError.originalPayload).toBeNull();
          expect(sdkError.message).not.toContain(payload);
          expect(sdkError.message).not.toContain(invalidChecksum);
          expect(sdkError.message).not.toContain("card-number-1234");
        }
      });
    });

    describe("configuration errors", () => {
      it("should throw native Error if no active gateway has been configured", () => {
        const unconfiguredSdk = new KitPagos();
        expect(() => unconfiguredSdk.validateWebhook("{}", {})).toThrow(
          "No active gateway has been configured"
        );
      });

      it("should throw KitPagosError(INVALID_CREDENTIALS) if credentials are not configured for the active gateway", () => {
        const sdkWithoutCreds = new KitPagos({
          gateway: Gateway.WOMPI,
          credentials: {},
        });

        expect(() => sdkWithoutCreds.validateWebhook("{}", {})).toThrow(KitPagosError);

        try {
          sdkWithoutCreds.validateWebhook("{}", {});
          fail("Should have thrown KitPagosError");
        } catch (error) {
          const sdkError = error as KitPagosError;
          expect(sdkError.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
          expect(sdkError.gateway).toBe(Gateway.WOMPI);
        }
      });
    });

    describe("two-step webhook conciliation (Mercado Pago)", () => {
      const mpSecret = "mp_secret_key_789";
      const mpPublicKey = "mp_public_key_123";
      const dataId = "1234567890";
      const requestId = "req-mp-uuid-step";
      const ts = "1702500000";

      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const v1 = crypto.createHmac("sha256", mpSecret).update(manifest).digest("hex");

      // Payload nativo de Mercado Pago: solo incluye action y data.id (sin campo status)
      const nativePayload = JSON.stringify({
        action: "payment.created",
        data: { id: dataId },
      });

      const headers = {
        "x-signature": `ts=${ts},v1=${v1}`,
        "x-request-id": requestId,
      };

      function buildMercadoPagoSdk(baseUrl?: string): KitPagos {
        return new KitPagos({
          gateway: Gateway.MERCADOPAGO,
          credentials: {
            [Gateway.MERCADOPAGO]: { publicKey: mpPublicKey, privateKey: mpSecret },
          },
          baseUrl,
        });
      }

      it("should validate native notification (step 1) and retrieve full transaction via getPaymentStatus (step 2)", async () => {
        const sdk = buildMercadoPagoSdk("http://localhost:3000/v1/sim/mercadopago/payments");

        // Paso 1: Validar firma y parsear la notificación entrante
        const event = sdk.validateWebhook(nativePayload, headers);

        expect(event.gateway).toBe(Gateway.MERCADOPAGO);
        expect(event.gatewayTransactionId).toBe(dataId);
        expect(event.newStatus).toBe("PENDING");
        expect(event.eventType).toBe("payment.created");

        // Paso 2: Conciliación transparente mediante getPaymentStatus(event.gatewayTransactionId)
        const mockFetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            id: Number(dataId),
            status: "approved",
            status_detail: "accredited",
            transaction_amount: 150000.0,
            currency_id: "COP",
            external_reference: "ORDER-MP-99",
            payer: { email: "cliente@example.com" },
          }),
        });
        global.fetch = mockFetch;

        const transaction = await sdk.getPaymentStatus(event.gatewayTransactionId);

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3000/v1/sim/mercadopago/payments/1234567890",
          expect.objectContaining({
            method: "GET",
            headers: expect.objectContaining({
              Authorization: `Bearer ${mpSecret}`,
            }),
          })
        );

        expect(transaction.gatewayTransactionId.value).toBe(dataId);
        expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.MERCADOPAGO);
        expect(transaction.isApproved()).toBe(true);
        expect(transaction.getStatus()).toBe("APPROVED");
        expect(transaction.rawStatus).toBe("approved");
        expect(transaction.amount.getValue()).toBe("150000");
        expect(transaction.currency.getCode()).toBe("COP");
        expect(transaction.orderReference.getValue()).toBe("ORDER-MP-99");
        expect(transaction.payer.email).toBe("cliente@example.com");
      });

      it("should reconcile a rejected payment in step 2 correctly", async () => {
        const sdk = buildMercadoPagoSdk("http://localhost:3000/v1/sim/mercadopago/payments");

        const event = sdk.validateWebhook(nativePayload, headers);
        expect(event.newStatus).toBe("PENDING");

        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            id: Number(dataId),
            status: "rejected",
            status_detail: "cc_rejected_other_reason",
            transaction_amount: 150000.0,
            currency_id: "COP",
            external_reference: "ORDER-MP-99",
            payer: { email: "cliente@example.com" },
          }),
        });

        const transaction = await sdk.getPaymentStatus(event.gatewayTransactionId);

        expect(transaction.isApproved()).toBe(false);
        expect(transaction.getStatus()).toBe("DECLINED");
        expect(transaction.rawStatus).toBe("rejected");
      });
    });
  });

  describe("Retry policy on operations (RetryHandler integration)", () => {
    it("getPaymentStatus() reintenta ante un fallo transitorio de red y se recupera en el siguiente intento", async () => {
      jest.useFakeTimers();
      const sdk = new KitPagos({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
        baseUrl: "http://localhost:3000/v1/sim/wompi",
        maxRetries: 2,
      });

      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("fetch failed");
        }
        return {
          ok: true,
          status: 200,
          json: async () => approvedWompiResponse,
        };
      });

      const promise = sdk.getPaymentStatus("wompi-tx-abc-123");
      await jest.advanceTimersByTimeAsync(2000);
      const transaction = await promise;

      expect(callCount).toBe(2);
      expect(transaction.isApproved()).toBe(true);
      expect(transaction.gatewayTransactionId.value).toBe("wompi-tx-abc-123");

      jest.useRealTimers();
    });

    it("getPaymentStatus() NO reintenta ante un error no transitorio (ej. 404 / RESOURCE_NOT_FOUND)", async () => {
      const sdk = new KitPagos({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
        baseUrl: "http://localhost:3000/v1/sim/wompi",
      });

      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: { type: "NOT_FOUND", reason: "Transaction not found" },
          }),
        };
      });

      await expect(sdk.getPaymentStatus("non-existent-id")).rejects.toThrow(KitPagosError);
      expect(callCount).toBe(1); // Exactamente 1 intento, 0 reintentos
    });

    it("createPayment() NO se reintenta automaticamente ante un error de red por seguridad e idempotencia", async () => {
      const sdk = new KitPagos({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
        baseUrl: "http://localhost:3000/v1/sim/wompi",
      });

      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        throw new Error("fetch failed");
      });

      await expect(sdk.createPayment(validRequest)).rejects.toThrow(KitPagosError);
      expect(callCount).toBe(1); // No reintenta: previene doble cobro
    });
  });
});

