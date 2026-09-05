import { ReturnUrlConfig } from "../../../src/domain/value-objects/ReturnUrlConfig";
import { TransactionStatus } from "../../../src/domain/value-objects/TransactionStatus";

describe("ReturnUrlConfig", () => {
  describe("URL única", () => {
    it("retorna la misma URL sin importar el status", () => {
      const config = new ReturnUrlConfig("https://comercio.com/retorno");
      expect(config.resolveFor("APPROVED" as TransactionStatus)).toBe(
        "https://comercio.com/retorno",
      );
      expect(config.resolveFor("DECLINED" as TransactionStatus)).toBe(
        "https://comercio.com/retorno",
      );
    });
  });

  describe("URLs diferenciadas por resultado", () => {
    const config = new ReturnUrlConfig(undefined, {
      success: "https://comercio.com/exito",
      failure: "https://comercio.com/fallo",
      pending: "https://comercio.com/pendiente",
    });

    it("resuelve la URL de éxito para APPROVED", () => {
      expect(config.resolveFor("APPROVED" as TransactionStatus)).toBe(
        "https://comercio.com/exito",
      );
    });

    it("resuelve la URL de fallo para DECLINED", () => {
      expect(config.resolveFor("DECLINED" as TransactionStatus)).toBe(
        "https://comercio.com/fallo",
      );
    });

    it("resuelve la URL de pendiente para PENDING", () => {
      expect(config.resolveFor("PENDING" as TransactionStatus)).toBe(
        "https://comercio.com/pendiente",
      );
    });
  });

  describe("casos borde", () => {
    it("retorna null si no hay returnUrl ni returnUrls configurados", () => {
      const config = new ReturnUrlConfig();
      expect(config.resolveFor("APPROVED" as TransactionStatus)).toBeNull();
    });

    it("cae de vuelta a returnUrl cuando returnUrls no cubre el status recibido", () => {
      const config = new ReturnUrlConfig("https://comercio.com/default", {
        success: "https://comercio.com/exito",
      });
      // EXPIRED no tiene rama propia en resolveFor, debe caer al fallback
      expect(config.resolveFor("EXPIRED" as TransactionStatus)).toBe(
        "https://comercio.com/default",
      );
    });
  });
});