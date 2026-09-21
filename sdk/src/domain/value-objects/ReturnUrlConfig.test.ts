import { ReturnUrlConfig } from "../../../src/domain/value-objects/ReturnUrlConfig";
import { TransactionStatus } from "../../../src/domain/value-objects/TransactionStatus";

describe("ReturnUrlConfig", () => {
  describe("single URL", () => {
    it("returns the same URL regardless of status", () => {
      const config = new ReturnUrlConfig("https://comercio.com/retorno");
      expect(config.resolveFor("APPROVED" as TransactionStatus)).toBe(
        "https://comercio.com/retorno",
      );
      expect(config.resolveFor("DECLINED" as TransactionStatus)).toBe(
        "https://comercio.com/retorno",
      );
    });
  });

  describe("result-specific URLs", () => {
    const config = new ReturnUrlConfig(undefined, {
      success: "https://comercio.com/exito",
      failure: "https://comercio.com/fallo",
      pending: "https://comercio.com/pendiente",
    });

    it("resolves the success URL for APPROVED", () => {
      expect(config.resolveFor("APPROVED" as TransactionStatus)).toBe(
        "https://comercio.com/exito",
      );
    });

    it("resolves the failure URL for DECLINED", () => {
      expect(config.resolveFor("DECLINED" as TransactionStatus)).toBe(
        "https://comercio.com/fallo",
      );
    });

    it("resolves the pending URL for PENDING", () => {
      expect(config.resolveFor("PENDING" as TransactionStatus)).toBe(
        "https://comercio.com/pendiente",
      );
    });
  });

  describe("edge cases", () => {
    it("returns null when neither returnUrl nor returnUrls are configured", () => {
      const config = new ReturnUrlConfig();
      expect(config.resolveFor("APPROVED" as TransactionStatus)).toBeNull();
    });

    it("falls back to returnUrl when returnUrls does not cover the given status", () => {
      const config = new ReturnUrlConfig("https://comercio.com/default", {
        success: "https://comercio.com/exito",
      });
      // EXPIRED has no dedicated branch in resolveFor, so it must fall back
      expect(config.resolveFor("EXPIRED" as TransactionStatus)).toBe(
        "https://comercio.com/default",
      );
    });
  });
});