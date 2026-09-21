import {
  assertPseRequirements,
  buildCustomerPayload,
  buildPsePaymentPayload,
  extractCustomerId,
  parseRapydPseBanks,
} from "./rapyd-pse";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

/**
 * Solicitud con todo lo que Rapyd exige para PSE, medido contra el sandbox real el
 * 18 de septiembre de 2026. Los cuatro datos del pagador no son un capricho: sin
 * `fullName` Rapyd responde `INVALID_CUSTOMER_NAME`, y sin `phone` o sin `email` el
 * rechazo llega en la segunda llamada, cuando el cliente ya quedó creado.
 */
function completeRequest(): CreatePaymentRequest {
  return {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-rapyd-pse-1"),
    payer: new Payer({
      email: "cliente@example.com",
      fullName: "Jaime Pavlich Mariscal",
      phone: "3001234567",
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: "co_pse_bancolombia_bank" }),
    returnUrlConfig: new ReturnUrlConfig("https://comercio.example.com/retorno"),
  };
}

describe("assertPseRequirements", () => {
  it("acepta una solicitud completa", () => {
    expect(() => assertPseRequirements(completeRequest())).not.toThrow();
  });

  /**
   * Acumular en vez de cortar en el primero importa más acá que en tarjeta: el flujo
   * son dos llamadas, y descubrir los cuatro campos de a uno son cuatro ciclos de
   * prueba y error, cada uno dejando un cliente huérfano en Rapyd.
   */
  it("junta todos los datos que faltan en un solo error", () => {
    const sinNada: CreatePaymentRequest = {
      ...completeRequest(),
      payer: new Payer({ email: "cliente@example.com" }),
    };

    try {
      assertPseRequirements(sinNada);
      throw new Error("debió lanzar");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("payer.fullName");
      expect(message).toContain("payer.phone");
      expect(message).toContain("payer.documentType");
      expect(message).toContain("payer.documentNumber");
    }
  });

  it("explica que el rechazo de Rapyd llega cuando el cliente ya existe", () => {
    const sinTelefono: CreatePaymentRequest = {
      ...completeRequest(),
      payer: new Payer({
        email: "cliente@example.com",
        fullName: "Jaime Pavlich Mariscal",
        documentType: "CC",
        documentNumber: "1099888777",
      }),
    };

    expect(() => assertPseRequirements(sinTelefono)).toThrow(
      /payer\.phone/,
    );
  });

  /**
   * El caso que esto ataja es concreto: un comercio que venía de Wompi o Mercado
   * Pago, donde el código de banco es un número, y cambió de pasarela sin cambiar el
   * valor. Rapyd contesta a eso `ERROR_GET_PAYMENT_METHOD_TYPE` con un mensaje que no
   * dice de dónde sacar el valor bueno.
   */
  it("rechaza un código de banco de otra pasarela y dice cómo conseguir el correcto", () => {
    const conCodigoNumerico: CreatePaymentRequest = {
      ...completeRequest(),
      paymentMethod: PaymentMethod.pse({ bankCode: "1051" }),
    };

    try {
      assertPseRequirements(conCodigoNumerico);
      throw new Error("debió lanzar");
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        KitPagosErrorCode.INVALID_REQUEST,
      );
      expect((error as Error).message).toContain("co_pse_");
      expect((error as Error).message).toContain("getPseBanks()");
    }
  });
});

describe("buildCustomerPayload", () => {
  it("manda nombre, correo y teléfono, que es lo mínimo que Rapyd acepta", () => {
    expect(buildCustomerPayload(completeRequest())).toEqual({
      name: "Jaime Pavlich Mariscal",
      email: "cliente@example.com",
      phone_number: "3001234567",
    });
  });

  /**
   * Se midió que Rapyd acepta `+573001234567` y `3001234567` por igual, así que el
   * adaptador no transforma el número. Esta prueba fija esa decisión: si alguien
   * agregara un prefijo "para que quede bien", acá se nota.
   */
  it("no le agrega el prefijo internacional al teléfono", () => {
    const payload = buildCustomerPayload(completeRequest());
    expect(payload.phone_number).toBe("3001234567");
  });
});

