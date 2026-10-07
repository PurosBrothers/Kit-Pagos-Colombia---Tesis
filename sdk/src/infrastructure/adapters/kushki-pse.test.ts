import {
  assertPseRequirements,
  buildTransferTokenPayload,
  extractTransferToken,
  extractTransferRedirect,
  buildTransferInitPayload,
  kushkiStatusPaths,
  parseKushkiPseBanks,
  KUSHKI_DOCUMENT_TYPES,
} from "./kushki-pse";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";
import { TaxBreakdown } from "../../domain/value-objects/TaxBreakdown";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

function completeRequest(): CreatePaymentRequest {
  return {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-kushki-pse-1"),
    payer: new Payer({
      email: "cliente@example.com",
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: "007" }),
    returnUrlConfig: new ReturnUrlConfig("https://comercio.example.com/retorno"),
  };
}

const exemptBreakdown = (request: CreatePaymentRequest): TaxBreakdown =>
  TaxBreakdown.exempt(request.amount, request.currency);

describe("assertPseRequirements", () => {
  it("accepts a complete request", () => {
    expect(() => assertPseRequirements(completeRequest())).not.toThrow();
  });

  /**
   * El banco no aparece en esta lista porque **no puede faltar**:
   * `PaymentMethod.pse()` rechaza construirse sin él, así que el objeto de valor ya
   * hizo imposible ese estado y el adaptador no necesita volver a comprobarlo.
   */
  it("gathers all missing data into a single error", () => {
    const emptyRequest: CreatePaymentRequest = {
      amount: new Amount("150000.00"),
      currency: new Currency("COP"),
      orderReference: new OrderReference("ord-kushki-pse-1"),
      payer: new Payer({ email: "cliente@example.com" }),
      paymentMethod: PaymentMethod.pse({ bankCode: "007" }),
    };

    try {
      assertPseRequirements(emptyRequest);
      throw new Error("debió lanzar");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("payer.documentType");
      expect(message).toContain("payer.documentNumber");
      expect(message).toContain("returnUrlConfig");
    }
  });

  /**
   * La URL de retorno es obligatoria en PSE y opcional en tarjeta, porque en Kushki
   * viaja al pedir el token. Sin ella el pagador llega al banco sin camino de vuelta
   * al comercio, así que el SDK no deja arrancar el cobro.
   */
  it("requires the return URL, which is optional for cards", () => {
    const withoutReturnUrl: CreatePaymentRequest = {
      ...completeRequest(),
      returnUrlConfig: undefined,
    };

    expect(() => assertPseRequirements(withoutReturnUrl)).toThrow(/returnUrlConfig/);
  });

  /**
   * El enum de la API de Kushki incluye tipos de documento de otros países. Que la
   * API los liste no los hace válidos para Colombia, y aceptarlos localmente sería
   * dejar pasar algo que Kushki va a rechazar después.
   */
  it("rejects document types that are not from Colombia", () => {
    const withForeignDocument: CreatePaymentRequest = {
      ...completeRequest(),
      payer: new Payer({
        email: "cliente@example.com",
        // `RUT` es de Chile y está en el enum de la API.
        documentType: "RUT",
        documentNumber: "1099888777",
      }),
    };

    try {
      assertPseRequirements(withForeignDocument);
      throw new Error("debió lanzar");
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        KitPagosErrorCode.INVALID_REQUEST,
      );
      expect((error as Error).message).toContain("RUT");
    }
  });

  it("accepts the five Colombian document types", () => {
    for (const documentType of KUSHKI_DOCUMENT_TYPES) {
      const request: CreatePaymentRequest = {
        ...completeRequest(),
        payer: new Payer({
          email: "cliente@example.com",
          documentType,
          documentNumber: "1099888777",
        }),
      };
      expect(() => assertPseRequirements(request)).not.toThrow();
    }
  });
});

