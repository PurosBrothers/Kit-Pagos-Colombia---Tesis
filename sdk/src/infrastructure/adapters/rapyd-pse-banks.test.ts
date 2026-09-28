import {
  pseCodeForRapydType,
  RAPYD_PSE_TYPES,
  rapydPseTypeFor,
} from "./rapyd-pse-banks";
import { PseBankCode } from "../../domain/value-objects/PseBankCode";

/**
 * Los 47 `co_pse_*` que devolvió `GET /v1/payment_methods/country?country=CO` en el
 * sandbox de Rapyd el 26 de septiembre de 2026. `npm run test:sandbox` compara la
 * tabla contra la lista en vivo; esta copia fija es la que corre en cada cambio.
 */
const MEASURED_RAPYD_TYPES = [
  "co_pse_banco_davivienda_bank", "co_pse_bancolombia_bank", "co_pse_ding_bank",
  "co_pse_banco_caja_social_bank", "co_pse_banco_av_villas_bank", "co_pse_banco_union_bank",
  "co_pse_powwi_bank", "co_pse_rappipay_bank", "co_pse_scotiabank_colpatria_bank",
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
];

describe("RAPYD_PSE_TYPES", () => {
  it("should cover exactly the PSE methods measured in the Rapyd sandbox", () => {
    expect([...Object.values(RAPYD_PSE_TYPES)].sort()).toEqual(
      [...MEASURED_RAPYD_TYPES].sort(),
    );
  });

  it("should not assign the same Rapyd method to two banks", () => {
    const types = Object.values(RAPYD_PSE_TYPES);
    expect(new Set(types).size).toBe(types.length);
  });

  /**
   * Las dos entradas cuyo nombre en Rapyd no se deduce del banco. Son la razón de que la
   * tabla esté escrita a mano en vez de calculada a partir del nombre.
   */
  it("should keep the Rapyd names that do not follow the bank's current brand", () => {
    expect(RAPYD_PSE_TYPES[PseBankCode.DAVIBANK]).toBe("co_pse_scotiabank_colpatria_bank");
    expect(RAPYD_PSE_TYPES[PseBankCode.CREZCAMOS]).toBe("co_pse_crezcamos_mosi_bank");
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
