import { TaxBreakdown } from "./TaxBreakdown";
import { Amount } from "./Amount";
import { Currency } from "./Currency";

const COP = new Currency("COP");
const CLP = new Currency("CLP");
/** IVA general colombiano. */
const IVA_19 = "0.19";

describe("TaxBreakdown", () => {
  describe("exempt()", () => {
    it("leaves the whole amount outside VAT, which is Kushki's default case", () => {
      const taxSplit = TaxBreakdown.exempt(new Amount("150000"), COP);

      expect(taxSplit.subtotalIva0.getValue()).toBe("150000");
      expect(taxSplit.subtotalIva.getValue()).toBe("0.00");
      expect(taxSplit.iva.getValue()).toBe("0.00");
      expect(taxSplit.ice.getValue()).toBe("0.00");
    });

    it("the total is still the original amount", () => {
      const total = new Amount("150000");
      expect(TaxBreakdown.exempt(total, COP).getTotal().equals(total)).toBe(true);
    });
  });

  describe("fromTaxIncluded()", () => {
    it("splits base and tax from a price that already includes VAT", () => {
      // 119.000 con IVA del 19% son 100.000 de base y 19.000 de impuesto.
      const taxSplit = TaxBreakdown.fromTaxIncluded(new Amount("119000"), IVA_19, COP);

      expect(taxSplit.subtotalIva.getValue()).toBe("100000.00");
      expect(taxSplit.iva.getValue()).toBe("19000.00");
      expect(taxSplit.subtotalIva0.getValue()).toBe("0.00");
    });

    it("balances exactly even when the division is not round", () => {
      // 100000 / 1.19 da 84033.613445..., que no tiene representacion exacta.
      const total = new Amount("100000");
      const taxSplit = TaxBreakdown.fromTaxIncluded(total, IVA_19, COP);

      expect(taxSplit.subtotalIva.getValue()).toBe("84033.61");
      expect(taxSplit.iva.getValue()).toBe("15966.39");
      expect(taxSplit.getTotal().equals(total)).toBe(true);
    });

    it("derives the tax by subtraction, so the components add up to the exact total", () => {
      // Es la invariante central de la clase, verificada sobre un barrido
      // amplio en vez de sobre unos pocos valores elegidos a mano.
      for (let cents = 1; cents <= 30000; cents++) {
        const total = Amount.fromMinorUnits(cents, COP);
        const taxSplit = TaxBreakdown.fromTaxIncluded(total, IVA_19, COP);
        expect(taxSplit.getTotal().equals(total)).toBe(true);
      }
    });

    it("also balances in a currency without decimals", () => {
      for (let pesos = 1; pesos <= 5000; pesos++) {
        const total = Amount.fromMinorUnits(pesos, CLP);
        const taxSplit = TaxBreakdown.fromTaxIncluded(total, IVA_19, CLP);
        expect(taxSplit.getTotal().equals(total)).toBe(true);
        expect(taxSplit.subtotalIva.getScale()).toBe(0);
      }
    });

    it("with a zero rate leaves the total intact as the taxable base", () => {
      const taxSplit = TaxBreakdown.fromTaxIncluded(new Amount("150000"), "0", COP);

      expect(taxSplit.subtotalIva.getValue()).toBe("150000.00");
      expect(taxSplit.iva.getValue()).toBe("0.00");
    });

    it("accepts rates with more than two decimals, because a rate is not an amount", () => {
      const total = new Amount("119500");
      const taxSplit = TaxBreakdown.fromTaxIncluded(total, "0.195", COP);
      expect(taxSplit.getTotal().equals(total)).toBe(true);
    });

    it("rejects malformed rates", () => {
      for (const taxRate of ["-0.19", "19%", "abc", "", "1e-2"]) {
        expect(() =>
          TaxBreakdown.fromTaxIncluded(new Amount("119000"), taxRate, COP),
        ).toThrow("La tasa de impuesto debe ser un decimal no negativo");
      }
    });
  });

  describe("fromTaxExcluded()", () => {
    it("adds the tax on top of a base that does not include it yet", () => {
      const taxSplit = TaxBreakdown.fromTaxExcluded(new Amount("100000"), IVA_19, COP);

      expect(taxSplit.subtotalIva.getValue()).toBe("100000");
      expect(taxSplit.iva.getValue()).toBe("19000.00");
      expect(taxSplit.getTotal().getValue()).toBe("119000.00");
    });

    it("the resulting total is greater than the base, unlike fromTaxIncluded", () => {
      const base = new Amount("100000");
      const taxIncluded = TaxBreakdown.fromTaxIncluded(base, IVA_19, COP);
      const taxExcluded = TaxBreakdown.fromTaxExcluded(base, IVA_19, COP);

      expect(taxIncluded.getTotal().equals(base)).toBe(true);
      expect(taxExcluded.getTotal().equals(base)).toBe(false);
      expect(taxExcluded.getTotal().getValue()).toBe("119000.00");
    });

    it("rejects malformed rates", () => {
      expect(() =>
        TaxBreakdown.fromTaxExcluded(new Amount("100000"), "-0.19", COP),
      ).toThrow("La tasa de impuesto debe ser un decimal no negativo");
    });
  });

  describe("fromComponents()", () => {
    it("accepts a breakdown the merchant already computed", () => {
      const taxSplit = TaxBreakdown.fromComponents({
        subtotalIva0: new Amount("50000"),
        subtotalIva: new Amount("100000"),
        iva: new Amount("19000"),
        currency: COP,
      });

      // El total sale con escala 2 aunque los componentes se escribieron sin
      // decimales, porque el `ice` que se rellena por defecto trae la escala de
      // la divisa y add() conserva la mayor de las dos.
      expect(taxSplit.getTotal().getValue()).toBe("169000.00");
      expect(taxSplit.getTotal().equals(new Amount("169000"))).toBe(true);
    });

    it("allows reporting the consumption tax", () => {
      const taxSplit = TaxBreakdown.fromComponents({
        subtotalIva0: new Amount("0"),
        subtotalIva: new Amount("100000"),
        iva: new Amount("19000"),
        ice: new Amount("8000"),
        currency: COP,
      });

      expect(taxSplit.ice.getValue()).toBe("8000");
      expect(taxSplit.getTotal().getValue()).toBe("127000");
    });

    it("leaves the consumption tax at zero if not reported", () => {
      const taxSplit = TaxBreakdown.fromComponents({
        subtotalIva0: new Amount("150000"),
        subtotalIva: new Amount("0"),
        iva: new Amount("0"),
        currency: COP,
      });

      expect(taxSplit.ice.getValue()).toBe("0.00");
    });
  });

  describe("getTotal()", () => {
    it("is the only source of the total, so it cannot disagree with its parts", () => {
      const taxSplit = TaxBreakdown.fromComponents({
        subtotalIva0: new Amount("0.10"),
        subtotalIva: new Amount("0.20"),
        iva: new Amount("0.04"),
        currency: COP,
      });

      // 0.1 + 0.2 en punto flotante daria 0.30000000000000004.
      expect(taxSplit.getTotal().getValue()).toBe("0.34");
    });
  });
});
