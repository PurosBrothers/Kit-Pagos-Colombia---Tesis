import { Amount, RoundingMode } from "./Amount";
import { Currency } from "./Currency";

const COP = new Currency("COP");
/** Divisa de exponente 0, para ejercitar el caso de una divisa sin unidad menor. */
const CLP = new Currency("CLP");

describe("Amount", () => {
  describe("constructor", () => {
    it("accepts an integer value", () => {
      expect(new Amount("50000").getValue()).toBe("50000");
    });

    it("accepts one and two decimals", () => {
      expect(new Amount("100.5").getValue()).toBe("100.5");
      expect(new Amount("100.55").getValue()).toBe("100.55");
    });

    it("accepts zero", () => {
      expect(new Amount("0").getValue()).toBe("0");
    });

    it("keeps the trailing zero, which is the reason this class exists", () => {
      // Es el caso que con `number` era imposible: (19.90).toString() da "19.9"
      // y el cero no se puede recuperar. Rapyd firma sobre el cuerpo
      // serializado, asi que "19.90" y "19.9" producen firmas distintas.
      expect(new Amount("19.90").getValue()).toBe("19.90");
      expect(new Amount("150000.00").getValue()).toBe("150000.00");
      expect(new Amount("0.10").getValue()).toBe("0.10");
    });

    it("rejects more than two decimals", () => {
      expect(() => new Amount("100.505")).toThrow(
        "Amount solo admite digitos con hasta 2 decimales",
      );
    });

    it("rejects negative values", () => {
      expect(() => new Amount("-50")).toThrow("Amount no puede ser negativo");
      expect(() => new Amount("-50.00")).toThrow("Amount no puede ser negativo");
    });

    it("rejects a number even though TypeScript prevents it at compile time", () => {
      // La guarda existe porque el SDK se consume tambien desde JavaScript
      // plano, donde el tipo no protege nada. Aceptar number reabriria el
      // problema del cero final por la puerta de atras.
      expect(() => new Amount(19.9 as unknown as string)).toThrow(
        "Amount debe recibir el monto como string, no como number",
      );
    });

    it("rejects strings that are not a canonical decimal", () => {
      for (const invalidValue of ["", " ", "abc", "NaN", "Infinity", "19,99", "19.", ".99", "+19.99", " 19.99", "19.99 "]) {
        expect(() => new Amount(invalidValue)).toThrow(
          "Amount solo admite digitos con hasta 2 decimales",
        );
      }
    });

    it("rejects exponential notation even though big.js would accept it", () => {
      // La validacion es propia y mas estricta que la de big.js a proposito:
      // "1e3" es un monto ambiguo de leer en un log o en un payload.
      expect(() => new Amount("1e3")).toThrow(
        "Amount solo admite digitos con hasta 2 decimales",
      );
    });

    it("rejects an amount polluted by earlier unrounded arithmetic", () => {
      // Mismo caso que cubria la version anterior de esta prueba, ahora por la
      // via del string: quien llama debe redondear explicitamente antes de
      // construir el Amount, en vez de que el objeto de valor absorba el error.
      expect(() => new Amount(String(0.1 + 0.2))).toThrow(
        "Amount solo admite digitos con hasta 2 decimales",
      );
      expect(() => new Amount(String(10.1 * 3))).toThrow(
        "Amount solo admite digitos con hasta 2 decimales",
      );
    });
  });

  describe("fromMinorUnits()", () => {
    it("keeps the trailing zero when rebuilding from cents", () => {
      // Es la mejora observable en el camino de entrada: la implementacion
      // anterior dividia entre 100 y el comercio recibia 19.9 tras haber
      // cobrado 19.90.
      expect(Amount.fromMinorUnits(1990, COP).getValue()).toBe("19.90");
    });

    it("rebuilds amounts with non-zero cents", () => {
      expect(Amount.fromMinorUnits(1999, COP).getValue()).toBe("19.99");
      expect(Amount.fromMinorUnits(15000050, COP).getValue()).toBe("150000.50");
    });

    it("pads with zeros when there are fewer digits than the exponent", () => {
      expect(Amount.fromMinorUnits(5, COP).getValue()).toBe("0.05");
      expect(Amount.fromMinorUnits(50, COP).getValue()).toBe("0.50");
      expect(Amount.fromMinorUnits(0, COP).getValue()).toBe("0.00");
    });

    it("does not insert a decimal point in a currency with exponent 0", () => {
      expect(Amount.fromMinorUnits(1990, CLP).getValue()).toBe("1990");
      expect(Amount.fromMinorUnits(0, CLP).getValue()).toBe("0");
    });

    it("accepts minor units as a string or as a number", () => {
      expect(Amount.fromMinorUnits("1990", COP).getValue()).toBe("19.90");
      expect(Amount.fromMinorUnits(1990, COP).getValue()).toBe("19.90");
    });

    it("rejects minor units that are not a non-negative integer", () => {
      for (const invalidValue of ["19.90", "-1990", "abc", ""]) {
        expect(() => Amount.fromMinorUnits(invalidValue, COP)).toThrow(
          "espera un entero no negativo de unidades menores",
        );
      }
    });
  });

  describe("getScale()", () => {
    it("reports the decimals as they were written", () => {
      expect(new Amount("19").getScale()).toBe(0);
      expect(new Amount("19.9").getScale()).toBe(1);
      expect(new Amount("19.90").getScale()).toBe(2);
    });
  });

  describe("toMinorUnits()", () => {
    it("shifts the decimal point using the currency's ISO exponent", () => {
      expect(new Amount("19.99").toMinorUnits(COP)).toBe("1999");
      expect(new Amount("100.5").toMinorUnits(COP)).toBe("10050");
      expect(new Amount("150000").toMinorUnits(COP)).toBe("15000000");
    });

    it("treats 19.9 and 19.90 the same, because they are the same amount", () => {
      expect(new Amount("19.9").toMinorUnits(COP)).toBe("1990");
      expect(new Amount("19.90").toMinorUnits(COP)).toBe("1990");
    });

    it("does not carry floating-point error in the conversion", () => {
      // Con `number`, 10.1 * 100 da 1009.9999999999999 y 0.29 * 100 da
      // 28.999999999999996. Correr el punto decimal sobre el string no puede
      // producir ese error porque no hay multiplicacion.
      expect(new Amount("10.1").toMinorUnits(COP)).toBe("1010");
      expect(new Amount("0.29").toMinorUnits(COP)).toBe("29");
      expect(new Amount("19.99").toMinorUnits(COP)).toBe("1999");
      expect(new Amount("4.65").toMinorUnits(COP)).toBe("465");
    });

    it("removes leading zeros from the result", () => {
      expect(new Amount("0.05").toMinorUnits(COP)).toBe("5");
      expect(new Amount("0.50").toMinorUnits(COP)).toBe("50");
      expect(new Amount("0").toMinorUnits(COP)).toBe("0");
      expect(new Amount("0.00").toMinorUnits(COP)).toBe("0");
    });

    it("returns the same integer in a currency with exponent 0", () => {
      expect(new Amount("1990").toMinorUnits(CLP)).toBe("1990");
    });

    it("throws if the amount has more decimals than the currency allows", () => {
      // Preferible a truncar: "19.99" en una divisa sin centavos es un error
      // del comercio, y convertirlo en 19 o en 20 en silencio es peor.
      expect(() => new Amount("19.99").toMinorUnits(CLP)).toThrow(
        "Amount de 2 decimales no cabe en CLP, que admite 0 segun ISO 4217",
      );
      expect(() => new Amount("19.9").toMinorUnits(CLP)).toThrow(
        "Amount de 1 decimales no cabe en CLP",
      );
    });

    it("round-trips exactly against fromMinorUnits over a whole range", () => {
      for (let cents = 0; cents <= 20000; cents++) {
        const rebuilt = Amount.fromMinorUnits(cents, COP);
        expect(rebuilt.toMinorUnits(COP)).toBe(String(cents));
      }
    });
  });

  describe("toFixedScale()", () => {
    it("pads with zeros up to the requested scale", () => {
      expect(new Amount("150000").toFixedScale(2)).toBe("150000.00");
      expect(new Amount("19.9").toFixedScale(2)).toBe("19.90");
      expect(new Amount("19.99").toFixedScale(2)).toBe("19.99");
    });

    it("is what Rapyd needs for the body that takes part in the signature", () => {
      // Dos montos equivalentes deben producir el mismo string, y ese string
      // debe conservar la escala fija que exige el calculo del HMAC.
      expect(new Amount("19.9").toFixedScale(2)).toBe(
        new Amount("19.90").toFixedScale(2),
      );
    });

    it("throws if the requested scale would lose decimals", () => {
      expect(() => new Amount("19.99").toFixedScale(0)).toThrow(
        "No se puede representar un monto de 2 decimales con escala 0 sin perder informacion",
      );
    });

    it("throws if the scale is not a non-negative integer", () => {
      expect(() => new Amount("19").toFixedScale(-1)).toThrow(
        "La escala debe ser un entero no negativo",
      );
      expect(() => new Amount("19").toFixedScale(1.5)).toThrow(
        "La escala debe ser un entero no negativo",
      );
    });
  });

  describe("add() and subtract()", () => {
    it("adds without floating-point error", () => {
      // 0.1 + 0.2 en punto flotante da 0.30000000000000004.
      expect(new Amount("0.10").add(new Amount("0.20")).getValue()).toBe("0.30");
      expect(new Amount("19.90").add(new Amount("0.10")).getValue()).toBe("20.00");
    });

    it("subtracts without floating-point error", () => {
      expect(new Amount("119000").subtract(new Amount("19000")).getValue()).toBe("100000");
      expect(new Amount("0.30").subtract(new Amount("0.10")).getValue()).toBe("0.20");
    });

    it("keeps the larger of the two scales", () => {
      expect(new Amount("19").add(new Amount("0.50")).getValue()).toBe("19.50");
    });

    it("throws if the subtraction would give a negative amount", () => {
      expect(() => new Amount("10").subtract(new Amount("20"))).toThrow(
        "daria un monto negativo",
      );
    });
  });

  describe("multiply() and divide()", () => {
    it("multiplies by a rate rounding to the requested scale", () => {
      expect(new Amount("100.00").multiply("0.19", 2).getValue()).toBe("19.00");
      expect(new Amount("84033.61").multiply("0.19", 2).getValue()).toBe("15966.39");
    });

    it("divides with an explicit scale, which is where big.js earns its place", () => {
      // 100000 / 1.19 da 84033.61344537816 en punto flotante: once decimales
      // que el constructor rechazaria. Con escala y modo explicitos, el
      // resultado es un monto valido y reproducible.
      expect(new Amount("100000").divide("1.19", 2).getValue()).toBe("84033.61");
      expect(new Amount("119000").divide("1.19", 2).getValue()).toBe("100000.00");
    });

    it("honors the requested rounding mode", () => {
      expect(new Amount("10").divide("3", 2, RoundingMode.DOWN).getValue()).toBe("3.33");
      expect(new Amount("20").divide("3", 2, RoundingMode.DOWN).getValue()).toBe("6.66");
      expect(new Amount("20").divide("3", 2, RoundingMode.HALF_UP).getValue()).toBe("6.67");
      expect(new Amount("20").divide("3", 2, RoundingMode.UP).getValue()).toBe("6.67");
    });

    it("uses HALF_UP by default, which is the commercial convention", () => {
      expect(new Amount("20").divide("3", 2).getValue()).toBe("6.67");
    });

    it("throws when dividing by zero", () => {
      expect(() => new Amount("100").divide("0", 2)).toThrow(
        "No se puede dividir un monto entre cero",
      );
    });
  });

  describe("equals()", () => {
    it("compares by value and not by string", () => {
      expect(new Amount("19.9").equals(new Amount("19.90"))).toBe(true);
      expect(new Amount("19").equals(new Amount("19.00"))).toBe(true);
    });

    it("tells really different amounts apart", () => {
      expect(new Amount("100.5").equals(new Amount("100.51"))).toBe(false);
    });

    it("comparing by value does not erase each instance's scale", () => {
      const withZero = new Amount("19.90");
      const withoutZero = new Amount("19.9");
      expect(withZero.equals(withoutZero)).toBe(true);
      expect(withZero.getValue()).toBe("19.90");
      expect(withoutZero.getValue()).toBe("19.9");
    });
  });
});
