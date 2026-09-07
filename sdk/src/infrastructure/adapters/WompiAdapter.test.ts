import * as crypto from "crypto";
import { WompiAdapter } from "./WompiAdapter";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { Gateway } from "../../domain/value-objects/Gateway";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";

describe("WompiAdapter", () => {
  const originalFetch = global.fetch;

  const validRequest: CreatePaymentRequest = {
    amount: new Amount(50000),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-12345"),
    payer: new Payer({ email: "cliente@example.com" }),
  };

  const approvedWompiMockResponse = {
    data: {
      id: "wompi-mock-tx-123",
      status: "APPROVED",
      amount_in_cents: 5000000,
      currency: "COP",
      reference: "ord-12345",
    },
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("createPayment()", () => {
    it("should successfully create a payment and return an approved Transaction", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter();
      const transaction = await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/wompi/transactions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount_in_cents: 5000000,
            currency: "COP",
            reference: "ord-12345",
            customer_email: "cliente@example.com",
          }),
        }
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("wompi-mock-tx-123");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.WOMPI);
      expect(transaction.amount.getValue()).toBe(50000);
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.orderReference.getValue()).toBe("ord-12345");
    });

    it("should use custom baseUrl when provided in constructor", async () => {
      const customUrl = "https://custom.api.wompi.test/transactions";
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter(customUrl);
      await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        customUrl,
        expect.objectContaining({ method: "POST" })
      );
    });

    it("should throw SdkError(CONNECTION_FAILED) when network fetch fails", async () => {
      const networkError = new Error("ECONNREFUSED connect to localhost:3000");
      global.fetch = jest.fn().mockRejectedValue(networkError);

      const adapter = new WompiAdapter();

      await expect(adapter.createPayment(validRequest)).rejects.toThrow(SdkError);

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.CONNECTION_FAILED);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
        expect(sdkError.message).toContain("Failed to connect to Wompi gateway");
      }
    });

    it("should throw SdkError(GATEWAY_SERVER_ERROR) when HTTP status is not ok", async () => {
      const errorPayload = { error: "Simulated scenario error" };
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => errorPayload,
      });

      const adapter = new WompiAdapter();

      await expect(adapter.createPayment(validRequest)).rejects.toThrow(SdkError);

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.GATEWAY_SERVER_ERROR);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
        expect(sdkError.originalPayload).toEqual(errorPayload);
        expect(sdkError.message).toContain("500");
      }
    });

    it("should fallback to text if error body is not valid JSON", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("Invalid JSON");
        },
        text: async () => "Bad Gateway Error Page",
      });

      const adapter = new WompiAdapter();

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.GATEWAY_SERVER_ERROR);
        expect(sdkError.originalPayload).toBe("Bad Gateway Error Page");
      }
    });

    it("should throw SdkError(MALFORMED_RESPONSE) when successful response JSON cannot be parsed", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
      });

      const adapter = new WompiAdapter();

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.MALFORMED_RESPONSE);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
      }
    });
  });

  describe("getStatus()", () => {
    it("should throw SdkError(UNSUPPORTED_OPERATION) indicating status query is not supported yet", async () => {
      const adapter = new WompiAdapter();

      await expect(adapter.getStatus("some-tx-id")).rejects.toThrow(SdkError);

      try {
        await adapter.getStatus("some-tx-id");
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
        expect(sdkError.message).toContain("status query is not supported");
      }
    });
  });

  describe("verifySignature()", () => {
    it("should return true when webhook signature is valid", () => {
      const adapter = new WompiAdapter();
      const secret = "test_events_secret_wompi";
      const timestamp = 1602113476;
      const transactionId = "1292-1602113476-10985";
      const status = "APPROVED";

      const checksum = crypto
        .createHash("sha256")
        .update(`${transactionId}${status}${timestamp}${secret}`)
        .digest("hex");

      const payload = JSON.stringify({
        event: "transaction.updated",
        data: {
          transaction: { id: transactionId, status },
        },
        timestamp,
        signature: {
          properties: ["data.transaction.id", "data.transaction.status"],
          checksum,
        },
      });

      const headers = { "x-event-checksum": checksum };
      const isValid = adapter.verifySignature(payload, headers, secret);

      expect(isValid).toBe(true);
    });

    it("should return false when webhook signature is invalid", () => {
      const adapter = new WompiAdapter();
      const secret = "test_events_secret_wompi";
      const timestamp = 1602113476;
      const transactionId = "1292-1602113476-10985";
      const status = "APPROVED";

      const payload = JSON.stringify({
        event: "transaction.updated",
        data: {
          transaction: { id: transactionId, status },
        },
        timestamp,
        signature: {
          properties: ["data.transaction.id", "data.transaction.status"],
          checksum: "invalid_checksum",
        },
      });

      const headers = { "x-event-checksum": "wrong_checksum" };
      const isValid = adapter.verifySignature(payload, headers, secret);

      expect(isValid).toBe(false);
    });
  });
});
