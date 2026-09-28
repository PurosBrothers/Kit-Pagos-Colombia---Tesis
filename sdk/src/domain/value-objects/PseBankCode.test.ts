import { isPseBankCode, PseBankCode } from "./PseBankCode";
import { describePseBank } from "./PseBank";

/**
 * Los 47 códigos que devolvió la lista de PSE de Mercado Pago el 26 de septiembre de
 * 2026, que es la que usa el código de compensación como identificador propio.
 */
const MEASURED_MERCADOPAGO_CODES = [
  "1001", "1002", "1006", "1007", "1009", "1012", "1013", "1019", "1023", "1032",
  "1040", "1047", "1051", "1052", "1059", "1060", "1061", "1062", "1063", "1065",
  "1066", "1069", "1070", "1071", "1097", "1121", "1283", "1286", "1289", "1292",
  "1303", "1370", "1507", "1551", "1558", "1637", "1801", "1802", "1803", "1804",
  "1808", "1809", "1811", "1812", "1814", "1815", "1816",
];

describe("PseBankCode", () => {
  it("should contain exactly the entities measured in the Mercado Pago PSE list", () => {
    expect([...Object.values(PseBankCode)].sort()).toEqual(
      [...MEASURED_MERCADOPAGO_CODES].sort(),
    );
  });

  it("should use four-digit clearing codes, without duplicates", () => {
    const codes = Object.values(PseBankCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^\d{4}$/);
    }
  });

  /**
   * Los tres que más se piden, con el valor que publican el Banco de la República para
   * CENIT y ACH Colombia. Si alguien reordena el enum por error, esto lo dice.
   */
  it("should map the best-known entities to their published clearing codes", () => {
    expect(PseBankCode.BANCOLOMBIA).toBe("1007");
    expect(PseBankCode.DAVIVIENDA).toBe("1051");
    expect(PseBankCode.NEQUI).toBe("1507");
  });
});

describe("isPseBankCode", () => {
  it("should recognize a catalog code", () => {
    expect(isPseBankCode("1007")).toBe(true);
  });

  it("should reject sandbox codes and gateway-specific codes", () => {
    expect(isPseBankCode("1")).toBe(false);
    expect(isPseBankCode("0001")).toBe(false);
    expect(isPseBankCode("co_pse_bancolombia_bank")).toBe(false);
  });
});

describe("describePseBank", () => {
  it("should add the code as achCode when the gateway uses the clearing code", () => {
    expect(describePseBank("1007", "Bancolombia")).toEqual({
      code: "1007",
      name: "Bancolombia",
      achCode: "1007",
    });
  });

  it("should omit achCode for a bank outside the catalog", () => {
    expect(describePseBank("1", "Banco que aprueba")).toEqual({
      code: "1",
      name: "Banco que aprueba",
    });
  });

  it("should use an explicit achCode when the gateway code is different", () => {
    expect(
      describePseBank("co_pse_bancolombia_bank", "Bancolombia", "1007").achCode,
    ).toBe("1007");
  });
});
