import { GatewayFactory } from "./GatewayFactory";
import { Gateway } from "../../domain/value-objects/Gateway";
import { WompiAdapter } from "../adapters/WompiAdapter";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";

describe("GatewayFactory", () => {
  let factory: GatewayFactory;

  beforeEach(() => {
    factory = new GatewayFactory();
  });

  describe("create()", () => {
    it("should return an instance of WompiAdapter when gateway is WOMPI", () => {
      const adapter = factory.create(Gateway.WOMPI);

      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(WompiAdapter);
      expect(typeof adapter.createPayment).toBe("function");
      expect(typeof adapter.getStatus).toBe("function");
      expect(typeof adapter.verifySignature).toBe("function");
    });

    it("should hand the resolved credentials and baseUrl over to the Adapter", async () => {
      const originalFetch = global.fetch;
      const customUrl = "http://localhost:4000/v1/sim/wompi/transactions";
      const credentials = {
        publicKey: "pub_test_wompi_123",
        privateKey: "prv_test_wompi_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            id: "wompi-tx-1",
            status: "APPROVED",
            amount_in_cents: 100000,
            currency: "COP",
            reference: "ord-1",
            customer_email: "cliente@example.com",
          },
        }),
      });
      global.fetch = mockFetch;

      const adapter = factory.create(Gateway.WOMPI, credentials, customUrl);
      await adapter.createPayment({
        amount: new Amount(1000),
        currency: new Currency("COP"),
        orderReference: new OrderReference("ord-1"),
        payer: new Payer({ email: "cliente@example.com" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        customUrl,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${credentials.publicKey}`,
          }),
        })
      );

      global.fetch = originalFetch;
    });

    it("should throw SdkError(UNSUPPORTED_OPERATION) for RAPYD", () => {
      expect(() => factory.create(Gateway.RAPYD)).toThrow(SdkError);

      try {
        factory.create(Gateway.RAPYD);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.RAPYD);
        expect(sdkError.originalPayload).toBeNull();
        expect(sdkError.message).toContain("Gateway not supported in this iteration: RAPYD");
      }
    });

    it("should throw SdkError(UNSUPPORTED_OPERATION) for MERCADOPAGO", () => {
      expect(() => factory.create(Gateway.MERCADOPAGO)).toThrow(SdkError);

      try {
        factory.create(Gateway.MERCADOPAGO);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.MERCADOPAGO);
        expect(sdkError.originalPayload).toBeNull();
        expect(sdkError.message).toContain("Gateway not supported in this iteration: MERCADOPAGO");
      }
    });

    it("should throw SdkError(UNSUPPORTED_OPERATION) for KUSHKI", () => {
      expect(() => factory.create(Gateway.KUSHKI)).toThrow(SdkError);

      try {
        factory.create(Gateway.KUSHKI);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.KUSHKI);
        expect(sdkError.originalPayload).toBeNull();
        expect(sdkError.message).toContain("Gateway not supported in this iteration: KUSHKI");
      }
    });

    it("should throw SdkError(UNSUPPORTED_OPERATION) for unknown gateways (default)", () => {
      const unknownGateway = "UNKNOWN_GATEWAY" as Gateway;

      expect(() => factory.create(unknownGateway)).toThrow(SdkError);

      try {
        factory.create(unknownGateway);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(unknownGateway);
        expect(sdkError.message).toContain("Gateway not supported in this iteration: UNKNOWN_GATEWAY");
      }
    });
  });
});
