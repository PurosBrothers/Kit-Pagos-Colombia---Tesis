import {
  isKushkiTransferResponse,
  normalizeKushkiTransfer,
} from "./kushki-transfer";
import { KushkiResponseNormalizer } from "./KushkiResponseNormalizer";
import { Gateway } from "../../../domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../../domain/value-objects/KitPagosErrorCode";

/**
 * Lectura de las respuestas de transferencia (PSE) de Kushki.
 *
 * ## Qué defecto cubren estas pruebas
 *
 * Que el normalizador de Kushki **no podía leer una transferencia real**. Medido
 * contra la API UAT el 18 de septiembre de 2026: la consulta de estado de una
 * transferencia no trae `ticketNumber`, que es el campo sin el cual el camino de
 * tarjeta rechaza la respuesta, así que `getPaymentStatus()` de un PSE de Kushki
 * fallaba con `MALFORMED_RESPONSE: missing ticketNumber`.
 *
 * Las pruebas anteriores no lo veían porque el mock del simulador devolvía la forma
 * de tarjeta con el token metido en `ticketNumber` —una forma que Kushki nunca
 * produce— y el comentario del propio mock lo decía: la reusaba "para que el
 * normalizador la entienda sin ramas nuevas". Es el hallazgo de los puntos 43, 44 y
 * 48: un mock escrito a partir de lo que el código espera confirma el código en vez
 * de verificarlo.
 *
 * El cuerpo de `respuestaMedida()` es literalmente el que devolvió la API, con los
 * valores cambiados por unos de prueba.
 */
function respuestaMedida(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    userId: "-",
    merchantName: "KIT PAGOS COLOMBIA Branch Colombia",
    status: "initializedTransaction",
    currency: "COP",
    userType: "0",
    documentType: "CC",
    transactionReference: "226e3ff4-5ee9-4315-aca9-8e9f87d1fb48",
    token: "7a932344733646f3b3a48187f8715e8e",
    amount: {
      currency: "COP",
      ice: 0,
      subtotalIva: 0,
      subtotalIva0: 50000,
      iva: 0,
    },
    documentNumber: "123456789",
    created: 1789775795525,
    bankId: "0001",
    sessionId: "-",
    email: "comprador@example.com",
    publicMerchantId: "20000000107786285000",
    paymentDescription: "ORDER-PSE-1789775019380",
    country: "Colombia",
    userIp: "98.98.26.164",
    callbackUrl: "https://comercio.example.com/retorno",
    transactionCycle: "-",
    trazabilityCode: "-",
    ...overrides,
  };
}

/**
 * La respuesta de una transferencia **ya iniciada**, que es el único momento en que
 * un comercio la consulta. Medida sobre un pago creado por el SDK contra la API UAT:
 * trae catorce campos más que la anterior, y entre ellos `ticketNumber`, que Kushki
 * asigna al llegar al procesador.
 */
function respuestaIniciadaMedida(): Record<string, unknown> {
  return respuestaMedida({
    ticketNumber: "9777055831970452",
    entityCode: "9010003304",
    processorId: "6000000000178390266153836897835",
    processorState: "PENDING",
    transferProcessor: "Pse Processor",
    returnCode: "SUCCESS",
    serviceCode: "1",
    trazabilityCode: "889986284",
    transactionCycle: "1",
  });
}

describe("isKushkiTransferResponse", () => {
  it("reconoce una respuesta de transferencia recién tokenizada", () => {
    expect(isKushkiTransferResponse(respuestaMedida())).toBe(true);
  });

  /**
   * Es la regresión del defecto que encontró recorrer el flujo completo: después de
   * iniciar la transferencia, la respuesta **también** trae `ticketNumber`. El
   * discriminador anterior —"token sin ticket"— mandaba esta respuesta al camino de
   * tarjeta, que no encuentra `transaction_status` y devuelve `ERROR` sobre un pago
   * vivo. Y es justo la respuesta que un comercio consulta.
   */
  it("reconoce una transferencia ya iniciada, que además trae ticketNumber", () => {
    expect(isKushkiTransferResponse(respuestaIniciadaMedida())).toBe(true);
  });

  it("no confunde un cobro con tarjeta, que nombra su estado transaction_status", () => {
    expect(
      isKushkiTransferResponse({
        ticketNumber: "123456789012345678",
        transaction_status: "APPROVAL",
      }),
    ).toBe(false);
  });

  /** Sin ningún campo de estado no hay nada que enrutar: no es una transferencia. */
  it("no toma por transferencia una respuesta sin estado", () => {
    expect(isKushkiTransferResponse({ token: "tok-de-tarjeta" })).toBe(false);
  });
});

