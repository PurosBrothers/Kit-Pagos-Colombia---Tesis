import { SdkConfigurator, SDKOptions } from "./SDKConfigurator";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";

describe("SDKConfigurator", () => {
  let configurator: SdkConfigurator;

  const wompiCredentials: Credentials = {
    publicKey: "pub_test_wompi_123",
    privateKey: "prv_test_wompi_456",
  };

  const rapydCredentials: Credentials = {
    publicKey: "pub_test_rapyd_abc",
    privateKey: "prv_test_rapyd_def",
  };

  beforeEach(() => {
    configurator = new SdkConfigurator();
  });

  describe("getActiveGateway()", () => {
    it("debe lanzar un Error si se consulta la pasarela activa antes de configurar", () => {
      expect(() => configurator.getActiveGateway()).toThrow(
        "No se ha configurado ninguna pasarela activa"
      );
    });

    it("debe retornar la pasarela configurada", () => {
      const options: SDKOptions = {
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: wompiCredentials,
        },
      };

      configurator.configure(options);
      expect(configurator.getActiveGateway()).toBe(Gateway.WOMPI);
    });

    it("debe permitir cambiar de pasarela activa reconfigurando", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
      });
      expect(configurator.getActiveGateway()).toBe(Gateway.WOMPI);

      configurator.configure({
        gateway: Gateway.RAPYD,
        credentials: { [Gateway.RAPYD]: rapydCredentials },
      });
      expect(configurator.getActiveGateway()).toBe(Gateway.RAPYD);
    });
  });

  describe("configure()", () => {
    it("debe lanzar SdkError si falta el objeto gateway o credentials", () => {
      const invalidOptions = {
        gateway: undefined as unknown as Gateway,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
      };

      expect(() => configurator.configure(invalidOptions)).toThrow(SdkError);
      try {
        configurator.configure(invalidOptions);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.INVALID_REQUEST);
      }
    });
  });

  describe("getCredentials()", () => {
    it("debe retornar las credenciales de la pasarela configurada", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: wompiCredentials,
          [Gateway.RAPYD]: rapydCredentials,
        },
      });

      const creds = configurator.getCredentials(Gateway.WOMPI);
      expect(creds).toEqual(wompiCredentials);
      expect(configurator.getCredentials(Gateway.RAPYD)).toEqual(rapydCredentials);
    });

    it("debe lanzar SdkError(INVALID_CREDENTIALS) si la pasarela solicitada no tiene credenciales", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: wompiCredentials,
        },
      });

      expect(() => configurator.getCredentials(Gateway.MERCADOPAGO)).toThrow(SdkError);

      try {
        configurator.getCredentials(Gateway.MERCADOPAGO);
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.code).toBe(SdkErrorCode.INVALID_CREDENTIALS);
        expect(sdkError.gateway).toBe(Gateway.MERCADOPAGO);
        expect(sdkError.originalPayload).toBeNull();
      }
    });

    it("RF-08: nunca debe incluir valores de credenciales ni secretos en el mensaje de error", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: wompiCredentials,
        },
      });

      try {
        configurator.getCredentials(Gateway.KUSHKI);
        fail("Deberia haber lanzado SdkError");
      } catch (error) {
        expect(error).toBeInstanceOf(SdkError);
        const sdkError = error as SdkError;
        expect(sdkError.message).not.toContain(wompiCredentials.publicKey);
        expect(sdkError.message).not.toContain(wompiCredentials.privateKey);
        expect(sdkError.message).toContain("KUSHKI");
      }
    });
  });
});
