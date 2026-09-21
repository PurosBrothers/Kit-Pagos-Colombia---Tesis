import { RejectionReason } from "../../../src/domain/value-objects/RejectionReason";
import { RejectionCategory } from "../../../src/domain/value-objects/RejectionCategory";

describe("RejectionReason", () => {
  describe("construction", () => {
    it("combines and exposes rejectionCode and rejectionCategory", () => {
      const reason = new RejectionReason(
        "51",
        "INSUFFICIENT_FUNDS" as RejectionCategory,
      );
      expect(reason.rejectionCode).toBe("51");
      expect(reason.rejectionCategory).toBe("INSUFFICIENT_FUNDS");
    });

    it("preserves the native code as-is, without normalizing it", () => {
      // ADR-03 example: Rapyd combines code + network description,
      // e.g. "ERROR_PROCESSING_CARD - [51]". RejectionReason must not
      // reinterpret that string, only store it.
      const reason = new RejectionReason(
        "ERROR_PROCESSING_CARD - [51]",
        "INSUFFICIENT_FUNDS" as RejectionCategory,
      );
      expect(reason.rejectionCode).toBe("ERROR_PROCESSING_CARD - [51]");
      expect(reason.rejectionCategory).toBe("INSUFFICIENT_FUNDS");
    });
  });
});