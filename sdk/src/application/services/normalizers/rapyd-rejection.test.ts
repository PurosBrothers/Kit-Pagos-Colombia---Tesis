import { readRapydRejection } from "./rapyd-rejection";
import { RapydResponseNormalizer } from "./RapydResponseNormalizer";
import { RejectionReason } from "../../../domain/value-objects/RejectionReason";

/** Un pago en `ERR` con el `failure_code` de las tarjetas de error (docs/testing-data/rapyd.md, sección 2). */
function failedPayment(failureCode: unknown): Record<string, unknown> {
  return {
    status: { status: "SUCCESS", error_code: "" },
    data: {
      id: "payment_rejected_1",
      status: "ERR",
      amount: 50000,
      currency_code: "COP",
      merchant_reference_id: "ORDER-51",
      failure_code: failureCode,
    },
  };
}

describe("readRapydRejection()", () => {
  it.each([
    ["ERROR_PROCESSING_CARD - [51]", "INSUFFICIENT_FUNDS"],
    ["ERROR_PROCESSING_CARD - [05]", "UNKNOWN"],
    ["ERROR_PROCESSING_CARD - [43]", "UNKNOWN"],
  ])("should keep %s as the code of a declined payment, with category %s", (code, category) => {
    const transaction = new RapydResponseNormalizer().normalize(failedPayment(code));

    expect(transaction.getStatus()).toBe("DECLINED");
    expect(transaction.rejectionReason).toEqual(
      new RejectionReason(code, category as RejectionReason["rejectionCategory"]),
    );
  });

  it("should not report a rejection for an ERROR, which is not a decline", () => {
    const transaction = new RapydResponseNormalizer().normalize(
      failedPayment("MISSING_AUTHENTICATION_HEADERS"),
    );

    expect(transaction.getStatus()).toBe("ERROR");
    expect(transaction.rejectionReason).toBeUndefined();
  });

  it("should not report a rejection without failure_code", () => {
    expect(readRapydRejection({}, "DECLINED")).toBeUndefined();
  });
});
