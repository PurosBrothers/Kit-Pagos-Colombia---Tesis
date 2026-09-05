import { RejectionReason } from "../../../src/domain/value-objects/RejectionReason";
import { RejectionCategory } from "../../../src/domain/value-objects/RejectionCategory";

describe("RejectionReason", () => {
  describe("construcción", () => {
    it("combina y expone el rejectionCode y la rejectionCategory", () => {
      const reason = new RejectionReason(
        "51",
        "INSUFFICIENT_FUNDS" as RejectionCategory,
      );
      expect(reason.rejectionCode).toBe("51");
      expect(reason.rejectionCategory).toBe("INSUFFICIENT_FUNDS");
    });

    it("preserva el código nativo tal cual llega, sin normalizarlo", () => {
      // Ejemplo del ADR-03: Rapyd combina código + descripción de red,
      // p.ej. "ERROR_PROCESSING_CARD - [51]". RejectionReason no debe
      // reinterpretar ese string, solo conservarlo.
      const reason = new RejectionReason(
        "ERROR_PROCESSING_CARD - [51]",
        "INSUFFICIENT_FUNDS" as RejectionCategory,
      );
      expect(reason.rejectionCode).toBe("ERROR_PROCESSING_CARD - [51]");
      expect(reason.rejectionCategory).toBe("INSUFFICIENT_FUNDS");
    });
  });
});