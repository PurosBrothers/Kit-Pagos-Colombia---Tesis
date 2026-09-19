import {
  WOMPI_DOCUMENT_TYPES,
  buildPseFields,
  computeIntegritySignature,
  pollForRedirectUrl,
  WompiRedirectSnapshot,
} from "./wompi-pse";
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
   * falle acá y no contra la pasarela.
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

describe("pollForRedirectUrl", () => {
  /** Reloj y espera falsos para no depender de tiempo real. */
  function fakeClock(startMs = 0) {
    let current = startMs;
    return {
      now: () => current,
      sleep: async (ms: number) => {
        current += ms;
      },
      advance: (ms: number) => {
        current += ms;
      },
    };
  }

  it("should return immediately when the url is already there", async () => {
    const clock = fakeClock();
    const readSnapshot = jest
      .fn<Promise<WompiRedirectSnapshot>, []>()
      .mockResolvedValue({ status: "PENDING", redirectUrl: "https://banco.example/redirect" });

    const result = await pollForRedirectUrl("tx-1", readSnapshot, {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.redirectUrl).toBe("https://banco.example/redirect");
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  /**
   * Reproduce lo medido contra el sandbox: la creación deja la transacción en
   * PENDING sin URL, y la URL aparece en una consulta posterior.
   */
  it("should keep polling until the url shows up", async () => {
    const clock = fakeClock();
    const readSnapshot = jest
      .fn<Promise<WompiRedirectSnapshot>, []>()
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValue({ status: "PENDING", redirectUrl: "https://banco.example/redirect" });

    const result = await pollForRedirectUrl("tx-1", readSnapshot, {
      now: clock.now,
      sleep: clock.sleep,
      intervalMs: 100,
      timeoutMs: 5000,
    });

    expect(result.redirectUrl).toBe("https://banco.example/redirect");
    expect(readSnapshot).toHaveBeenCalledTimes(3);
  });

  it("should fail with GATEWAY_TIMEOUT when the url never shows up", async () => {
    const clock = fakeClock();
    const readSnapshot = jest
      .fn<Promise<WompiRedirectSnapshot>, []>()
      .mockResolvedValue({ status: "PENDING" });

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
      .fn<Promise<WompiRedirectSnapshot>, []>()
      .mockResolvedValue({ status: "PENDING" });

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
