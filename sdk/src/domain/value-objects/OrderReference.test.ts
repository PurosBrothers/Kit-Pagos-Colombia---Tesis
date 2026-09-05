import { OrderReference } from "../../../src/domain/value-objects/OrderReference";

describe("OrderReference", () => {
  describe("construcción válida", () => {
    it("acepta un valor no vacío y lo preserva", () => {
      const ref = new OrderReference("ORD-001");
      expect(ref.getValue()).toBe("ORD-001");
    });
  });

  describe("invariantes de validación", () => {
    it("rechaza un valor vacío", () => {
      expect(() => new OrderReference("")).toThrow(
        "OrderReference no puede estar vacio",
      );
    });

    it("rechaza un valor compuesto solo de espacios", () => {
      expect(() => new OrderReference("   ")).toThrow(
        "OrderReference no puede estar vacio",
      );
    });
  });

  describe("equals()", () => {
    it("es true para instancias con el mismo valor", () => {
      const a = new OrderReference("ORD-001");
      const b = new OrderReference("ORD-001");
      expect(a.equals(b)).toBe(true);
    });

    it("es false para instancias con valores distintos", () => {
      const a = new OrderReference("ORD-001");
      const b = new OrderReference("ORD-002");
      expect(a.equals(b)).toBe(false);
    });
  });
});