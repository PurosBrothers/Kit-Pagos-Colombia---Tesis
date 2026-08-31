import { Currency } from "./Currency";

describe("Currency", () => {
  describe("constructor", () => {
    it("usa COP como valor por defecto si no se pasa codigo", () => {
      expect(new Currency().getCode()).toBe("COP");
    });

    it("acepta un codigo ISO 4217 valido de tres letras mayusculas", () => {
      expect(new Currency("USD").getCode()).toBe("USD");
    });

    it("rechaza codigos en minuscula", () => {
      expect(() => new Currency("cop")).toThrow(
        "Currency debe tener exactamente tres letras mayusculas (ISO 4217)",
      );
    });

    it("rechaza codigos con menos de tres letras", () => {
      expect(() => new Currency("CO")).toThrow(
        "Currency debe tener exactamente tres letras mayusculas (ISO 4217)",
      );
    });

    it("rechaza codigos con mas de tres letras", () => {
      expect(() => new Currency("COPX")).toThrow(
        "Currency debe tener exactamente tres letras mayusculas (ISO 4217)",
      );
    });

    it("rechaza codigos con caracteres no alfabeticos", () => {
      expect(() => new Currency("C0P")).toThrow(
        "Currency debe tener exactamente tres letras mayusculas (ISO 4217)",
      );
    });
  });

  describe("equals()", () => {
    it("es true para dos instancias con el mismo codigo", () => {
      expect(new Currency("COP").equals(new Currency("COP"))).toBe(true);
    });

    it("es false para dos instancias con codigos distintos", () => {
      expect(new Currency("COP").equals(new Currency("USD"))).toBe(false);
    });
  });
});