describe("buildPsePaymentPayload", () => {
  it("arma el pago con el cliente y el método de PSE", () => {
    const payload = buildPsePaymentPayload(completeRequest(), "cus_abc123");

    expect(payload.customer).toBe("cus_abc123");
    expect(payload.currency).toBe("COP");
    expect(payload.merchant_reference_id).toBe("ord-rapyd-pse-1");
    expect(payload.payment_method).toEqual({
      type: "co_pse_bancolombia_bank",
      fields: {
        customer_identification_type: "CC",
        customer_identification_number: "1099888777",
      },
    });
  });

  /**
   * El monto va en pesos y no en centavos, y como string con la escala de la divisa.
   * Si alguien usara `toMinorUnits()` como en Wompi, el cobro se multiplicaría por
   * cien, y esta prueba es la que lo atrapa.
   */
  it("manda el monto en pesos y como string con escala", () => {
    const payload = buildPsePaymentPayload(completeRequest(), "cus_abc123");
    expect(payload.amount).toBe("150000.00");
  });

  /**
   * Las dos URL del comercio son el único rastro medible de que `ReturnUrlConfig`
   * se envía de verdad: Rapyd las incrusta en la `redirect_url` que devuelve.
   */
  it("envía las dos URL de retorno del comercio", () => {
    const payload = buildPsePaymentPayload(completeRequest(), "cus_abc123");
    expect(payload.complete_payment_url).toBe("https://comercio.example.com/retorno");
    expect(payload.error_payment_url).toBe("https://comercio.example.com/retorno");
  });

  it("omite las URL cuando el comercio no las informó", () => {
    const sinRetorno: CreatePaymentRequest = {
      ...completeRequest(),
      returnUrlConfig: undefined,
    };

    const payload = buildPsePaymentPayload(sinRetorno, "cus_abc123");
    expect(payload).not.toHaveProperty("complete_payment_url");
    expect(payload).not.toHaveProperty("error_payment_url");
  });
});

describe("extractCustomerId", () => {
  it("saca el identificador del cliente", () => {
    expect(
      extractCustomerId({ data: { id: "cus_01f2f7ddace1fc8aa19ae9c535d7fb57" } }),
    ).toBe("cus_01f2f7ddace1fc8aa19ae9c535d7fb57");
  });

  /**
   * Seguir con el pago sin identificador mandaría `customer: undefined` y produciría
   * un rechazo confuso de la segunda llamada, que apunta al lugar equivocado.
   */
  it.each([
    ["sin id", { data: {} }],
    ["id vacío", { data: { id: "" } }],
    ["sin data", {}],
    ["nulo", null],
  ])("falla con MALFORMED_RESPONSE cuando la respuesta viene %s", (_caso, respuesta) => {
    expect(() => extractCustomerId(respuesta)).toThrow(
      expect.objectContaining({ code: KitPagosErrorCode.MALFORMED_RESPONSE }),
    );
  });
});

describe("parseRapydPseBanks", () => {
  /** Forma medida: 97 métodos para Colombia, de los cuales 47 son de PSE. */
  const catalogo = {
    data: [
      {
        type: "co_pse_bancolombia_bank",
        name: "Bancolombia",
        category: "bank_redirect",
      },
      {
        type: "co_pse_banco_davivienda_bank",
        name: "Banco Davivienda",
        category: "bank_redirect",
      },
      { type: "co_visa_card", name: "Visa", category: "card" },
    ],
  };

  it("devuelve el tipo completo como código, que es lo que PaymentMethod.pse espera", () => {
    expect(parseRapydPseBanks(catalogo)).toEqual([
      { code: "co_pse_bancolombia_bank", name: "Bancolombia" },
      { code: "co_pse_banco_davivienda_bank", name: "Banco Davivienda" },
    ]);
  });

  /**
   * Es la única pasarela donde la lista de bancos es un filtro sobre un catálogo
   * mezclado, así que dejar pasar un método que no es PSE le pondría al pagador una
   * opción que falla al elegirla.
   */
  it("descarta los métodos que no son de PSE", () => {
    const codigos = parseRapydPseBanks(catalogo).map((banco) => banco.code);
    expect(codigos).not.toContain("co_visa_card");
  });

  it("no revienta con respuestas vacías o inesperadas", () => {
    expect(parseRapydPseBanks({ data: [] })).toEqual([]);
    expect(parseRapydPseBanks({})).toEqual([]);
    expect(parseRapydPseBanks(null)).toEqual([]);
  });

  it("usa el tipo como nombre cuando la pasarela no lo manda", () => {
    expect(
      parseRapydPseBanks({ data: [{ type: "co_pse_banco_raro_bank" }] }),
    ).toEqual([{ code: "co_pse_banco_raro_bank", name: "co_pse_banco_raro_bank" }]);
  });
});
