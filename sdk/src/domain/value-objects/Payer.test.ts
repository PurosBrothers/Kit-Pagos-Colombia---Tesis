import { Payer } from "../../../src/domain/value-objects/Payer";

describe("Payer", () => {
  describe("valid construction", () => {
    it("accepts only the email, since it is the only required field", () => {
      const payer = new Payer({ email: "cliente@example.com" });
      expect(payer.email).toBe("cliente@example.com");
      expect(payer.fullName).toBeUndefined();
      expect(payer.documentType).toBeUndefined();
      expect(payer.documentNumber).toBeUndefined();
      expect(payer.phone).toBeUndefined();
    });

    it("preserves all optional fields when provided", () => {
      const payer = new Payer({
        email: "cliente@example.com",
        fullName: "Juan Pérez",
        documentType: "CC",
        documentNumber: "123456789",
        phone: "+573001234567",
      });
      expect(payer.email).toBe("cliente@example.com");
      expect(payer.fullName).toBe("Juan Pérez");
      expect(payer.documentType).toBe("CC");
      expect(payer.documentNumber).toBe("123456789");
      expect(payer.phone).toBe("+573001234567");
    });
  });

  describe("validation invariants", () => {
    it("rejects a missing email", () => {
      expect(
        () => new Payer({ email: undefined as unknown as string }),
      ).toThrow("Payer requiere el campo email");
    });

    it("rejects an empty email", () => {
      expect(() => new Payer({ email: "" })).toThrow(
        "Payer requiere el campo email",
      );
    });
  });
});