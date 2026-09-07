import { OrderReference } from "../../../src/domain/value-objects/OrderReference";

describe("OrderReference", () => {
  describe("valid construction", () => {
    it("accepts a non-empty value and preserves it", () => {
      const ref = new OrderReference("ORD-001");
      expect(ref.getValue()).toBe("ORD-001");
    });
  });

  describe("validation invariants", () => {
    it("rejects an empty value", () => {
      expect(() => new OrderReference("")).toThrow(
        "OrderReference no puede estar vacio",
      );
    });

    it("rejects a whitespace-only value", () => {
      expect(() => new OrderReference("   ")).toThrow(
        "OrderReference no puede estar vacio",
      );
    });
  });

  describe("equals()", () => {
    it("is true for instances with the same value", () => {
      const a = new OrderReference("ORD-001");
      const b = new OrderReference("ORD-001");
      expect(a.equals(b)).toBe(true);
    });

    it("is false for instances with different values", () => {
      const a = new OrderReference("ORD-001");
      const b = new OrderReference("ORD-002");
      expect(a.equals(b)).toBe(false);
    });
  });
});