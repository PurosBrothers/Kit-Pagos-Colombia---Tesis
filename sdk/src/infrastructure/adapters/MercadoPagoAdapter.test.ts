import * as crypto from "crypto";
import { MercadoPagoAdapter } from "./MercadoPagoAdapter";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

describe("MercadoPagoAdapter", () => {
  const originalFetch = global.fetch;

  const validRequest: CreatePaymentRequest = {
    amount: new Amount("50000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ORDER-MP-123"),
    payer: new Payer({ email: "cliente.mp@example.com" }),
  };

  const approvedMpResponse = {
    id: 1234567890,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 50000,
    currency_id: "COP",
    description: "ORDER-MP-123",
    external_reference: "ORDER-MP-123",
    payer: { email: "cliente.mp@example.com" },
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("createPayment()", () => {
    it("crea un pago exitosamente enviando transaction_amount en pesos", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      const adapter = new MercadoPagoAdapter();
      const transaction = await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/mercadopago/payments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction_amount: 50000,
            description: "ORDER-MP-123",
            external_reference: "ORDER-MP-123",
            payer: { email: "cliente.mp@example.com" },
          }),
        }
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.gatewayTransactionId.value).toBe("1234567890");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.MERCADOPAGO);
      expect(transaction.amount.getValue()).toBe("50000");
    });

    it("autentica con Bearer token usando privateKey de las credenciales", async () => {
      const credentials = {
        publicKey: "APP_USR_pub_123",
        privateKey: "APP_USR_priv_secret_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      const adapter = new MercadoPagoAdapter(undefined, credentials);
      await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer APP_USR_priv_secret_456",
          },
        })
      );
    });

    it("traduce fallos de red a KitPagosError(CONNECTION_FAILED)", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("fetch failed"));

      const adapter = new MercadoPagoAdapter();
      await expect(adapter.createPayment(validRequest)).rejects.toThrow(KitPagosError);

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
        expect(sdkError.gateway).toBe(Gateway.MERCADOPAGO);
      }
    });

    it("traduce errores HTTP no exitosos a KitPagosError", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: "Invalid credentials" }),
      });

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
        expect(sdkError.gateway).toBe(Gateway.MERCADOPAGO);
      }
    });

    it("traduce respuesta HTTP no exitosa que devuelva texto en vez de JSON", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("Cannot parse JSON");
        },
        text: async () => "Internal Server Error Text",
      });

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
      }
    });

    it("traduce respuesta con JSON malformado a MALFORMED_RESPONSE", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
      }
    });
  });

  describe("getStatus()", () => {
    it("consulta exitosamente el estado de un pago y retorna la Transaction", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      const adapter = new MercadoPagoAdapter();
      const transaction = await adapter.getStatus("1234567890");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/mercadopago/payments/1234567890",
        expect.objectContaining({ method: "GET" })
      );
      expect(transaction.isApproved()).toBe(true);
      expect(transaction.gatewayTransactionId.value).toBe("1234567890");
    });

    it("autentica con Bearer token en getStatus cuando se configuran credenciales", async () => {
      const credentials = {
        publicKey: "APP_USR_pub_123",
        privateKey: "APP_USR_priv_secret_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      const adapter = new MercadoPagoAdapter(undefined, credentials);
      await adapter.getStatus("1234567890");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/mercadopago/payments/1234567890",
        expect.objectContaining({
          headers: {
            Authorization: "Bearer APP_USR_priv_secret_456",
          },
        })
      );
    });

    it("traduce fallos de red en getStatus a KitPagosError", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("network timeout"));

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.getStatus("1234567890");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
      }
    });

    it("traduce error HTTP 404 en getStatus a RESOURCE_NOT_FOUND", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: "Payment not found" }),
      });

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.getStatus("not-found-id");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.RESOURCE_NOT_FOUND);
      }
    });

    it("traduce error HTTP no exitoso con texto plano en getStatus", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("Invalid json");
        },
        text: async () => "Bad Gateway",
      });

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.getStatus("1234567890");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
      }
    });

    it("traduce error de parseo JSON en getStatus a MALFORMED_RESPONSE", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
      });

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.getStatus("1234567890");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
      }
    });
  });

  describe("verifySignature()", () => {
    it("valida correctamente la firma HMAC-SHA256 de Mercado Pago delegando a WebhookVerifier", () => {
      const adapter = new MercadoPagoAdapter();
      const secret = "test_mp_secret_key";
      const dataId = "1234567890";
      const requestId = "req-uuid-123";
      const ts = "1602113476";

      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

      const payload = JSON.stringify({
        action: "payment.created",
        data: { id: dataId },
      });

      const headers = {
        "x-signature": `ts=${ts},v1=${v1}`,
        "x-request-id": requestId,
      };

      const isValid = adapter.verifySignature(payload, headers, secret);
      expect(isValid).toBe(true);
    });
  });
});
