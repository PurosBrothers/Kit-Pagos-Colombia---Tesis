import {
  WOMPI_DOCUMENT_TYPES,
  buildPseFields,
  computeIntegritySignature,
  extractRedirectSnapshot,
  pollForRedirectUrl,
  reclassifyWompiMerchantLookupError,
  resolvePendingRedirect,
} from "./wompi-pse";
import { ResponseNormalizer } from "../../application/services/ResponseNormalizer";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Payer } from "../../domain/value-objects/Payer";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

const payerWithDocument = new Payer({
  email: "comprador@example.com",
  documentType: "CC",
  documentNumber: "1099888777",
});

describe("computeIntegritySignature", () => {
  it("should hash reference, amount, currency and secret in that order", () => {
    expect(
      computeIntegritySignature("ord-12345", 15000000, "COP", "test_integrity_secreto"),
    ).toBe("b1a8a79246cc50da3ac84b452dc2ac3c78ce23fd0a2ee9ab7c1878f65d78222b");
  });

  /**
   * El orden de concatenación es el detalle que Wompi no perdona: cualquier
   * permutación produce una firma que rechaza con 422 y sin explicar por qué.
   * Esta prueba existe para que una refactorización que reordene los campos
   * falle aquí y no contra la pasarela.
   */
  it("should produce a different signature if the field order changes", () => {
    const correct = computeIntegritySignature("ord-12345", 15000000, "COP", "secreto");
    const permuted = computeIntegritySignature("15000000", 12345 as never, "COP", "secreto");
    expect(correct).not.toBe(permuted);
  });

  it("should be deterministic for the same inputs", () => {
    const first = computeIntegritySignature("ord-1", 1000, "COP", "s");
    const second = computeIntegritySignature("ord-1", 1000, "COP", "s");
    expect(first).toBe(second);
  });
});

describe("buildPseFields", () => {
  it("should reject a payer without document instead of spending an HTTP call", () => {
    expect(() =>
      buildPseFields({
        bankCode: "1",
        payer: new Payer({ email: "comprador@example.com" }),
        orderReference: "ord-12345",
      }),
    ).toThrow(KitPagosError);
  });

  /**
   * El conjunto válido no lo elegimos nosotros: es el que el sandbox enumera en
   * su mensaje de validación. Un tipo fuera de ese conjunto da 422, así que se
   * ataja localmente.
   */
  it("should reject a document type that Wompi does not accept", () => {
    try {
      buildPseFields({
        bankCode: "1",
        payer: new Payer({
          email: "comprador@example.com",
          documentType: "XX",
          documentNumber: "123",
        }),
        orderReference: "ord-12345",
      });
      fail("debía lanzar");
    } catch (error) {
      expect(error).toBeInstanceOf(KitPagosError);
      expect((error as KitPagosError).code).toBe(KitPagosErrorCode.INVALID_REQUEST);
    }
  });

  it("should accept every document type the sandbox enumerated", () => {
    for (const documentType of WOMPI_DOCUMENT_TYPES) {
      const fields = buildPseFields({
        bankCode: "1",
        payer: new Payer({
          email: "comprador@example.com",
          documentType,
          documentNumber: "1099888777",
        }),
        orderReference: "ord-12345",
      });
      expect(fields.user_legal_id_type).toBe(documentType);
    }
  });

  it("should map a natural person to user_type 0 by default", () => {
    const fields = buildPseFields({
      bankCode: "1",
      payer: payerWithDocument,
      orderReference: "ord-12345",
    });
    expect(fields.user_type).toBe(0);
  });

  it("should map a legal person to user_type 1", () => {
    const fields = buildPseFields({
      bankCode: "1",
      payerKind: "LEGAL",
      payer: payerWithDocument,
      orderReference: "ord-12345",
    });
    expect(fields.user_type).toBe(1);
  });

  it("should derive the payment description from the order reference", () => {
    const fields = buildPseFields({
      bankCode: "1",
      payer: payerWithDocument,
      orderReference: "ord-12345",
    });
    expect(fields.payment_description).toBe("Pago ord-12345");
  });

  /**
   * El código de banco viaja opaco: el dominio no lo interpreta. Wompi además no
   * lo valida al crear (un código inexistente devolvió 201 en sandbox), así que
   * el adaptador no debe inventarse una lista blanca que la pasarela no aplica.
   */
  it("should pass the bank code through without interpreting it", () => {
    const fields = buildPseFields({
      bankCode: "99",
      payer: payerWithDocument,
      orderReference: "ord-12345",
    });
    expect(fields.financial_institution_code).toBe("99");
  });
});

