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
      // -50.00 no tiene parte decimal en su string canonico ("-50"), por lo
      // que debe llegar hasta la segunda validacion y fallar por ser negativo.
      expect(() => new Amount(-50.0)).toThrow("Amount no puede ser negativo");
    });

    it("acepta montos que la validacion aritmetica anterior rechazaba por error", () => {
      // docs/architecture/money-representation-analysis.md: estos valores
      // tienen exactamente 2 decimales, pero value * 100 produce un
      // resultado imprecise en IEEE 754 (ej. 19.99 * 100 = 1998.9999999999998).
      // La validacion basada en Number.prototype.toString() no hace esa
      // multiplicacion, asi que los acepta correctamente.
      expect(new Amount(19.99).getValue()).toBe(19.99);
      expect(new Amount(1.15).getValue()).toBe(1.15);
      expect(new Amount(4.65).getValue()).toBe(4.65);
      expect(new Amount(0.29).getValue()).toBe(0.29);
    });

    it("rechaza NaN e Infinity con un mensaje especifico", () => {
      expect(() => new Amount(NaN)).toThrow("Amount debe ser un numero finito");
      expect(() => new Amount(Infinity)).toThrow("Amount debe ser un numero finito");
      expect(() => new Amount(-Infinity)).toThrow("Amount debe ser un numero finito");
    });

    it("rechaza un monto contaminado por aritmetica previa sin redondear", () => {
      // 10.1 * 3 en JS da 30.299999999999997, y 0.1 + 0.2 da
      // 0.30000000000000004. Ambos deben rechazarse: quien llama debe
      // redondear explicitamente antes de construir el Amount, en vez de
      // que el Value Object absorba el error silenciosamente.
      expect(() => new Amount(10.1 * 3)).toThrow(
        "Amount solo admite hasta dos decimales significativos",
      );
      expect(() => new Amount(0.1 + 0.2)).toThrow(
        "Amount solo admite hasta dos decimales significativos",
      );
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
