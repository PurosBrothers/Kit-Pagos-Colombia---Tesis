import { Payer } from "../../../src/domain/value-objects/Payer";

describe("Payer", () => {
  describe("construcción válida", () => {
    it("acepta solo el email, ya que es el único campo obligatorio", () => {
      const payer = new Payer({ email: "cliente@example.com" });
      expect(payer.email).toBe("cliente@example.com");
      expect(payer.fullName).toBeUndefined();
      expect(payer.documentType).toBeUndefined();
      expect(payer.documentNumber).toBeUndefined();
      expect(payer.phone).toBeUndefined();
    });

    it("preserva todos los campos opcionales cuando se proveen", () => {
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

  describe("invariantes de validación", () => {
    it("rechaza la ausencia de email", () => {
      expect(
        () => new Payer({ email: undefined as unknown as string }),
      ).toThrow("Payer requiere el campo email");
    });

    it("rechaza un email vacío", () => {
      expect(() => new Payer({ email: "" })).toThrow(
        "Payer requiere el campo email",
      );
    });
  });
});