/** Una transacción de Wompi con la forma de `GET /transactions/{id}`. */
function wompiTransaction(status: string, asyncPaymentUrl?: string): unknown {
  return {
    data: {
      id: "tx-1",
      status,
      amount_in_cents: 15000000,
      currency: "COP",
      reference: "ord-pse-1",
      customer_email: "comprador@example.com",
      payment_method: {
        type: "PSE",
        extra: asyncPaymentUrl ? { async_payment_url: asyncPaymentUrl } : {},
      },
    },
  };
}

/** Reloj y espera falsos para no depender de tiempo real. */
function fakeClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

describe("pollForRedirectUrl", () => {
  it("should return immediately when the url is already there", async () => {
    const clock = fakeClock();
    const readSnapshot = jest
      .fn<Promise<unknown>, []>()
      .mockResolvedValue(wompiTransaction("PENDING", "https://banco.example/redirect"));

    const result = await pollForRedirectUrl("tx-1", readSnapshot, {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(extractRedirectSnapshot(result).redirectUrl).toBe("https://banco.example/redirect");
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  /**
   * Lo medido el 6 de octubre de 2026 (docs/testing-data/wompi.md, sección 3): la URL
   * llega en la misma consulta que el desenlace. El sondeo se detiene ahí, pero por el
   * desenlace, y devuelve esa respuesta para que se normalice.
   */
  it.each(["APPROVED", "DECLINED", "ERROR"])(
    "should stop at a settled %s status, with or without url",
    async (status) => {
      const clock = fakeClock();
      const settled = wompiTransaction(status);
      const readSnapshot = jest
        .fn<Promise<unknown>, []>()
        .mockResolvedValueOnce(wompiTransaction("PENDING"))
        .mockResolvedValue(settled);

      const result = await pollForRedirectUrl("tx-1", readSnapshot, {
        now: clock.now,
        sleep: clock.sleep,
        intervalMs: 100,
      });

      expect(result).toBe(settled);
      expect(readSnapshot).toHaveBeenCalledTimes(2);
    },
  );

  it("should keep polling while the status is empty, even with a url", async () => {
    const clock = fakeClock();
    const readSnapshot = jest
      .fn<Promise<unknown>, []>()
      .mockResolvedValueOnce(wompiTransaction(""))
      .mockResolvedValue(wompiTransaction("DECLINED"));

    await pollForRedirectUrl("tx-1", readSnapshot, {
      now: clock.now,
      sleep: clock.sleep,
      intervalMs: 100,
    });

    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });

  /**
   * Reproduce lo medido contra el sandbox: la creación deja la transacción en
   * PENDING sin URL, y la URL aparece en una consulta posterior.
   */
  it("should keep polling until the url shows up", async () => {
    const clock = fakeClock();
    const readSnapshot = jest
      .fn<Promise<unknown>, []>()
      .mockResolvedValueOnce(wompiTransaction("PENDING"))
      .mockResolvedValueOnce(wompiTransaction("PENDING"))
      .mockResolvedValue(wompiTransaction("PENDING", "https://banco.example/redirect"));

    const result = await pollForRedirectUrl("tx-1", readSnapshot, {
      now: clock.now,
      sleep: clock.sleep,
      intervalMs: 100,
      timeoutMs: 5000,
    });

    expect(extractRedirectSnapshot(result).redirectUrl).toBe("https://banco.example/redirect");
    expect(readSnapshot).toHaveBeenCalledTimes(3);
  });

  it("should fail with GATEWAY_TIMEOUT when the url never shows up", async () => {
    const clock = fakeClock();
    const readSnapshot = jest
      .fn<Promise<unknown>, []>()
      .mockResolvedValue(wompiTransaction("PENDING"));

    await expect(
      pollForRedirectUrl("tx-1", readSnapshot, {
        now: clock.now,
        sleep: clock.sleep,
        intervalMs: 100,
        timeoutMs: 300,
      }),
    ).rejects.toMatchObject({ code: KitPagosErrorCode.GATEWAY_TIMEOUT });
  });

  /**
   * El pago ya existe en la pasarela cuando esto falla. Si el error no llevara
   * el identificador, un cobro real quedaría irrastreable, que es peor que el
   * defecto que PaymentResult vino a corregir.
   */
  it("should carry the transaction id and the last status in the error", async () => {
    const clock = fakeClock();
    const readSnapshot = jest
      .fn<Promise<unknown>, []>()
      .mockResolvedValue(wompiTransaction("PENDING"));

    try {
      await pollForRedirectUrl("tx-abc-123", readSnapshot, {
        now: clock.now,
        sleep: clock.sleep,
        intervalMs: 100,
        timeoutMs: 200,
      });
      fail("debía lanzar");
    } catch (error) {
      expect((error as KitPagosError).message).toContain("tx-abc-123");
      expect((error as KitPagosError).message).toContain("PENDING");
    }
  });
});

describe("resolvePendingRedirect", () => {
  const normalizer = new ResponseNormalizer();
  const normalize = (raw: unknown) => normalizer.normalize(raw, Gateway.WOMPI);
  const bankUrl = "https://api-sandbox.wompi.co/v1/pse/redirect?ticket_id=11111111";

  function resolve(created: unknown, ...queried: unknown[]) {
    const clock = fakeClock();
    const readRaw = jest.fn<Promise<unknown>, [string]>();
    for (const response of queried) readRaw.mockResolvedValueOnce(response);
    const result = resolvePendingRedirect(created, readRaw, normalize, {
      now: clock.now,
      sleep: clock.sleep,
      intervalMs: 100,
    });
    return { result, readRaw };
  }

  /**
   * El defecto: con el banco `2` la URL llega en la misma consulta que `DECLINED`
   * (medido el 6 de octubre de 2026, docs/testing-data/wompi.md, sección 3). Antes el
   * SDK devolvía una redirección con `rawStatus: "DECLINED"`.
   */
  it.each([
    ["DECLINED", "DECLINED"],
    ["ERROR", "ERROR"],
    ["APPROVED", "APPROVED"],
  ])("should return the %s transaction when the url arrives with the outcome", async (raw, expected) => {
    const { result } = resolve(wompiTransaction("PENDING"), wompiTransaction(raw, bankUrl));

    const outcome = await result;

    expect(outcome.outcome).toBe("TRANSACTION");
    if (outcome.outcome !== "TRANSACTION") return;
    expect(outcome.transaction.getStatus()).toBe(expected);
    expect(outcome.transaction.rawStatus).toBe(raw);
    expect(outcome.transaction.gatewayTransactionId.value).toBe("tx-1");
  });

  it("should redirect when the transaction is PENDING with a url", async () => {
    const { result } = resolve(wompiTransaction("PENDING"), wompiTransaction("PENDING", bankUrl));

    const outcome = await result;

    expect(outcome.outcome).toBe("REDIRECT_REQUIRED");
    if (outcome.outcome !== "REDIRECT_REQUIRED") return;
    expect(outcome.redirect.redirectUrl).toBe(bankUrl);
    expect(outcome.redirect.rawStatus).toBe("PENDING");
    expect(outcome.redirect.gatewayTransactionId.value).toBe("tx-1");
  });

  it("should not poll when the creation already carries the outcome", async () => {
    const { result, readRaw } = resolve(wompiTransaction("DECLINED", bankUrl));

    const outcome = await result;

    expect(outcome.outcome).toBe("TRANSACTION");
    expect(readRaw).not.toHaveBeenCalled();
  });

  it("should not poll when the creation is PENDING with a url", async () => {
    const { result, readRaw } = resolve(wompiTransaction("PENDING", bankUrl));

    expect((await result).outcome).toBe("REDIRECT_REQUIRED");
    expect(readRaw).not.toHaveBeenCalled();
  });
});

describe("reclassifyWompiMerchantLookupError", () => {
  const notFoundBody = {
    error: { type: "NOT_FOUND_ERROR", reason: "La entidad solicitada no existe" },
  };

  it("turns RESOURCE_NOT_FOUND into INVALID_CREDENTIALS and keeps the body", () => {
    const result = reclassifyWompiMerchantLookupError(
      new KitPagosError(KitPagosErrorCode.RESOURCE_NOT_FOUND, Gateway.WOMPI, notFoundBody, "404"),
    ) as KitPagosError;

    expect(result.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
    expect(result.gateway).toBe(Gateway.WOMPI);
    expect(result.originalPayload).toBe(notFoundBody);
  });

  it.each([
    ["un INVALID_REQUEST", KitPagosErrorCode.INVALID_REQUEST],
    ["un GATEWAY_TIMEOUT", KitPagosErrorCode.GATEWAY_TIMEOUT],
  ])("leaves %s untouched", (_scenario, code) => {
    const error = new KitPagosError(code, Gateway.WOMPI, notFoundBody, "fallo");

    expect(reclassifyWompiMerchantLookupError(error)).toBe(error);
  });

  it("leaves an error that is not a KitPagosError untouched", () => {
    const error = new Error("otro");

    expect(reclassifyWompiMerchantLookupError(error)).toBe(error);
  });
});