describe("buildTransferTokenPayload", () => {
  it("sends the bank, the document and the itemized amount", () => {
    const request = completeRequest();
    const payload = buildTransferTokenPayload(request, exemptBreakdown(request));

    expect(payload.bankId).toBe("007");
    expect(payload.documentType).toBe("CC");
    expect(payload.documentNumber).toBe("1099888777");
    expect(payload.email).toBe("cliente@example.com");
    expect(payload.currency).toBe("COP");
    expect(payload.amount).toEqual({
      subtotalIva0: 150000,
      subtotalIva: 0,
      iva: 0,
      ice: 0,
      currency: "COP",
    });
  });

  /**
   * Es el punto que hace a Kushki distinta de las otras tres: la URL de retorno del
   * comercio viaja en el paso del token, no en el del cobro. Esta prueba es la que
   * cierra la pieza 3 del issue #64 para esta pasarela.
   */
  it("sends the merchant return URL as callbackUrl", () => {
    const request = completeRequest();
    const payload = buildTransferTokenPayload(request, exemptBreakdown(request));

    expect(payload.callbackUrl).toBe("https://comercio.example.com/retorno");
  });

  it("maps the payer type to Kushki's userType", () => {
    const request = completeRequest();
    expect(buildTransferTokenPayload(request, exemptBreakdown(request)).userType).toBe("0");

    const legalEntity: CreatePaymentRequest = {
      ...request,
      paymentMethod: PaymentMethod.pse({ bankCode: "007", payerKind: "LEGAL" }),
    };
    expect(buildTransferTokenPayload(legalEntity, exemptBreakdown(legalEntity)).userType).toBe("1");
  });
});

describe("extractTransferToken", () => {
  it("extracts the token from the first step", () => {
    expect(extractTransferToken({ token: "abc123" })).toBe("abc123");
  });

  it.each([
    ["sin token", {}],
    ["token vacío", { token: "" }],
    ["nulo", null],
  ])("fails with MALFORMED_RESPONSE when %s comes back", (_scenario, nativeResponse) => {
    expect(() => extractTransferToken(nativeResponse)).toThrow(
      expect.objectContaining({ code: KitPagosErrorCode.MALFORMED_RESPONSE }),
    );
  });
});

describe("extractTransferRedirect", () => {
  /**
   * El identificador de la transacción es el token del primer paso, no un id nuevo:
   * la consulta de estado en Kushki es por token. El comercio lo usa en
   * `getPaymentStatus()` sin tener que saber que es un token.
   */
  it("uses the token as the transaction identifier", () => {
    const redirect = extractTransferRedirect(
      { redirectUrl: "https://pse.example.com/authorize?token=abc" },
      "abc123",
    );

    expect(redirect.gatewayTransactionId.value).toBe("abc123");
    expect(redirect.redirectUrl).toBe("https://pse.example.com/authorize?token=abc");
  });

  /**
   * La respuesta real de `init` no trae estado: son `bankId`, `bankName`,
   * `redirectUrl`, `transactionReference` y `trazabilityCode`. El valor que se
   * reporta es el estado nativo que la consulta devuelve en ese momento, medido
   * contra la API UAT. Antes decía `INITIALIZED`, del vocabulario de tarjeta.
   */
  it("reports initializedTransaction when the init response has no status", () => {
    const redirect = extractTransferRedirect(
      {
        bankId: "0001",
        bankName: "Kushki bank Colombia",
        redirectUrl: "https://pse.example.com/authorize",
        transactionReference: "adb294b7-a13b-480b-8c63-8a6641b31d8d",
        trazabilityCode: "874572172",
      },
      "abc123",
    );

    expect(redirect.rawStatus).toBe("initializedTransaction");
  });

  it("fails if there is no URL, because without it the payer cannot authorize", () => {
    expect(() => extractTransferRedirect({ status: "INITIALIZED" }, "abc")).toThrow(
      expect.objectContaining({ code: KitPagosErrorCode.MALFORMED_RESPONSE }),
    );
  });
});

describe("kushkiStatusPaths", () => {
  /**
   * La transferencia va **primero**, y eso salió de medir: `GET /charges/{id}`
   * responde `403 Forbidden` para cualquier identificador, igual que una ruta que no
   * existe, así que por esa ruta no se puede encadenar nada. La de transferencia sí
   * discrimina: `200` para un token que conoce, `400 T004` para un id de 32 caracteres que
   * no existe y `400 T001` para uno de otra longitud (`docs/testing-data/kushki.md` §1.1).
   */
  it("offers the transfer route first, which is the one able to say it does not know the id", () => {
    expect(kushkiStatusPaths("abc123")).toEqual([
      "/transfer/v1/status/abc123",
      "/card-async/v1/status/abc123",
      "/charges/abc123",
    ]);
  });

  /*
   * La consulta asíncrona de tarjeta está en la lista porque **existe**: se midió `400
   * CAS004 "No existe la transacción"` con la llave privada y `401` con la pública, que es
   * el mismo patrón de la ruta de PSE. La primera medición la pasó por alto buscando
   * nombres de recurso en vez de la analogía de la ruta de PSE, y de ahí salió la
   * afirmación —falsa— de que Kushki no publica ninguna consulta de tarjeta.
   */
  it("includes the asynchronous card query, which is the one Kushki does publish", () => {
    expect(kushkiStatusPaths("abc123")).toContain("/card-async/v1/status/abc123");
  });

  /**
   * El mismo identificador produce las mismas rutas siempre. Es lo que diferencia
   * esto de una heurística: no hay ningún formato que lo pueda hacer fallar.
   */
  it("does not depend on the shape of the identifier", () => {
    expect(kushkiStatusPaths("123456789012345678")).toHaveLength(3);
    expect(kushkiStatusPaths("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")).toHaveLength(3);
  });
});

