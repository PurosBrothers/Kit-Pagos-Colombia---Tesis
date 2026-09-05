import { GatewayFactory } from "./GatewayFactory";
import { Gateway } from "../../domain/value-objects/Gateway";
import { WompiAdapter } from "../adapters/WompiAdapter";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";

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
