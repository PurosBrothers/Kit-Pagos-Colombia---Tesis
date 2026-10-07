import { SdkConfigurator, SDKOptions } from "./SDKConfigurator";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

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
    it("should throw an Error if active gateway is queried before configuring", () => {
      expect(() => configurator.getActiveGateway()).toThrow(
        "No active gateway has been configured"
      );
    });

    it("should return the configured gateway", () => {
      const options: SDKOptions = {
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: wompiCredentials,
        },
      };

      configurator.configure(options);
      expect(configurator.getActiveGateway()).toBe(Gateway.WOMPI);
    });

    it("should allow changing active gateway by reconfiguring", () => {
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

  describe("getMaxRetries()", () => {
    it("should return undefined when maxRetries is not specified", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
      });
      expect(configurator.getMaxRetries()).toBeUndefined();
    });

    it("should return the configured maxRetries value", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
        maxRetries: 5,
      });
      expect(configurator.getMaxRetries()).toBe(5);
    });
  });

  describe("configure()", () => {
    it("should throw KitPagosError if gateway or credentials are missing", () => {
      const invalidOptions = {
        gateway: undefined as unknown as Gateway,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
      };

      expect(() => configurator.configure(invalidOptions)).toThrow(KitPagosError);
      try {
        configurator.configure(invalidOptions);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
      }
    });
  });

  describe("getTimeoutMs()", () => {
    const base = {
      gateway: Gateway.WOMPI,
      credentials: { [Gateway.WOMPI]: wompiCredentials },
    };

    it("should default to 30000 ms before and after configure() without timeoutMs", () => {
      expect(configurator.getTimeoutMs()).toBe(30_000);
      configurator.configure(base);
      expect(configurator.getTimeoutMs()).toBe(30_000);
    });

    it.each([1, 5_000, 2_147_483_647])("should accept timeoutMs = %p", (timeoutMs) => {
      configurator.configure({ ...base, timeoutMs });
      expect(configurator.getTimeoutMs()).toBe(timeoutMs);
    });

    it("should go back to the default when reconfigured without timeoutMs", () => {
      configurator.configure({ ...base, timeoutMs: 5_000 });
      configurator.configure(base);
      expect(configurator.getTimeoutMs()).toBe(30_000);
    });

    // 2 147 483 648 es el primer valor que Node convierte en un plazo de 1 ms (medido el
    // 6 de octubre de 2026 en Node 20.20.2 y 22.22.3).
    it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648, "1000", null])(
      "should reject timeoutMs = %p with INVALID_REQUEST and keep the previous configuration",
      (timeoutMs) => {
        configurator.configure({ ...base, timeoutMs: 5_000 });
        let thrown: unknown;
        try {
          configurator.configure({
            gateway: Gateway.RAPYD,
            credentials: { [Gateway.RAPYD]: rapydCredentials },
            timeoutMs: timeoutMs as number,
          });
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(KitPagosError);
        expect((thrown as KitPagosError).code).toBe(KitPagosErrorCode.INVALID_REQUEST);
        expect((thrown as KitPagosError).gateway).toBe(Gateway.RAPYD);
        expect((thrown as KitPagosError).message).toContain("timeoutMs");
        expect(configurator.getTimeoutMs()).toBe(5_000);
        expect(configurator.getActiveGateway()).toBe(Gateway.WOMPI);
      },
    );
  });

  describe("getCredentials()", () => {
    it("should return credentials for the configured gateway", () => {
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

    it("should throw KitPagosError(INVALID_CREDENTIALS) if requested gateway has no credentials", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: wompiCredentials,
        },
      });

      expect(() => configurator.getCredentials(Gateway.MERCADOPAGO)).toThrow(KitPagosError);

      try {
        configurator.getCredentials(Gateway.MERCADOPAGO);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
        expect(sdkError.gateway).toBe(Gateway.MERCADOPAGO);
        expect(sdkError.originalPayload).toBeNull();
      }
    });

    it("RF-08: should never include credentials or secrets in error message", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: wompiCredentials,
        },
      });

      try {
        configurator.getCredentials(Gateway.KUSHKI);
        fail("Should have thrown KitPagosError");
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const sdkError = error as KitPagosError;
        expect(sdkError.message).not.toContain(wompiCredentials.publicKey);
        expect(sdkError.message).not.toContain(wompiCredentials.privateKey);
        expect(sdkError.message).toContain("Credentials not configured for gateway: KUSHKI");
      }
    });
  });

  describe("getBaseUrl() and environment resolution", () => {
    it("should default to simulator environment resolving from closed catalog", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
      });
      expect(configurator.getEnvironment()).toBe("simulator");
      expect(configurator.getBaseUrl()).toBe("http://localhost:3000/v1/sim/wompi");
      expect(configurator.getBaseUrl(Gateway.WOMPI)).toBe("http://localhost:3000/v1/sim/wompi");
      expect(configurator.getBaseUrl(Gateway.RAPYD)).toBe("http://localhost:3000/v1/sim/rapyd");
    });

    it("should resolve sandbox URLs when environment is set to sandbox", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
        environment: "sandbox",
      });
      expect(configurator.getEnvironment()).toBe("sandbox");
      expect(configurator.getBaseUrl(Gateway.WOMPI)).toBe("https://sandbox.wompi.co/v1");
      expect(configurator.getBaseUrl(Gateway.RAPYD)).toBe("https://sandboxapi.rapyd.net/v1");
      expect(configurator.getBaseUrl(Gateway.KUSHKI)).toBe("https://api-uat.kushkipagos.com");
      expect(configurator.getBaseUrl(Gateway.MERCADOPAGO)).toBe("https://api.mercadopago.com/v1");
    });

    it("should resolve production URLs when environment is set to production", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
        environment: "production",
      });
      expect(configurator.getEnvironment()).toBe("production");
      expect(configurator.getBaseUrl(Gateway.WOMPI)).toBe("https://production.wompi.co/v1");
      expect(configurator.getBaseUrl(Gateway.RAPYD)).toBe("https://api.rapyd.net/v1");
      expect(configurator.getBaseUrl(Gateway.KUSHKI)).toBe("https://api.kushkipagos.com");
      expect(configurator.getBaseUrl(Gateway.MERCADOPAGO)).toBe("https://api.mercadopago.com/v1");
    });

    it("should throw KitPagosError (INVALID_REQUEST) for invalid environment value", () => {
      expect(() => {
        configurator.configure({
          gateway: Gateway.WOMPI,
          credentials: { [Gateway.WOMPI]: wompiCredentials },
          // @ts-expect-error testing invalid environment
          environment: "invalid_env",
        });
      }).toThrow(KitPagosError);
    });

    it("should prioritize global baseUrl string over environment", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: { [Gateway.WOMPI]: wompiCredentials },
        environment: "sandbox",
        baseUrl: "https://custom.endpoint.com",
      });
      expect(configurator.getBaseUrl()).toBe("https://custom.endpoint.com");
      expect(configurator.getBaseUrl(Gateway.WOMPI)).toBe("https://custom.endpoint.com");
      expect(configurator.getBaseUrl(Gateway.RAPYD)).toBe("https://custom.endpoint.com");
    });

    it("should prioritize gateway-specific baseUrl over environment catalog", () => {
      configurator.configure({
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: wompiCredentials,
          [Gateway.RAPYD]: rapydCredentials,
        },
        environment: "sandbox",
        baseUrl: {
          [Gateway.WOMPI]: "https://custom.wompi.endpoint",
        },
      });
      expect(configurator.getBaseUrl(Gateway.WOMPI)).toBe("https://custom.wompi.endpoint");
      // Rapyd is not in baseUrl map, so it resolves from sandbox catalog:
      expect(configurator.getBaseUrl(Gateway.RAPYD)).toBe("https://sandboxapi.rapyd.net/v1");
    });
  });
});