describe("buildTransferInitPayload", () => {
  /**
   * Medido contra la API UAT: `{ token }` a secas responde `400 T001` y
   * `{ token, amount }` responde `201`. Hay que repetir el monto que ya viajó al
   * pedir el token, aunque Kushki lo tenga guardado.
   */
  it("sends the token and repeats the amount, because with only the token Kushki answers 400", () => {
    const payload = buildTransferInitPayload(
      "06555daf6e1f41188d6a06e0c8656e7e",
      TaxBreakdown.exempt(new Amount("50000"), new Currency("COP")),
      "COP",
    );

    expect(payload).toEqual({
      token: "06555daf6e1f41188d6a06e0c8656e7e",
      amount: {
        subtotalIva0: 50000,
        subtotalIva: 0,
        iva: 0,
        ice: 0,
        currency: "COP",
      },
    });
  });

  /**
   * El monto del inicio tiene que ser el mismo que el del token: si las dos copias
   * se separaran, Kushki responde 400 sin decir qué componente no coincide.
   */
  it("breaks down the amount the same way as the token step", () => {
    const taxBreakdown = TaxBreakdown.fromTaxIncluded(
      new Amount("119000"),
      "19",
      new Currency("COP"),
    );

    const tokenPayload = buildTransferTokenPayload(completeRequest(), taxBreakdown);
    const initPayload = buildTransferInitPayload("tok", taxBreakdown, "COP");

    expect(initPayload.amount).toEqual(tokenPayload.amount);
  });
});

describe("parseKushkiPseBanks", () => {
  /**
   * La lista real empieza con `{ code: "0", name: "A continuación seleccione su
   * banco" }`: el texto de relleno de un `<select>` viajando dentro de los datos.
   * Sin este filtro, un comercio que muestre la lista tal cual ofrece ese texto como
   * si fuera un banco, y quien tome el primer elemento cobra contra el banco "0".
   */
  it("drops the filler element the real API puts at the head of the list", () => {
    const banks = parseKushkiPseBanks([
      { code: "0", name: "A continuación seleccione su banco" },
      { code: "0001", name: "Kushki bank Colombia" },
    ]);

    expect(banks).toEqual([{ code: "0001", name: "Kushki bank Colombia" }]);
  });


  it("maps the list to codes and names", () => {
    expect(
      parseKushkiPseBanks([
        { code: "007", name: "Davivienda" },
        { code: "001", name: "Bancolombia" },
      ]),
    ).toEqual([
      { code: "007", name: "Davivienda" },
      { code: "001", name: "Bancolombia" },
    ]);
  });

  /**
   * La API real usa `code`, medido. Se aceptan igual las tres variantes porque la
   * referencia de Kushki no es consistente entre secciones sobre cómo se llama el
   * campo, y equivocarse aquí deja al comercio con una lista vacía y sin ninguna pista
   * de por qué.
   */
  it.each([
    ["code", [{ code: "007", name: "Davivienda" }]],
    ["id", [{ id: "007", name: "Davivienda" }]],
    ["bankId", [{ bankId: "007", name: "Davivienda" }]],
  ])("accepts the code in the %s field", (_fieldName, items) => {
    expect(parseKushkiPseBanks(items)).toEqual([
      { code: "007", name: "Davivienda" },
    ]);
  });

  it("accepts the list wrapped in an object and numeric codes", () => {
    expect(parseKushkiPseBanks({ banks: [{ code: 7, name: "Davivienda" }] })).toEqual([
      { code: "7", name: "Davivienda" },
    ]);
  });

  it("does not crash on empty or unexpected responses", () => {
    expect(parseKushkiPseBanks([])).toEqual([]);
    expect(parseKushkiPseBanks({})).toEqual([]);
    expect(parseKushkiPseBanks(null)).toEqual([]);
  });
});
