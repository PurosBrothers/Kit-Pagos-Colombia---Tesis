import { Gateway, KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";
import {
  ENVIRONMENT_HEADER,
  resolveTargetEnvironment,
} from "../src/auth/targetEnvironment";

describe("resolveTargetEnvironment", () => {
  it("devuelve 'simulator' si las cabeceras no se especifican", () => {
    expect(resolveTargetEnvironment(undefined)).toBe("simulator");
  });

  it("devuelve 'simulator' si la cabecera x-kit-pagos-environment está ausente o vacía", () => {
    expect(resolveTargetEnvironment({})).toBe("simulator");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "" })).toBe("simulator");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "   " })).toBe("simulator");
  });

  it("reconoce los tres ambientes válidos en minúsculas y mayúsculas", () => {
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "simulator" })).toBe("simulator");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "sandbox" })).toBe("sandbox");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "production" })).toBe("production");

    // Case-insensitivity:
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "SANDBOX" })).toBe("sandbox");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "Production" })).toBe("production");
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: "  simulator  " })).toBe("simulator");
  });

  it("acepta cabecera recibida como arreglo de strings", () => {
    expect(resolveTargetEnvironment({ [ENVIRONMENT_HEADER]: ["sandbox"] })).toBe("sandbox");
  });

  it("lanza KitPagosError con INVALID_REQUEST si el ambiente no es válido", () => {
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
