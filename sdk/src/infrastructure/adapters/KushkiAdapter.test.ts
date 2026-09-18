import { KushkiAdapter } from "./KushkiAdapter";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { Gateway } from "../../domain/value-objects/Gateway";
import { expectTransaction } from "../../test-support/payment-result";

describe("KushkiAdapter", () => {
  const originalFetch = global.fetch;

  const validRequest: CreatePaymentRequest = {
    amount: new Amount("50000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-12345"),
    payer: new Payer({ email: "cliente@example.com" }),
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("createPayment()", () => {
    it("should successfully create an approved payment", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();
      const transaction = expectTransaction(
        await adapter.createPayment(validRequest),
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/kushki/charges",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: "simulated-token",
            trackingCode: "ord-12345",
            amount: {
              subtotalIva0: 50000,
              subtotalIva: 0,
              iva: 0,
              ice: 0,
              currency: "COP",
            },
            contactDetails: {
              email: "cliente@example.com",
            },
          }),
        },
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe(
        "kushki-mock-tx-123",
      );
      expect(transaction.gatewayTransactionId.gateway).toBe(
        Gateway.KUSHKI,
      );
      expect(transaction.amount.getValue()).toBe("50000");
      expect(transaction.currency.getCode()).toBe("COP");
    });

    it("should normalize a declined transaction even when HTTP status is successful", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        // El rechazo de negocio llega como HTTP 200; el Adapter debe leer
        // transaction_status y no asumir una aprobación porque response.ok.
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-declined-tx-123",
          transaction_status: "DECLINED",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();
      const transaction = expectTransaction(
        await adapter.createPayment(validRequest),
      );

      expect(transaction.isApproved()).toBe(false);
      expect(transaction.getStatus()).toBe("DECLINED");
      expect(transaction.gatewayTransactionId.value).toBe(
        "kushki-declined-tx-123",
      );
      expect(transaction.gatewayTransactionId.gateway).toBe(
        Gateway.KUSHKI,
      );
    });

    it("should normalize INITIALIZED as PENDING", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-pending-tx-123",
          transaction_status: "INITIALIZED",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();
      const transaction = expectTransaction(
        await adapter.createPayment(validRequest),
      );

      expect(transaction.getStatus()).toBe("PENDING");
      expect(transaction.isPending()).toBe(true);
      expect(transaction.isApproved()).toBe(false);
    });

    it("should send the full Kushki amount breakdown", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();

      await adapter.createPayment({
        ...validRequest,
        amount: new Amount("50000.00"),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.amount).toEqual({
        subtotalIva0: 50000,
        subtotalIva: 0,
        iva: 0,
        ice: 0,
        currency: "COP",
      });
    });

    it("should use the provided tax breakdown", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 0,
            subtotalIva: 42000,
            iva: 8000,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const { TaxBreakdown } = await import(
        "../../domain/value-objects/TaxBreakdown"
      );

      const adapter = new KushkiAdapter();

      await adapter.createPayment({
        ...validRequest,
        amount: new Amount("50000"),
        taxBreakdown: TaxBreakdown.fromComponents({
          subtotalIva0: new Amount("0"),
          subtotalIva: new Amount("42000"),
          iva: new Amount("8000"),
          currency: new Currency("COP"),
        }),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.amount).toEqual({
        subtotalIva0: 0,
        subtotalIva: 42000,
        iva: 8000,
        ice: 0,
        currency: "COP",
      });
    });

    it("should use the private merchant id when credentials are provided", async () => {
      const credentials = {
        publicKey: "pub_test_kushki",
        privateKey: "prv_test_kushki",
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter(undefined, credentials);

      await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/kushki/charges",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            "Private-Merchant-Id": "prv_test_kushki",
          },
        }),
      );
    });

    it("should throw when the tax breakdown does not match the payment amount", async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const { TaxBreakdown } = await import(
        "../../domain/value-objects/TaxBreakdown"
      );

      const adapter = new KushkiAdapter();

      await expect(
        adapter.createPayment({
          ...validRequest,
          taxBreakdown: TaxBreakdown.fromComponents({
            subtotalIva0: new Amount("10000"),
            subtotalIva: new Amount("0"),
            iva: new Amount("0"),
            currency: new Currency("COP"),
          }),
        }),
      ).rejects.toThrow();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    /*
     * Regresión: el adaptador no enviaba la referencia del comercio, y el
     * normalizador tomaba el `transactionReference` que genera Kushki como si lo
     * fuera. El comercio recibía de vuelta un identificador que nunca envió.
     * Este caso devuelve a propósito un `transactionReference` distinto de la
     * referencia de la orden, que es lo que hace la pasarela real.
     */
    it("should keep the merchant order reference instead of the Kushki one", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 150000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "kushki-generated-2f9c41",
          trackingCode: "ord-12345",
          contactDetails: { email: "cliente@example.com" },
        }),
      });

      global.fetch = mockFetch;

      const transaction = expectTransaction(
        await new KushkiAdapter().createPayment(validRequest),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.trackingCode).toBe("ord-12345");

      expect(transaction.orderReference.getValue()).toBe("ord-12345");
      expect(transaction.payer.email).toBe("cliente@example.com");
    });
  });

  describe("getStatus()", () => {
    it("should return a normalized transaction", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();

      const transaction = await adapter.getStatus(
        "kushki-mock-tx-123",
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/kushki/charges/kushki-mock-tx-123",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe(
        "kushki-mock-tx-123",
      );
      expect(transaction.gatewayTransactionId.gateway).toBe(
        Gateway.KUSHKI,
      );
    });
  });
});
