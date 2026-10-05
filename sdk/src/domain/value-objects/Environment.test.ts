import { Environment, isEnvironment, parseEnvironment, ALL_ENVIRONMENTS } from "./Environment";
import { Gateway } from "./Gateway";
import { KitPagosError } from "../errors/KitPagosError";
import { KitPagosErrorCode } from "./KitPagosErrorCode";

describe("Environment Value Object", () => {
  it("contiene los tres ambientes canónicos", () => {
    expect(ALL_ENVIRONMENTS).toEqual(["simulator", "sandbox", "production"]);
    expect(Environment.SIMULATOR).toBe("simulator");
    expect(Environment.SANDBOX).toBe("sandbox");
    expect(Environment.PRODUCTION).toBe("production");
  });

  describe("isEnvironment", () => {
    it("reconoce cadenas válidas", () => {
      expect(isEnvironment("simulator")).toBe(true);
      expect(isEnvironment("sandbox")).toBe(true);
      expect(isEnvironment("production")).toBe(true);
    });

    it("rechaza valores inválidos o de otros tipos", () => {
      expect(isEnvironment("staging")).toBe(false);
      expect(isEnvironment("dev")).toBe(false);
      expect(isEnvironment("")).toBe(false);
      expect(isEnvironment(null)).toBe(false);
      expect(isEnvironment(undefined)).toBe(false);
      expect(isEnvironment(123)).toBe(false);
    });
  });

  describe("parseEnvironment", () => {
    it("devuelve el ambiente si es válido", () => {
      expect(parseEnvironment("simulator")).toBe("simulator");
      expect(parseEnvironment("sandbox")).toBe("sandbox");
      expect(parseEnvironment("production")).toBe("production");
    });

    it("lanza KitPagosError con INVALID_REQUEST si el ambiente no es válido", () => {
      expect(() => parseEnvironment("staging", Gateway.WOMPI)).toThrow(KitPagosError);
      try {
        parseEnvironment("staging", Gateway.WOMPI);
      } catch (err) {
        expect(err).toBeInstanceOf(KitPagosError);
        const error = err as KitPagosError;
        expect(error.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
        expect(error.gateway).toBe(Gateway.WOMPI);
        expect(error.message).toContain("Ambiente 'staging' no válido");
      }
    });
  });
});
