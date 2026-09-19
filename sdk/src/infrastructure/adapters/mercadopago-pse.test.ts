import {
  assertPseRequirements,
  buildPseOrderPayload,
  extractOrderRedirect,
  isOrderId,
  toWholePesos,
} from "./mercadopago-pse";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

/** Solicitud con todo lo que la Orders API exige, medido contra la API real. */
function completeRequest(): CreatePaymentRequest {
  return {
    amount: new Amount("150000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-mp-pse-1"),
    payer: new Payer({
      email: "cliente@example.com",
      firstName: "Juan",
      lastName: "Perez Gomez",
      documentType: "CC",
      documentNumber: "1099888777",
      phone: "3001234567",
      phoneAreaCode: "57",
      address: {
        streetName: "Calle 10",
        streetNumber: "100",
        city: "Bogota",
        zipCode: "110111",
        neighborhood: "Centro",
      },
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: "1051" }),
    returnUrlConfig: new ReturnUrlConfig("https://comercio.example.com/retorno"),
    ipAddress: "200.100.50.25",
  };
}

describe("toWholePesos", () => {
  /**
   * Medido el 18 de septiembre de 2026: `total_amount: "2000"` responde 201 y
   * `"2000.00"` responde 400 "Invalid value for property".
   */
  it("should drop a zero decimal part that the Orders API rejects", () => {
    expect(toWholePesos(new Amount("2000.00"))).toBe("2000");
    expect(toWholePesos(new Amount("150000.0"))).toBe("150000");
  });

  it("should keep an amount that has no decimal part", () => {
    expect(toWholePesos(new Amount("2000"))).toBe("2000");
  });

  /**
   * Redondear cambiaria el monto cobrado sin avisar, que es peor que fallar. Es
   * el mismo criterio con el que Amount.toMinorUnits() lanza en vez de truncar.
   */
  it("should refuse an amount with cents instead of rounding it", () => {
    try {
      toWholePesos(new Amount("2000.50"));
      fail("debia lanzar");
    } catch (error) {
      expect(error).toMatchObject({ code: KitPagosErrorCode.INVALID_REQUEST });
      expect((error as Error).message).toContain("2000.50");
    }
  });
});

describe("assertPseRequirements", () => {
  it("should accept a request that carries everything the Orders API demands", () => {
    expect(() => assertPseRequirements(completeRequest())).not.toThrow();
  });

  /**
   * Se acumulan todos los campos faltantes en un solo error para que el comercio
   * los corrija de una vez en lugar de descubrirlos de a uno.
   */
  it("should name every missing field in a single error", () => {
    const request: CreatePaymentRequest = {
      ...completeRequest(),
      payer: new Payer({ email: "cliente@example.com" }),
      returnUrlConfig: undefined,
      ipAddress: undefined,
    };

    try {
      assertPseRequirements(request);
      fail("debia lanzar");
    } catch (error) {
      const { message } = error as Error;
      expect(error).toMatchObject({ code: KitPagosErrorCode.INVALID_REQUEST });
      expect(message).toContain("payer.firstName");
      expect(message).toContain("payer.lastName");
      expect(message).toContain("payer.address");
      expect(message).toContain("ipAddress");
      expect(message).toContain("returnUrlConfig");
      expect(message).toContain("payer.documentType");
    }
  });

  /**
   * La asimetria mas concreta que aparecio entre dos pasarelas para el mismo
   * metodo: Wompi acepta un PSE sin URL de retorno (medido: 201) y Mercado Pago
   * lo rechaza, porque `config` es obligatorio en la Orders API.
   */
  it("should require a return URL, unlike Wompi", () => {
    const request = { ...completeRequest(), returnUrlConfig: undefined };

    expect(() => assertPseRequirements(request)).toThrow(/returnUrlConfig/);
  });

  it("should require the area code separately from the phone number", () => {
    const request: CreatePaymentRequest = {
      ...completeRequest(),
      payer: new Payer({
        email: "cliente@example.com",
        firstName: "Juan",
        lastName: "Perez",
        documentType: "CC",
        documentNumber: "1099888777",
        phone: "3001234567",
        address: {
          streetName: "Calle 10",
          streetNumber: "100",
          city: "Bogota",
          zipCode: "110111",
          neighborhood: "Centro",
        },
      }),
    };

    expect(() => assertPseRequirements(request)).toThrow(/phoneAreaCode/);
  });
});

