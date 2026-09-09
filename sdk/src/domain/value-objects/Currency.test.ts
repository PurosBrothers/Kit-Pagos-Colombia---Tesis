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

  describe("getMinorUnitExponent()", () => {
    it("devuelve 2 para COP, que es lo que asigna ISO 4217", () => {
      // Los centavos colombianos no circulan, pero el estandar les asigna
      // exponente 2 igual, y Wompi lo confirma al exigir amount_in_cents.
      expect(new Currency("COP").getMinorUnitExponent()).toBe(2);
    });

    it("devuelve 2 para las divisas comunes de dos decimales", () => {
      expect(new Currency("USD").getMinorUnitExponent()).toBe(2);
      expect(new Currency("EUR").getMinorUnitExponent()).toBe(2);
      expect(new Currency("MXN").getMinorUnitExponent()).toBe(2);
    });

    it("devuelve 0 para las divisas sin unidad menor en uso", () => {
      expect(new Currency("CLP").getMinorUnitExponent()).toBe(0);
      expect(new Currency("JPY").getMinorUnitExponent()).toBe(0);
      expect(new Currency("PYG").getMinorUnitExponent()).toBe(0);
    });

    it("devuelve 3 para las divisas con ratio 1000:1", () => {
      expect(new Currency("KWD").getMinorUnitExponent()).toBe(3);
      expect(new Currency("BHD").getMinorUnitExponent()).toBe(3);
    });

    it("cae en 2 para un codigo valido que no esta en la tabla de excepciones", () => {
      // La tabla solo lista excepciones; cualquier otra divisa asume el
      // exponente 2 que ISO 4217 asigna a la mayoria.
      expect(new Currency("ZWG").getMinorUnitExponent()).toBe(2);
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
