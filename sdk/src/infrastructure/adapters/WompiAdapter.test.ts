import * as crypto from "crypto";
import { WompiAdapter } from "./WompiAdapter";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

describe("WompiAdapter", () => {
  const originalFetch = global.fetch;

  const validRequest: CreatePaymentRequest = {
    amount: new Amount("50000"),
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
      customer_email: "cliente@example.com",
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
        },
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("wompi-mock-tx-123");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.WOMPI);
      expect(transaction.amount.getValue()).toBe("50000.00");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.orderReference.getValue()).toBe("ord-12345");
    });

    it("sends the amount as a JSON integer of cents, preserving the trailing zero", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter();
      await adapter.createPayment({ ...validRequest, amount: new Amount("19.90") });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // 1990 and not 199 or 19.9: the trailing zero survives to the wire.
      expect(body.amount_in_cents).toBe(1990);
      // Wompi expects an integer, not the string returned by toMinorUnits().
      expect(typeof body.amount_in_cents).toBe("number");
    });

    it("rejects an amount with more decimals than the currency allows", async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const adapter = new WompiAdapter();
      // CLP is a zero-exponent currency: an amount with cents makes no sense
      // and must fail before reaching the network, not be silently truncated.
      await expect(
        adapter.createPayment({
          ...validRequest,
          amount: new Amount("19.99"),
          currency: new Currency("CLP"),
        }),
      ).rejects.toThrow("no cabe en CLP");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should authenticate with the public key as a Bearer token when credentials are given", async () => {
      const credentials = {
        publicKey: "pub_test_wompi_123",
        privateKey: "prv_test_wompi_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter(undefined, credentials);
      await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/wompi/transactions",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer pub_test_wompi_123",
          },
        }),
      );
      // The private key must never travel in the payment creation request.
      expect(JSON.stringify(mockFetch.mock.calls[0])).not.toContain(
        credentials.privateKey,
      );
    });

    it("should omit the Authorization header when no credentials are given, so the mock stays consumable", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      await new WompiAdapter().createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        }),
      );
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
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should throw KitPagosError(CONNECTION_FAILED) when network fetch fails", async () => {
      const networkError = new Error("fetch failed");
      global.fetch = jest.fn().mockRejectedValue(networkError);

      const adapter = new WompiAdapter();
      await expect(adapter.createPayment(validRequest)).rejects.toThrow(KitPagosError);

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
        expect(kitError.message).toContain("Failed to connect to Wompi gateway");
      }
    });

    it("should throw KitPagosError(GATEWAY_SERVER_ERROR) when HTTP status is not ok", async () => {
      const errorPayload = { error: "Simulated scenario error" };
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => errorPayload,
      });

      const adapter = new WompiAdapter();

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
        expect(kitError.originalPayload).toEqual(errorPayload);
        expect(kitError.message).toContain("500");
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
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
        expect(kitError.originalPayload).toBe("Bad Gateway Error Page");
      }
    });

    it("should throw KitPagosError(MALFORMED_RESPONSE) when successful response JSON cannot be parsed", async () => {
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
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
      }
    });
  });

  describe("getStatus()", () => {
    it("returns a normalized Transaction when the id exists in the simulator", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter();
      const transaction = await adapter.getStatus("wompi-mock-tx-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/wompi/transactions/wompi-mock-tx-123",
        expect.objectContaining({ method: "GET" }),
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("wompi-mock-tx-123");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.WOMPI);
      expect(transaction.amount.getValue()).toBe("50000.00");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.orderReference.getValue()).toBe("ord-12345");
    });

    it("includes Authorization header when credentials are provided", async () => {
      const credentials = {
        publicKey: "pub_test_wompi_123",
        privateKey: "prv_test_wompi_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter(undefined, credentials);
      await adapter.getStatus("wompi-mock-tx-123");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("wompi-mock-tx-123"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer pub_test_wompi_123",
          }),
        }),
      );
    });

    it("throws KitPagosError(RESOURCE_NOT_FOUND) when the id does not exist in the simulator", async () => {
      const notFoundPayload = {
        error: {
          type: "NOT_FOUND",
          reason: "Transaction with id 'non-existent-id' does not exist",
        },
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => notFoundPayload,
      });

      const adapter = new WompiAdapter();

      try {
        await adapter.getStatus("non-existent-id");
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.RESOURCE_NOT_FOUND);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
        expect(kitError.originalPayload).toEqual(notFoundPayload);
      }
    });

    it("throws KitPagosError(CONNECTION_FAILED) when the network fails during status query", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("fetch failed"));

      const adapter = new WompiAdapter();

      try {
        await adapter.getStatus("any-id");
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
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