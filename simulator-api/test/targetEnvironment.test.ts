import { Gateway, KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";
import {
  ENVIRONMENT_HEADER,
  resolveTargetEnvironment,
} from "../src/auth/targetEnvironment";

describe("resolveTargetEnvironment", () => {
  it("returns 'simulator' if the headers are not specified", () => {
    expect(resolveTargetEnvironment(undefined)).toBe("simulator");
  });

  it("returns 'simulator' if the x-kit-pagos-environment header is missing or empty", () => {
    expect(resolveTargetEnvironment({})).toBe("simulator");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "" })).toBe("simulator");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "   " })).toBe("simulator");
  });

  it("recognizes the three valid environments in lower and upper case", () => {
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "simulator" })).toBe("simulator");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "sandbox" })).toBe("sandbox");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "production" })).toBe("production");

    // Case-insensitivity:
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "SANDBOX" })).toBe("sandbox");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "Production" })).toBe("production");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "  simulator  " })).toBe("simulator");
  });

  it("accepts a header received as an array of strings", () => {
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: ["sandbox"] })).toBe("sandbox");
  });

  it("throws KitPagosError with INVALID_REQUEST if the environment is not valid", () => {
    expect(() =>
      resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "staging" }, Gateway.WOMPI),
    ).toThrow(KitPagosError);

    try {
      resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "dev" }, Gateway.RAPYD);
      fail("Debe lanzar KitPagosError");
    } catch (err) {
      expect(err).toBeInstanceOf(KitPagosError);
      const error = err as KitPagosError;
      expect(error.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
      expect(error.gateway).toBe(Gateway.RAPYD);
      expect(error.message).toContain("Ambiente 'dev' no válido");
    }
  });
});
