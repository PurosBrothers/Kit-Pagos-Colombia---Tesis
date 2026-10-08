import { Currency } from "./Currency";

describe("Currency", () => {
  describe("constructor", () => {
    it("uses COP as the default value if no code is passed", () => {
      expect(new Currency().getCode()).toBe("COP");
    });

    it("accepts a valid three-uppercase-letter ISO 4217 code", () => {
      expect(new Currency("USD").getCode()).toBe("USD");
    });

    it("rejects lowercase codes", () => {
      expect(() => new Currency("cop")).toThrow(
        "Currency debe tener exactamente tres letras mayusculas (ISO 4217)",
      );
    });

    it("rejects codes with fewer than three letters", () => {
      expect(() => new Currency("CO")).toThrow(
        "Currency debe tener exactamente tres letras mayusculas (ISO 4217)",
      );
    });

    it("rejects codes with more than three letters", () => {
      expect(() => new Currency("COPX")).toThrow(
        "Currency debe tener exactamente tres letras mayusculas (ISO 4217)",
      );
    });

    it("rejects codes with non-alphabetic characters", () => {
      expect(() => new Currency("C0P")).toThrow(
        "Currency debe tener exactamente tres letras mayusculas (ISO 4217)",
      );
    });
  });

  describe("getMinorUnitExponent()", () => {
    it("returns 2 for COP, which is what ISO 4217 assigns", () => {
      // Los centavos colombianos no circulan, pero el estandar les asigna
      // exponente 2 igual, y Wompi lo confirma al exigir amount_in_cents.
      expect(new Currency("COP").getMinorUnitExponent()).toBe(2);
    });

    it("returns 2 for common two-decimal currencies", () => {
      expect(new Currency("USD").getMinorUnitExponent()).toBe(2);
      expect(new Currency("EUR").getMinorUnitExponent()).toBe(2);
      expect(new Currency("MXN").getMinorUnitExponent()).toBe(2);
    });

    it("returns 0 for currencies without a minor unit in use", () => {
      expect(new Currency("CLP").getMinorUnitExponent()).toBe(0);
      expect(new Currency("JPY").getMinorUnitExponent()).toBe(0);
      expect(new Currency("PYG").getMinorUnitExponent()).toBe(0);
    });

    it("returns 3 for currencies with a 1000:1 ratio", () => {
      expect(new Currency("KWD").getMinorUnitExponent()).toBe(3);
      expect(new Currency("BHD").getMinorUnitExponent()).toBe(3);
    });

    it("falls back to 2 for a valid code that is not in the exceptions table", () => {
      // La tabla solo lista excepciones; cualquier otra divisa asume el
      // exponente 2 que ISO 4217 asigna a la mayoria.
      expect(new Currency("ZWG").getMinorUnitExponent()).toBe(2);
    });
  });

  describe("equals()", () => {
    it("is true for two instances with the same code", () => {
      expect(new Currency("COP").equals(new Currency("COP"))).toBe(true);
    });

    it("is false for two instances with different codes", () => {
      expect(new Currency("COP").equals(new Currency("USD"))).toBe(false);
    });
  });
});
