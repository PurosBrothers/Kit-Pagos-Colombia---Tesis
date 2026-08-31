import { Amount } from "./Amount";

describe("Amount", () => {
  describe("constructor", () => {
    it("acepta un valor entero", () => {
      expect(new Amount(50000).getValue()).toBe(50000);
    });

    it("acepta hasta dos decimales significativos", () => {
      expect(new Amount(100.5).getValue()).toBe(100.5);
      expect(new Amount(100.55).getValue()).toBe(100.55);
    });

    it("acepta cero", () => {
      expect(new Amount(0).getValue()).toBe(0);
    });

    it("rechaza mas de dos decimales significativos", () => {
      expect(() => new Amount(100.505)).toThrow(
        "Amount solo admite hasta dos decimales significativos",
      );
    });

    it("rechaza valores negativos", () => {
      expect(() => new Amount(-50)).toThrow("Amount no puede ser negativo");
    });

    it("rechaza un valor negativo con decimales validos usando el mensaje de signo, no el de decimales", () => {
      // -50.00 no dispara la validacion de decimales (Math.round(-5000) === -5000),
      // por lo que debe llegar hasta la segunda validacion y fallar por ser negativo.
      expect(() => new Amount(-50.0)).toThrow("Amount no puede ser negativo");
    });
  });

  describe("toMinorUnits()", () => {
    it("convierte pesos a centavos como entero", () => {
      expect(new Amount(100.5).toMinorUnits()).toBe(10050);
    });

    it("no acumula error de punto flotante en la conversion", () => {
      expect(new Amount(10.1).toMinorUnits()).toBe(1010);
      expect(new Amount(0.1).toMinorUnits()).toBe(10);
    });

    it("convierte un monto entero sin decimales", () => {
      expect(new Amount(50000).toMinorUnits()).toBe(5000000);
    });
  });

  describe("equals()", () => {
    it("es true para dos instancias con el mismo valor", () => {
      expect(new Amount(100.5).equals(new Amount(100.5))).toBe(true);
    });

    it("es false para dos instancias con valores distintos", () => {
      expect(new Amount(100.5).equals(new Amount(100.51))).toBe(false);
    });
  });
});