describe("normalizeKushkiTransfer", () => {
  it("lee la respuesta medida de la API real", () => {
    const transaction = normalizeKushkiTransfer(respuestaMedida(), null);

    expect(transaction.gatewayTransactionId.value).toBe(
      "7a932344733646f3b3a48187f8715e8e",
    );
    expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.KUSHKI);
    expect(transaction.amount.getValue()).toBe("50000");
    expect(transaction.currency.getCode()).toBe("COP");
    expect(transaction.payer.email).toBe("comprador@example.com");
  });

  /**
   * Los dos estados no finales medidos. Ninguno estaba en la tabla antes, así que una
   * transferencia en curso se reportaba como `ERROR`: el mismo defecto del punto 46,
   * esta vez encontrado midiendo.
   */
  it.each([
    ["requestedToken", "PENDING"],
    ["initializedTransaction", "PENDING"],
    ["approvedTransaction", "APPROVED"],
    ["declinedTransaction", "DECLINED"],
  ])("traduce el estado nativo %s a %s", (nativo, esperado) => {
    const transaction = normalizeKushkiTransfer(
      respuestaMedida({ status: nativo }),
      null,
    );

    expect(transaction.getStatus()).toBe(esperado);
    expect(transaction.rawStatus).toBe(nativo);
  });

  /**
   * La referencia del comercio viaja en `paymentDescription` al pedir el token y
   * vuelve intacta en la consulta, medido. `transactionReference` no sirve para eso:
   * lo genera Kushki, y devolvérselo al comercio le daría un identificador que nunca
   * envió y con el que no puede conciliar.
   */
  it("devuelve la referencia del comercio y no la que genera Kushki", () => {
    const transaction = normalizeKushkiTransfer(respuestaMedida(), null);

    expect(transaction.orderReference.getValue()).toBe("ORDER-PSE-1789775019380");
  });

  it("cae en la referencia de Kushki solo si no hay descripción del comercio", () => {
    const transaction = normalizeKushkiTransfer(
      respuestaMedida({ paymentDescription: "" }),
      null,
    );

    expect(transaction.orderReference.getValue()).toBe(
      "226e3ff4-5ee9-4315-aca9-8e9f87d1fb48",
    );
  });

  /**
   * El identificador tiene que seguir siendo el token incluso cuando Kushki ya asignó
   * un `ticketNumber`: es el que el SDK le entregó al comercio en la redirección y el
   * que la ruta de consulta acepta.
   */
  it("mantiene el token como identificador aunque ya exista un ticketNumber", () => {
    const transaction = normalizeKushkiTransfer(respuestaIniciadaMedida(), null);

    expect(transaction.gatewayTransactionId.value).toBe(
      "7a932344733646f3b3a48187f8715e8e",
    );
    expect(transaction.getStatus()).toBe("PENDING");
  });

  it("falla con un error tipado si la respuesta no trae monto", () => {
    const sinMonto = respuestaMedida();
    delete sinMonto.amount;

    expect(() => normalizeKushkiTransfer(sinMonto, null)).toThrow(
      expect.objectContaining({ code: KitPagosErrorCode.MALFORMED_RESPONSE }),
    );
  });
});

describe("KushkiResponseNormalizer con las dos formas de Kushki", () => {
  /**
   * Es la prueba de regresión del defecto: antes de separar las dos formas, esta
   * misma llamada lanzaba `MALFORMED_RESPONSE: missing ticketNumber`.
   */
  it("normaliza una transferencia iniciada, la que un comercio consulta de verdad", () => {
    const transaction = new KushkiResponseNormalizer().normalize(
      respuestaIniciadaMedida(),
    );

    expect(transaction.getStatus()).toBe("PENDING");
    expect(transaction.gatewayTransactionId.value).toBe(
      "7a932344733646f3b3a48187f8715e8e",
    );
  });

  it("sigue normalizando un cobro con tarjeta por el camino de siempre", () => {
    const transaction = new KushkiResponseNormalizer().normalize({
      ticketNumber: "123456789012345678",
      transaction_status: "APPROVAL",
      amount: {
        subtotalIva0: 150000,
        subtotalIva: 0,
        iva: 0,
        ice: 0,
        currency: "COP",
      },
      trackingCode: "ord-12345",
      contactDetails: { email: "cliente@example.com" },
    });

    expect(transaction.getStatus()).toBe("APPROVED");
    expect(transaction.gatewayTransactionId.value).toBe("123456789012345678");
    expect(transaction.orderReference.getValue()).toBe("ord-12345");
  });
});
