import { KitPagos } from "./KitPagos";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";
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

    it("should throw SdkError(INVALID_CREDENTIALS) when the active gateway has no credentials", async () => {
      const kitPagos = new KitPagos({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.KUSHKI]: wompiCredentials },
      });

      await expect(kitPagos.createPayment(validRequest)).rejects.toThrow(SdkError);

      try {
        await kitPagos.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.INVALID_CREDENTIALS);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
      }
    });

    it("should throw SdkError(UNSUPPORTED_OPERATION) for a gateway without an Adapter yet", async () => {
      const kitPagos = new KitPagos({
        gateway: Gateway.RAPYD,
        credentials: { [Gateway.RAPYD]: wompiCredentials },
      });

      try {
        await kitPagos.createPayment(validRequest);
        fail("Should have thrown SdkError");
      } catch (error) {
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.RAPYD);
      }
    });

    it("should propagate SdkError(CONNECTION_FAILED) when the gateway is unreachable", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      try {
        await buildConfiguredSdk().createPayment(validRequest);
        fail("Should have thrown SdkError");
      } catch (error) {
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.CONNECTION_FAILED);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
      }
    });
  });

  describe("getPaymentStatus()", () => {
    it("should propagate SdkError(UNSUPPORTED_OPERATION), since the Wompi mock has no status endpoint", async () => {
      try {
        await buildConfiguredSdk().getPaymentStatus("wompi-tx-abc-123");
        fail("Should have thrown SdkError");
      } catch (error) {
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
        expect(sdkError.message).toContain("status query is not supported");
      }
    });
  });

  describe("validateWebhook()", () => {
    it("should still be a stub, out of scope for the simulated payment example", () => {
      expect(() => buildConfiguredSdk().validateWebhook("{}", {})).toThrow(
        "KitPagos.validateWebhook aun no esta implementado"
      );
    });
  });
});
