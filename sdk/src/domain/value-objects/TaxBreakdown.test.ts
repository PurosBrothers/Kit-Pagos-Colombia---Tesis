import { TaxBreakdown } from "./TaxBreakdown";
import { Amount } from "./Amount";
import { Currency } from "./Currency";

const COP = new Currency("COP");
const CLP = new Currency("CLP");
/** IVA general colombiano. */
const IVA_19 = "0.19";

describe("TaxBreakdown", () => {
  describe("exempt()", () => {
    it("deja todo el monto fuera de IVA, que es el caso por defecto de Kushki", () => {
      const desglose = TaxBreakdown.exempt(new Amount("150000"), COP);

      expect(desglose.subtotalIva0.getValue()).toBe("150000");
      expect(desglose.subtotalIva.getValue()).toBe("0.00");
      expect(desglose.iva.getValue()).toBe("0.00");
      expect(desglose.ice.getValue()).toBe("0.00");
    });

    it("el total sigue siendo el monto original", () => {
      const total = new Amount("150000");
      expect(TaxBreakdown.exempt(total, COP).getTotal().equals(total)).toBe(true);
    });
  });

  describe("fromTaxIncluded()", () => {
    it("separa base e impuesto de un precio que ya trae el IVA", () => {
      // 119.000 con IVA del 19% son 100.000 de base y 19.000 de impuesto.
      const desglose = TaxBreakdown.fromTaxIncluded(new Amount("119000"), IVA_19, COP);

      expect(desglose.subtotalIva.getValue()).toBe("100000.00");
      expect(desglose.iva.getValue()).toBe("19000.00");
      expect(desglose.subtotalIva0.getValue()).toBe("0.00");
    });

    it("cuadra exacto incluso cuando la division no es redonda", () => {
      // 100000 / 1.19 da 84033.613445..., que no tiene representacion exacta.
      const total = new Amount("100000");
      const desglose = TaxBreakdown.fromTaxIncluded(total, IVA_19, COP);

      expect(desglose.subtotalIva.getValue()).toBe("84033.61");
      expect(desglose.iva.getValue()).toBe("15966.39");
      expect(desglose.getTotal().equals(total)).toBe(true);
    });

    it("deriva el impuesto por resta, de modo que los componentes suman el total exacto", () => {
      // Es la invariante central de la clase, verificada sobre un barrido
      // amplio en vez de sobre unos pocos valores elegidos a mano.
      for (let cents = 1; cents <= 30000; cents++) {
        const total = Amount.fromMinorUnits(cents, COP);
        const desglose = TaxBreakdown.fromTaxIncluded(total, IVA_19, COP);
        expect(desglose.getTotal().equals(total)).toBe(true);
      }
    });

    it("cuadra tambien en una divisa sin decimales", () => {
      for (let pesos = 1; pesos <= 5000; pesos++) {
        const total = Amount.fromMinorUnits(pesos, CLP);
        const desglose = TaxBreakdown.fromTaxIncluded(total, IVA_19, CLP);
        expect(desglose.getTotal().equals(total)).toBe(true);
        expect(desglose.subtotalIva.getScale()).toBe(0);
      }
    });

    it("con tasa cero deja el total intacto como base gravable", () => {
      const desglose = TaxBreakdown.fromTaxIncluded(new Amount("150000"), "0", COP);

      expect(desglose.subtotalIva.getValue()).toBe("150000.00");
      expect(desglose.iva.getValue()).toBe("0.00");
    });

    it("acepta tasas de mas de dos decimales, porque una tasa no es un monto", () => {
      const total = new Amount("119500");
      const desglose = TaxBreakdown.fromTaxIncluded(total, "0.195", COP);
      expect(desglose.getTotal().equals(total)).toBe(true);
    });

    it("rechaza tasas mal formadas", () => {
      for (const tasa of ["-0.19", "19%", "abc", "", "1e-2"]) {
        expect(() =>
          TaxBreakdown.fromTaxIncluded(new Amount("119000"), tasa, COP),
        ).toThrow("La tasa de impuesto debe ser un decimal no negativo");
      }
    });
  });

  describe("fromTaxExcluded()", () => {
    it("suma el impuesto sobre una base que todavia no lo tiene", () => {
      const desglose = TaxBreakdown.fromTaxExcluded(new Amount("100000"), IVA_19, COP);

      expect(desglose.subtotalIva.getValue()).toBe("100000");
      expect(desglose.iva.getValue()).toBe("19000.00");
      expect(desglose.getTotal().getValue()).toBe("119000.00");
    });

    it("el total resultante es mayor que la base, a diferencia de fromTaxIncluded", () => {
      const base = new Amount("100000");
      const incluido = TaxBreakdown.fromTaxIncluded(base, IVA_19, COP);
      const excluido = TaxBreakdown.fromTaxExcluded(base, IVA_19, COP);

      expect(incluido.getTotal().equals(base)).toBe(true);
      expect(excluido.getTotal().equals(base)).toBe(false);
      expect(excluido.getTotal().getValue()).toBe("119000.00");
    });

    it("rechaza tasas mal formadas", () => {
      expect(() =>
        TaxBreakdown.fromTaxExcluded(new Amount("100000"), "-0.19", COP),
      ).toThrow("La tasa de impuesto debe ser un decimal no negativo");
    });
  });

  describe("fromComponents()", () => {
    it("acepta un desglose que el comercio ya calculo", () => {
      const desglose = TaxBreakdown.fromComponents({
        subtotalIva0: new Amount("50000"),
        subtotalIva: new Amount("100000"),
        iva: new Amount("19000"),
        currency: COP,
      });

      // El total sale con escala 2 aunque los componentes se escribieron sin
      // decimales, porque el `ice` que se rellena por defecto trae la escala de
      // la divisa y add() conserva la mayor de las dos.
      expect(desglose.getTotal().getValue()).toBe("169000.00");
      expect(desglose.getTotal().equals(new Amount("169000"))).toBe(true);
    });

    it("permite informar impuesto al consumo", () => {
      const desglose = TaxBreakdown.fromComponents({
        subtotalIva0: new Amount("0"),
        subtotalIva: new Amount("100000"),
        iva: new Amount("19000"),
        ice: new Amount("8000"),
        currency: COP,
      });

      expect(desglose.ice.getValue()).toBe("8000");
      expect(desglose.getTotal().getValue()).toBe("127000");
    });

    it("deja el impuesto al consumo en cero si no se informa", () => {
      const desglose = TaxBreakdown.fromComponents({
        subtotalIva0: new Amount("150000"),
        subtotalIva: new Amount("0"),
        iva: new Amount("0"),
        currency: COP,
      });

      expect(desglose.ice.getValue()).toBe("0.00");
    });
  });

  describe("getTotal()", () => {
    it("es la unica fuente del total, de modo que no puede discrepar de sus partes", () => {
      const desglose = TaxBreakdown.fromComponents({
        subtotalIva0: new Amount("0.10"),
        subtotalIva: new Amount("0.20"),
        iva: new Amount("0.04"),
        currency: COP,
      });

      // 0.1 + 0.2 en punto flotante daria 0.30000000000000004.
      expect(desglose.getTotal().getValue()).toBe("0.34");
    });
  });
});
