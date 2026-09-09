import { Amount, RoundingMode } from "./Amount";
import { Currency } from "./Currency";

const COP = new Currency("COP");
/** Divisa de exponente 0, para ejercitar el caso de una divisa sin unidad menor. */
const CLP = new Currency("CLP");

describe("Amount", () => {
  describe("constructor", () => {
    it("acepta un valor entero", () => {
      expect(new Amount("50000").getValue()).toBe("50000");
    });

    it("acepta uno y dos decimales", () => {
      expect(new Amount("100.5").getValue()).toBe("100.5");
      expect(new Amount("100.55").getValue()).toBe("100.55");
    });

    it("acepta cero", () => {
      expect(new Amount("0").getValue()).toBe("0");
    });

    it("conserva el cero a la derecha, que es la razon de ser de esta clase", () => {
      // Es el caso que con `number` era imposible: (19.90).toString() da "19.9"
      // y el cero no se puede recuperar. Rapyd firma sobre el cuerpo
      // serializado, asi que "19.90" y "19.9" producen firmas distintas.
      expect(new Amount("19.90").getValue()).toBe("19.90");
      expect(new Amount("150000.00").getValue()).toBe("150000.00");
      expect(new Amount("0.10").getValue()).toBe("0.10");
    });

    it("rechaza mas de dos decimales", () => {
      expect(() => new Amount("100.505")).toThrow(
        "Amount solo admite digitos con hasta 2 decimales",
      );
    });

    it("rechaza valores negativos", () => {
      expect(() => new Amount("-50")).toThrow("Amount no puede ser negativo");
      expect(() => new Amount("-50.00")).toThrow("Amount no puede ser negativo");
    });

    it("rechaza un number aunque TypeScript lo impida en compilacion", () => {
      // La guarda existe porque el SDK se consume tambien desde JavaScript
      // plano, donde el tipo no protege nada. Aceptar number reabriria el
      // problema del cero final por la puerta de atras.
      expect(() => new Amount(19.9 as unknown as string)).toThrow(
        "Amount debe recibir el monto como string, no como number",
      );
    });

    it("rechaza strings que no son un decimal canonico", () => {
      for (const invalido of ["", " ", "abc", "NaN", "Infinity", "19,99", "19.", ".99", "+19.99", " 19.99", "19.99 "]) {
        expect(() => new Amount(invalido)).toThrow(
          "Amount solo admite digitos con hasta 2 decimales",
        );
      }
    });

    it("rechaza notacion exponencial aunque big.js la aceptaria", () => {
      // La validacion es propia y mas estricta que la de big.js a proposito:
      // "1e3" es un monto ambiguo de leer en un log o en un payload.
      expect(() => new Amount("1e3")).toThrow(
        "Amount solo admite digitos con hasta 2 decimales",
      );
    });

    it("rechaza un monto contaminado por aritmetica previa sin redondear", () => {
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
    it("conserva el cero a la derecha al reconstruir desde centavos", () => {
      // Es la mejora observable en el camino de entrada: la implementacion
      // anterior dividia entre 100 y el comercio recibia 19.9 tras haber
      // cobrado 19.90.
      expect(Amount.fromMinorUnits(1990, COP).getValue()).toBe("19.90");
    });

    it("reconstruye montos con centavos distintos de cero", () => {
      expect(Amount.fromMinorUnits(1999, COP).getValue()).toBe("19.99");
      expect(Amount.fromMinorUnits(15000050, COP).getValue()).toBe("150000.50");
    });

    it("rellena con ceros cuando hay menos digitos que el exponente", () => {
      expect(Amount.fromMinorUnits(5, COP).getValue()).toBe("0.05");
      expect(Amount.fromMinorUnits(50, COP).getValue()).toBe("0.50");
      expect(Amount.fromMinorUnits(0, COP).getValue()).toBe("0.00");
    });

    it("no inserta punto decimal en una divisa de exponente 0", () => {
      expect(Amount.fromMinorUnits(1990, CLP).getValue()).toBe("1990");
      expect(Amount.fromMinorUnits(0, CLP).getValue()).toBe("0");
    });

    it("acepta las unidades menores como string o como number", () => {
      expect(Amount.fromMinorUnits("1990", COP).getValue()).toBe("19.90");
      expect(Amount.fromMinorUnits(1990, COP).getValue()).toBe("19.90");
    });

    it("rechaza unidades menores que no sean un entero no negativo", () => {
      for (const invalido of ["19.90", "-1990", "abc", ""]) {
        expect(() => Amount.fromMinorUnits(invalido, COP)).toThrow(
          "espera un entero no negativo de unidades menores",
        );
      }
    });
  });

  describe("getScale()", () => {
    it("informa los decimales tal como fueron escritos", () => {
      expect(new Amount("19").getScale()).toBe(0);
      expect(new Amount("19.9").getScale()).toBe(1);
      expect(new Amount("19.90").getScale()).toBe(2);
    });
  });

  describe("toMinorUnits()", () => {
    it("corre el punto decimal usando el exponente ISO de la divisa", () => {
      expect(new Amount("19.99").toMinorUnits(COP)).toBe("1999");
      expect(new Amount("100.5").toMinorUnits(COP)).toBe("10050");
      expect(new Amount("150000").toMinorUnits(COP)).toBe("15000000");
    });

    it("trata igual a 19.9 y 19.90, porque son el mismo monto", () => {
      expect(new Amount("19.9").toMinorUnits(COP)).toBe("1990");
      expect(new Amount("19.90").toMinorUnits(COP)).toBe("1990");
    });

    it("no arrastra error de punto flotante en la conversion", () => {
      // Con `number`, 10.1 * 100 da 1009.9999999999999 y 0.29 * 100 da
      // 28.999999999999996. Correr el punto decimal sobre el string no puede
      // producir ese error porque no hay multiplicacion.
      expect(new Amount("10.1").toMinorUnits(COP)).toBe("1010");
      expect(new Amount("0.29").toMinorUnits(COP)).toBe("29");
      expect(new Amount("19.99").toMinorUnits(COP)).toBe("1999");
      expect(new Amount("4.65").toMinorUnits(COP)).toBe("465");
    });

    it("quita los ceros a la izquierda del resultado", () => {
      expect(new Amount("0.05").toMinorUnits(COP)).toBe("5");
      expect(new Amount("0.50").toMinorUnits(COP)).toBe("50");
      expect(new Amount("0").toMinorUnits(COP)).toBe("0");
      expect(new Amount("0.00").toMinorUnits(COP)).toBe("0");
    });

    it("devuelve el mismo entero en una divisa de exponente 0", () => {
      expect(new Amount("1990").toMinorUnits(CLP)).toBe("1990");
    });

    it("lanza si el monto tiene mas decimales de los que admite la divisa", () => {
      // Preferible a truncar: "19.99" en una divisa sin centavos es un error
      // del comercio, y convertirlo en 19 o en 20 en silencio es peor.
      expect(() => new Amount("19.99").toMinorUnits(CLP)).toThrow(
        "Amount de 2 decimales no cabe en CLP, que admite 0 segun ISO 4217",
      );
      expect(() => new Amount("19.9").toMinorUnits(CLP)).toThrow(
        "Amount de 1 decimales no cabe en CLP",
      );
    });

    it("hace ida y vuelta exacta contra fromMinorUnits en todo un rango", () => {
      for (let cents = 0; cents <= 20000; cents++) {
        const reconstruido = Amount.fromMinorUnits(cents, COP);
        expect(reconstruido.toMinorUnits(COP)).toBe(String(cents));
      }
    });
  });

  describe("toFixedScale()", () => {
    it("rellena con ceros hasta la escala pedida", () => {
      expect(new Amount("150000").toFixedScale(2)).toBe("150000.00");
      expect(new Amount("19.9").toFixedScale(2)).toBe("19.90");
      expect(new Amount("19.99").toFixedScale(2)).toBe("19.99");
    });

    it("es lo que Rapyd necesita para el cuerpo que participa de la firma", () => {
      // Dos montos equivalentes deben producir el mismo string, y ese string
      // debe conservar la escala fija que exige el calculo del HMAC.
      expect(new Amount("19.9").toFixedScale(2)).toBe(
        new Amount("19.90").toFixedScale(2),
      );
    });

    it("lanza si la escala pedida perderia decimales", () => {
      expect(() => new Amount("19.99").toFixedScale(0)).toThrow(
        "No se puede representar un monto de 2 decimales con escala 0 sin perder informacion",
      );
    });

    it("lanza si la escala no es un entero no negativo", () => {
      expect(() => new Amount("19").toFixedScale(-1)).toThrow(
        "La escala debe ser un entero no negativo",
      );
      expect(() => new Amount("19").toFixedScale(1.5)).toThrow(
        "La escala debe ser un entero no negativo",
      );
    });
  });

  describe("add() y subtract()", () => {
    it("suma sin error de punto flotante", () => {
      // 0.1 + 0.2 en punto flotante da 0.30000000000000004.
      expect(new Amount("0.10").add(new Amount("0.20")).getValue()).toBe("0.30");
      expect(new Amount("19.90").add(new Amount("0.10")).getValue()).toBe("20.00");
    });

    it("resta sin error de punto flotante", () => {
      expect(new Amount("119000").subtract(new Amount("19000")).getValue()).toBe("100000");
      expect(new Amount("0.30").subtract(new Amount("0.10")).getValue()).toBe("0.20");
    });

    it("conserva la mayor de las dos escalas", () => {
      expect(new Amount("19").add(new Amount("0.50")).getValue()).toBe("19.50");
    });

    it("lanza si la resta daria un monto negativo", () => {
      expect(() => new Amount("10").subtract(new Amount("20"))).toThrow(
        "daria un monto negativo",
      );
    });
  });

  describe("multiply() y divide()", () => {
    it("multiplica por una tasa redondeando a la escala pedida", () => {
      expect(new Amount("100.00").multiply("0.19", 2).getValue()).toBe("19.00");
      expect(new Amount("84033.61").multiply("0.19", 2).getValue()).toBe("15966.39");
    });

    it("divide con escala explicita, que es donde big.js gana su lugar", () => {
      // 100000 / 1.19 da 84033.61344537816 en punto flotante: once decimales
      // que el constructor rechazaria. Con escala y modo explicitos, el
      // resultado es un monto valido y reproducible.
      expect(new Amount("100000").divide("1.19", 2).getValue()).toBe("84033.61");
      expect(new Amount("119000").divide("1.19", 2).getValue()).toBe("100000.00");
    });

    it("respeta el modo de redondeo pedido", () => {
      expect(new Amount("10").divide("3", 2, RoundingMode.DOWN).getValue()).toBe("3.33");
      expect(new Amount("20").divide("3", 2, RoundingMode.DOWN).getValue()).toBe("6.66");
      expect(new Amount("20").divide("3", 2, RoundingMode.HALF_UP).getValue()).toBe("6.67");
      expect(new Amount("20").divide("3", 2, RoundingMode.UP).getValue()).toBe("6.67");
    });

    it("usa HALF_UP por defecto, que es la convencion comercial", () => {
      expect(new Amount("20").divide("3", 2).getValue()).toBe("6.67");
    });

    it("lanza al dividir entre cero", () => {
      expect(() => new Amount("100").divide("0", 2)).toThrow(
        "No se puede dividir un monto entre cero",
      );
    });
  });

  describe("equals()", () => {
    it("compara por valor y no por string", () => {
      expect(new Amount("19.9").equals(new Amount("19.90"))).toBe(true);
      expect(new Amount("19").equals(new Amount("19.00"))).toBe(true);
    });

    it("distingue montos realmente distintos", () => {
      expect(new Amount("100.5").equals(new Amount("100.51"))).toBe(false);
    });

    it("comparar por valor no borra la escala de cada instancia", () => {
      const conCero = new Amount("19.90");
      const sinCero = new Amount("19.9");
      expect(conCero.equals(sinCero)).toBe(true);
      expect(conCero.getValue()).toBe("19.90");
      expect(sinCero.getValue()).toBe("19.9");
    });
  });
});
