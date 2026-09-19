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

  describe("cuotas y token opcional", () => {
    it("una tarjeta sin cuotas informadas es un pago de una cuota", () => {
      expect(PaymentMethod.card("tok").installments).toBe(1);
    });

    it("conserva las cuotas pedidas", () => {
      expect(PaymentMethod.card("tok", { installments: 12 }).installments).toBe(12);
    });

    it("rechaza cuotas que no son un entero positivo", () => {
      expect(() => PaymentMethod.card("tok", { installments: 0 })).toThrow(
        "PaymentMethod.card requiere installments entero y mayor o igual a 1",
      );
      expect(() => PaymentMethod.card("tok", { installments: 1.5 })).toThrow();
      expect(() => PaymentMethod.card("tok", { installments: -3 })).toThrow();
    });

    /**
     * El token es opcional porque Rapyd cobra tarjeta en su propia página y no hay token
     * que mandar: cobrar un token guardado responde `ERROR_CARD_NOT_AUTHENTICATED` y el
     * único camino que funciona exige el número de la tarjeta, que el SDK no acepta.
     * Las tres pasarelas que sí lo usan fallan con INVALID_REQUEST si falta.
     */
    it("permite una tarjeta sin token, para las pasarelas que cobran en su página", () => {
      const method = PaymentMethod.card();

      expect(method.type).toBe("CARD");
      expect(method.cardToken).toBeUndefined();
      expect(method.installments).toBe(1);
    });

    it("sigue rechazando un token vacío, que es un dato mal puesto y no una omisión", () => {
      expect(() => PaymentMethod.card("")).toThrow(
        "PaymentMethod.card requiere cardToken",
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
    });
  });
});