describe("buildPseOrderPayload", () => {
  it("should build the body shape the Orders API accepted", () => {
    const payload = buildPseOrderPayload(completeRequest());

    expect(payload).toMatchObject({
      type: "online",
      total_amount: "150000",
      external_reference: "ord-mp-pse-1",
      payer: {
        email: "cliente@example.com",
        entity_type: "individual",
        identification: { type: "CC", number: "1099888777" },
        first_name: "Juan",
        last_name: "Perez Gomez",
        phone: { area_code: "57", number: "3001234567" },
        address: {
          street_name: "Calle 10",
          street_number: "100",
          city: "Bogota",
          zip_code: "110111",
          neighborhood: "Centro",
        },
      },
      transactions: {
        payments: [
          {
            amount: "150000",
            payment_method: {
              id: "pse",
              type: "bank_transfer",
              financial_institution: "1051",
            },
          },
        ],
      },
      config: {
        online: { callback_url: "https://comercio.example.com/retorno" },
      },
    });
  });

  /** La clave lleva un punto en el nombre; no es un objeto anidado. */
  it("should send the payer IP under the dotted key the API expects", () => {
    const payload = buildPseOrderPayload(completeRequest()) as {
      additional_info: Record<string, unknown>;
    };

    expect(payload.additional_info["payer.ip_address"]).toBe("200.100.50.25");
  });

  /**
   * Medido: con `entity_type: "association"` y un NIT la orden se crea y entrega
   * redireccion, asi que la naturaleza juridica viaja traducida y no como numero.
   */
  it("should translate a legal payer to the entity type the API names", () => {
    const payload = buildPseOrderPayload({
      ...completeRequest(),
      paymentMethod: PaymentMethod.pse({ bankCode: "1051", payerKind: "LEGAL" }),
    }) as { payer: { entity_type: string } };

    expect(payload.payer.entity_type).toBe("association");
  });

  it("should send whole pesos even when the merchant wrote the scale", () => {
    const payload = buildPseOrderPayload({
      ...completeRequest(),
      amount: new Amount("150000.00"),
    }) as { total_amount: string };

    expect(payload.total_amount).toBe("150000");
  });
});

describe("extractOrderRedirect", () => {
  /** Forma exacta devuelta por la API real el 18 de septiembre de 2026. */
  const createdOrder = {
    id: "ORD01M2V7ZQH9BAZ57V99VG1NY0K1",
    status: "action_required",
    status_detail: "waiting_transfer",
    total_amount: "2000",
    currency: "COP",
    external_reference: "ord-mp-pse-1",
    transactions: {
      payments: [
        {
          id: "PAY01M2V7ZQHMX28P0086V5NZ9QRM",
          status: "action_required",
          status_detail: "waiting_transfer",
          payment_method: {
            id: "pse",
            type: "bank_transfer",
            redirect_url: "https://www.mercadopago.com.co/payments/179749499276/bank_transfer",
            financial_institution: "1051",
          },
        },
      ],
    },
  };

  it("should read the redirect URL from the creation response", () => {
    const redirect = extractOrderRedirect(createdOrder);

    expect(redirect.redirectUrl).toBe(
      "https://www.mercadopago.com.co/payments/179749499276/bank_transfer",
    );
    expect(redirect.gatewayTransactionId.value).toBe("ORD01M2V7ZQH9BAZ57V99VG1NY0K1");
    expect(redirect.rawStatus).toBe("action_required");
  });

  /** El simulador envuelve la respuesta en `data`; la API real no. */
  it("should tolerate a response wrapped in data", () => {
    const redirect = extractOrderRedirect({ data: createdOrder });

    expect(redirect.redirectUrl).toContain("bank_transfer");
  });

  /**
   * Devolver una redireccion sin URL reproduce el defecto que PaymentResult
   * existe para impedir: el comercio no redirige a nadie y el pago queda colgado.
   * El error lleva el identificador porque la orden ya existe en la pasarela.
   */
  it("should fail naming the order when the URL is missing", () => {
    const withoutUrl = {
      ...createdOrder,
      transactions: {
        payments: [{ status: "action_required", payment_method: { id: "pse" } }],
      },
    };

    try {
      extractOrderRedirect(withoutUrl);
      fail("debia lanzar");
    } catch (error) {
      expect(error).toMatchObject({ code: KitPagosErrorCode.MALFORMED_RESPONSE });
      expect((error as Error).message).toContain("ORD01M2V7ZQH9BAZ57V99VG1NY0K1");
    }
  });
});

describe("isOrderId", () => {
  /**
   * Mercado Pago tiene dos familias de recursos con endpoints distintos y
   * getStatus() recibe un string plano, asi que el prefijo es lo unico que hay
   * para distinguirlas. Identificadores medidos contra la API real.
   */
  it("should recognise an order identifier", () => {
    expect(isOrderId("ORD01M2V7ZQH9BAZ57V99VG1NY0K1")).toBe(true);
  });

  it("should treat a numeric payment identifier as not an order", () => {
    expect(isOrderId("1234567890")).toBe(false);
  });
});
