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

describe("KitPagos", () => {
  const originalFetch = global.fetch;

  const wompiCredentials: Credentials = {
    publicKey: "pub_test_wompi_123",
    privateKey: "prv_test_wompi_456",
  };

  const validRequest: CreatePaymentRequest = {
    amount: new Amount(150000),
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

      const transaction = await buildConfiguredSdk().createPayment(validRequest);

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.isFinal()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("wompi-tx-abc-123");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.WOMPI);
      expect(transaction.amount.getValue()).toBe(150000);
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
      const simulatorUrl = "http://localhost:4000/v1/sim/wompi/transactions";
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiResponse,
      });
      global.fetch = mockFetch;

      await buildConfiguredSdk(simulatorUrl).createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        simulatorUrl,
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

    it("should throw KitPagosError(UNSUPPORTED_OPERATION) for a gateway without an Adapter yet", async () => {
      const kitPagos = new KitPagos({
        gateway: Gateway.RAPYD,
        credentials: { [Gateway.RAPYD]: wompiCredentials },
      });

      try {
        await kitPagos.createPayment(validRequest);
        fail("Should have thrown KitPagosError");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.RAPYD);
      }
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
    it("should propagate KitPagosError(UNSUPPORTED_OPERATION), since the Wompi mock has no status endpoint", async () => {
      try {
        await buildConfiguredSdk().getPaymentStatus("wompi-tx-abc-123");
        fail("Should have thrown KitPagosError");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
        expect(sdkError.message).toContain("status query is not supported");
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
  });
});
