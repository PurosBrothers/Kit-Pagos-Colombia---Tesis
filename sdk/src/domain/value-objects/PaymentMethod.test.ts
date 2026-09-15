import { PaymentMethod } from "./PaymentMethod";

describe("PaymentMethod", () => {
  describe("card", () => {
    it("construye un método de tarjeta con su token", () => {
      const method = PaymentMethod.card("tok_visa_4242");

      expect(method.type).toBe("CARD");
      expect(method.cardToken).toBe("tok_visa_4242");
    });

    it("rechaza un token vacío", () => {
      // Un token vacío llegaría a la pasarela como un pago sin instrumento y
      // volvería como un 400 genérico difícil de diagnosticar.
      expect(() => PaymentMethod.card("")).toThrow(
        "PaymentMethod.card requiere cardToken",
      );
    });

    it("no expone datos de otros métodos", () => {
      const method = PaymentMethod.card("tok_visa_4242");

      expect(method.bankCode).toBeUndefined();
      expect(method.payerKind).toBeUndefined();
      expect(method.cashNetwork).toBeUndefined();
    });
  });

  describe("pse", () => {
    it("construye un método PSE con su banco", () => {
      const method = PaymentMethod.pse({ bankCode: "1" });

      expect(method.type).toBe("PSE");
      expect(method.bankCode).toBe("1");
    });

    it("asume pagador natural cuando no se informa", () => {
      // Es el caso mayoritario; obligar a declararlo en cada llamada solo
      // agregaría ceremonia sin evitar ningún error.
      expect(PaymentMethod.pse({ bankCode: "1" }).payerKind).toBe("NATURAL");
    });

    it("respeta un pagador jurídico explícito", () => {
      const method = PaymentMethod.pse({
        bankCode: "co_pse_bancolombia_bank",
        payerKind: "LEGAL",
      });

      expect(method.payerKind).toBe("LEGAL");
    });

    it("rechaza un banco vacío", () => {
      // En PSE no existe "el banco por defecto": el pagador siempre elige uno.
      expect(() => PaymentMethod.pse({ bankCode: "" })).toThrow(
        "PaymentMethod.pse requiere bankCode",
      );
    });

    it("acepta el código de banco de cualquier pasarela sin interpretarlo", () => {
      // El dominio no valida la forma del código porque cada pasarela usa la
      // suya: Wompi un número, Kushki su bankId, Rapyd el nombre del método.
      // Ver PaymentMethod.ts y architecture-log.md punto 19.
      expect(PaymentMethod.pse({ bankCode: "1" }).bankCode).toBe("1");
      expect(
        PaymentMethod.pse({ bankCode: "co_pse_banco_davivienda_bank" })
          .bankCode,
      ).toBe("co_pse_banco_davivienda_bank");
    });
  });

  describe("cash", () => {
    it("construye un método de efectivo sin red", () => {
      const method = PaymentMethod.cash();

      expect(method.type).toBe("CASH");
      expect(method.cashNetwork).toBeUndefined();
    });

    it("construye un método de efectivo con red explícita", () => {
      expect(PaymentMethod.cash({ network: "EFECTY" }).cashNetwork).toBe(
        "EFECTY",
      );
    });
  });

  describe("requiresPayerDocument", () => {
    it("solo PSE exige documento del pagador", () => {
      // PSE lo exige en las cuatro pasarelas: es requisito de la red, no de un
      // proveedor. En Rapyd son customer_identification_type y _number, ambos
      // con is_required true en los 47 métodos co_pse_* del catálogo colombiano.
      expect(PaymentMethod.pse({ bankCode: "1" }).requiresPayerDocument()).toBe(
        true,
      );
      expect(PaymentMethod.card("tok").requiresPayerDocument()).toBe(false);
      expect(PaymentMethod.cash().requiresPayerDocument()).toBe(false);
    });
  });
});
