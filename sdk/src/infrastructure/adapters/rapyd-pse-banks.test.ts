import {
  pseCodeForRapydType,
  RAPYD_PSE_TYPES,
  RAPYD_SANDBOX_PSE_TYPES,
  rapydPseTypeFor,
} from "./rapyd-pse-banks";
import { PseBankCode } from "../../domain/value-objects/PseBankCode";

/**
 * Los 50 `co_pse_*` que devolvió `GET /v1/payment_methods/country?country=CO` en el
 * sandbox de Rapyd el 17 de octubre de 2026. `npm run test:sandbox` compara la
 * tabla contra la lista en vivo; esta copia fija es la que corre en cada cambio.
 */
const MEASURED_RAPYD_TYPES = [
  "co_pse_banco_davivienda_bank", "co_pse_bancolombia_bank", "co_pse_ding_bank",
  "co_pse_banco_caja_social_bank", "co_pse_banco_av_villas_bank", "co_pse_banco_union_bank",
  "co_pse_powwi_bank", "co_pse_rappipay_bank", "co_pse_davibank_bank",
  "co_pse_uala_bank", "co_pse_jfk_cooperativa_financiera_bank", "co_pse_lulo_bank_bank",
  "co_pse_movii_bank", "co_pse_nequi_bank", "co_pse_nu_bank", "co_pse_daviplata_bank",
  "co_pse_financiera_juriscoop_compania_de_financiamiento_bank", "co_pse_global66_bank",
  "co_pse_iris_bank", "co_pse_coltefinanciera_bank", "co_pse_confiar_cooperativa_financiera_bank",
  "co_pse_cotrafa_bank", "co_pse_crezcamos_mosi_bank", "co_pse_dale_bank",
  "co_pse_bancoomeva_bank", "co_pse_bold_cf_bank", "co_pse_cfa_cooperativa_financiera_bank",
  "co_pse_citibank_bank", "co_pse_coink_bank", "co_pse_banco_popular_bank",
  "co_pse_banco_santander_colombia_bank", "co_pse_banco_serfinanza_bank",
  "co_pse_banco_gnb_sudameris_bank", "co_pse_banco_itau_bank",
  "co_pse_banco_j_p_morgan_colombia_bank", "co_pse_banco_mundo_mujer_bank",
  "co_pse_banco_pichincha_bank", "co_pse_banco_cooperativo_coopcentral_bank",
  "co_pse_banco_de_bogota_bank", "co_pse_banco_de_occidente_bank", "co_pse_banco_falabella_bank",
  "co_pse_banco_finandina_bic_bank", "co_pse_alianza_fiduciaria_bank", "co_pse_ban100_bank",
  "co_pse_bancamia_bank", "co_pse_banco_agrario_bank", "co_pse_banco_bbva_colombia_bank",
  "co_pse_banco_contactar_bank", "co_pse_accion_fiduciaria_bank", "co_pse_paycash_bank",
];

describe("RAPYD_PSE_TYPES", () => {
  it("should translate every bank into a PSE method measured in the Rapyd sandbox", () => {
    const measured = new Set(MEASURED_RAPYD_TYPES);
    expect(Object.values(RAPYD_PSE_TYPES).filter((type) => !measured.has(type))).toEqual([]);
  });

  /**
   * Estos tres no tienen código de PSE porque la lista de Mercado Pago, de donde salió
   * `PseBankCode`, no los trae. `getPseBanks()` los devuelve sin `achCode`.
   */
  it("should leave out only the Rapyd methods that Mercado Pago does not list", () => {
    const translated = new Set(Object.values(RAPYD_PSE_TYPES));
    expect(MEASURED_RAPYD_TYPES.filter((type) => !translated.has(type)).sort()).toEqual([
      "co_pse_accion_fiduciaria_bank",
      "co_pse_banco_contactar_bank",
      "co_pse_paycash_bank",
    ]);
  });

  it("should not assign the same Rapyd method to two banks", () => {
    const types = Object.values(RAPYD_PSE_TYPES);
    expect(new Set(types).size).toBe(types.length);
  });

  /**
   * La entrada cuyo nombre en Rapyd no se deduce del banco. Es la razón de que la tabla
   * esté escrita a mano en vez de calculada a partir del nombre.
   */
  it("should keep the Rapyd name that does not follow the bank's brand", () => {
    expect(RAPYD_PSE_TYPES[PseBankCode.CREZCAMOS]).toBe("co_pse_crezcamos_mosi_bank");
  });

  /** Era `co_pse_scotiabank_colpatria_bank`, que ya no está en el catálogo de Rapyd. */
  it("should translate Davibank into the method Rapyd renamed", () => {
    expect(RAPYD_PSE_TYPES[PseBankCode.DAVIBANK]).toBe("co_pse_davibank_bank");
  });
});

describe("RAPYD_SANDBOX_PSE_TYPES", () => {
  it("should hold the 9 measured methods, all of them in the Rapyd catalog", () => {
    expect(RAPYD_SANDBOX_PSE_TYPES.size).toBe(9);
    expect([...RAPYD_SANDBOX_PSE_TYPES].filter((type) => !MEASURED_RAPYD_TYPES.includes(type))).toEqual([]);
  });
});

describe("rapydPseTypeFor", () => {
  it("should translate a PSE code into its Rapyd method", () => {
    expect(rapydPseTypeFor(PseBankCode.BANCOLOMBIA)).toBe("co_pse_bancolombia_bank");
  });

  it("should pass a Rapyd PSE method through unchanged", () => {
    expect(rapydPseTypeFor("co_pse_banco_nuevo_bank")).toBe("co_pse_banco_nuevo_bank");
  });

  /**
   * `co_bancolombia_bank` existe en Rapyd y no es PSE: es una redirección de Safetypay.
   * Aceptarlo cobraría por otra red.
   */
  it("should not accept a Rapyd bank method that is not PSE", () => {
    expect(rapydPseTypeFor("co_bancolombia_bank")).toBeUndefined();
  });

  it("should not accept a code outside the catalog", () => {
    expect(rapydPseTypeFor("1")).toBeUndefined();
  });
});

describe("pseCodeForRapydType", () => {
  it("should be the inverse of the translation table", () => {
    for (const [code, type] of Object.entries(RAPYD_PSE_TYPES)) {
      expect(pseCodeForRapydType(type)).toBe(code);
    }
  });

  it("should return undefined for a method missing from the table", () => {
    expect(pseCodeForRapydType("co_pse_banco_nuevo_bank")).toBeUndefined();
  });
});
