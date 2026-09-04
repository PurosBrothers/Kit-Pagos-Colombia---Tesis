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
    it("debe retornar una instancia de WompiAdapter cuando la pasarela es WOMPI", () => {
      const adapter = factory.create(Gateway.WOMPI);

      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(WompiAdapter);
      expect(typeof adapter.createPayment).toBe("function");
      expect(typeof adapter.getStatus).toBe("function");
      expect(typeof adapter.verifySignature).toBe("function");
    });

    it("debe lanzar SdkError(UNSUPPORTED_OPERATION) para RAPYD", () => {
      expect(() => factory.create(Gateway.RAPYD)).toThrow(SdkError);

      try {
        factory.create(Gateway.RAPYD);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.RAPYD);
        expect(sdkError.originalPayload).toBeNull();
        expect(sdkError.message).toContain("RAPYD");
      }
    });

    it("debe lanzar SdkError(UNSUPPORTED_OPERATION) para MERCADOPAGO", () => {
      expect(() => factory.create(Gateway.MERCADOPAGO)).toThrow(SdkError);

      try {
        factory.create(Gateway.MERCADOPAGO);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.MERCADOPAGO);
        expect(sdkError.originalPayload).toBeNull();
        expect(sdkError.message).toContain("MERCADOPAGO");
      }
    });

    it("debe lanzar SdkError(UNSUPPORTED_OPERATION) para KUSHKI", () => {
      expect(() => factory.create(Gateway.KUSHKI)).toThrow(SdkError);

      try {
        factory.create(Gateway.KUSHKI);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.KUSHKI);
        expect(sdkError.originalPayload).toBeNull();
        expect(sdkError.message).toContain("KUSHKI");
      }
    });

    it("debe lanzar SdkError(UNSUPPORTED_OPERATION) para pasarelas desconocidas (default)", () => {
      const unknownGateway = "UNKNOWN_GATEWAY" as Gateway;

      expect(() => factory.create(unknownGateway)).toThrow(SdkError);

      try {
        factory.create(unknownGateway);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(unknownGateway);
      }
    });
  });
});
