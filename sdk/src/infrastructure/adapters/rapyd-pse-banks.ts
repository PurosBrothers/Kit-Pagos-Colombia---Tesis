import { isPseBankCode, PseBankCode } from "../../domain/value-objects/PseBankCode";

/**
 * Método de pago de Rapyd que corresponde a cada código de PSE.
 *
 * Rapyd es la única de las cuatro pasarelas que no recibe el código de compensación:
 * cada banco es un `payment_method_type` propio (punto 19). Esta es la única tabla de
 * traducción de bancos del SDK, y el tipo `Record<PseBankCode, string>` obliga a que
 * tenga una entrada por cada banco del catálogo.
 *
 * Se armó cruzando dos listas medidas el 26 de septiembre de 2026: las 47 entidades
 * de PSE de Mercado Pago, con su código de compensación, y los 47 métodos `co_pse_*`
 * de Rapyd, con su nombre. Coincidieron una a una. Los nombres de Rapyd no se derivan
 * del banco: `DAVIBANK` es `co_pse_scotiabank_colpatria_bank` y `CREZCAMOS` es
 * `co_pse_crezcamos_mosi_bank`. Además, `co_bancolombia_bank`, sin `pse`, existe y
 * **no** es PSE: es una redirección de Safetypay. Por eso la tabla está escrita y no
 * calculada (punto 67).
 */
export const RAPYD_PSE_TYPES: Readonly<Record<PseBankCode, string>> = {
  [PseBankCode.BANCO_DE_BOGOTA]: "co_pse_banco_de_bogota_bank",
  [PseBankCode.BANCO_POPULAR]: "co_pse_banco_popular_bank",
  [PseBankCode.BANCO_ITAU]: "co_pse_banco_itau_bank",
  [PseBankCode.BANCOLOMBIA]: "co_pse_bancolombia_bank",
  [PseBankCode.CITIBANK]: "co_pse_citibank_bank",
  [PseBankCode.BANCO_GNB_SUDAMERIS]: "co_pse_banco_gnb_sudameris_bank",
  [PseBankCode.BBVA_COLOMBIA]: "co_pse_banco_bbva_colombia_bank",
  [PseBankCode.DAVIBANK]: "co_pse_scotiabank_colpatria_bank",
  [PseBankCode.BANCO_DE_OCCIDENTE]: "co_pse_banco_de_occidente_bank",
  [PseBankCode.BANCO_CAJA_SOCIAL]: "co_pse_banco_caja_social_bank",
  [PseBankCode.BANCO_AGRARIO]: "co_pse_banco_agrario_bank",
  [PseBankCode.BANCO_MUNDO_MUJER]: "co_pse_banco_mundo_mujer_bank",
  [PseBankCode.DAVIVIENDA]: "co_pse_banco_davivienda_bank",
  [PseBankCode.BANCO_AV_VILLAS]: "co_pse_banco_av_villas_bank",
  [PseBankCode.BANCAMIA]: "co_pse_bancamia_bank",
  [PseBankCode.BANCO_PICHINCHA]: "co_pse_banco_pichincha_bank",
  [PseBankCode.BANCOOMEVA]: "co_pse_bancoomeva_bank",
  [PseBankCode.BANCO_FALABELLA]: "co_pse_banco_falabella_bank",
  [PseBankCode.BANCO_FINANDINA]: "co_pse_banco_finandina_bic_bank",
  [PseBankCode.BANCO_SANTANDER]: "co_pse_banco_santander_colombia_bank",
  [PseBankCode.BANCO_COOPCENTRAL]: "co_pse_banco_cooperativo_coopcentral_bank",
  [PseBankCode.BANCO_SERFINANZA]: "co_pse_banco_serfinanza_bank",
  [PseBankCode.LULO_BANK]: "co_pse_lulo_bank_bank",
  [PseBankCode.JP_MORGAN]: "co_pse_banco_j_p_morgan_colombia_bank",
  [PseBankCode.DALE]: "co_pse_dale_bank",
  [PseBankCode.JURISCOOP]: "co_pse_financiera_juriscoop_compania_de_financiamiento_bank",
  [PseBankCode.CFA_COOPERATIVA_FINANCIERA]: "co_pse_cfa_cooperativa_financiera_bank",
  [PseBankCode.JFK_COOPERATIVA_FINANCIERA]: "co_pse_jfk_cooperativa_financiera_bank",
  [PseBankCode.COTRAFA]: "co_pse_cotrafa_bank",
  [PseBankCode.CONFIAR]: "co_pse_confiar_cooperativa_financiera_bank",
  [PseBankCode.BANCO_UNION]: "co_pse_banco_union_bank",
  [PseBankCode.COLTEFINANCIERA]: "co_pse_coltefinanciera_bank",
  [PseBankCode.NEQUI]: "co_pse_nequi_bank",
  [PseBankCode.DAVIPLATA]: "co_pse_daviplata_bank",
  [PseBankCode.BAN100]: "co_pse_ban100_bank",
  [PseBankCode.IRIS]: "co_pse_iris_bank",
  [PseBankCode.MOVII]: "co_pse_movii_bank",
  [PseBankCode.DING]: "co_pse_ding_bank",
  [PseBankCode.POWWI]: "co_pse_powwi_bank",
  [PseBankCode.UALA]: "co_pse_uala_bank",
  [PseBankCode.BOLD]: "co_pse_bold_cf_bank",
  [PseBankCode.NU]: "co_pse_nu_bank",
  [PseBankCode.RAPPIPAY]: "co_pse_rappipay_bank",
  [PseBankCode.COINK]: "co_pse_coink_bank",
  [PseBankCode.GLOBAL66]: "co_pse_global66_bank",
  [PseBankCode.ALIANZA_FIDUCIARIA]: "co_pse_alianza_fiduciaria_bank",
  [PseBankCode.CREZCAMOS]: "co_pse_crezcamos_mosi_bank",
};

const PSE_CODE_BY_RAPYD_TYPE: ReadonlyMap<string, PseBankCode> = new Map(
  (Object.entries(RAPYD_PSE_TYPES) as [PseBankCode, string][]).map(
    ([code, type]) => [type, code],
  ),
);

/**
 * Prefijo de los 47 `payment_method_type` de PSE en Rapyd.
 *
 * En Rapyd PSE no es un método con un campo de banco: es una familia de 47 tipos,
 * uno por entidad, con el patrón `co_pse_{banco}_bank` (issue #68, punto 19).
 */
export const RAPYD_PSE_TYPE_PREFIX = "co_pse_";

/**
 * El método de Rapyd para un código de PSE, o `undefined` si no está en el catálogo.
 * Un `co_pse_*` se devuelve tal cual, porque ya es un código de Rapyd.
 */
export function rapydPseTypeFor(bankCode: string): string | undefined {
  if (bankCode.startsWith(RAPYD_PSE_TYPE_PREFIX)) {
    return bankCode;
  }
  return isPseBankCode(bankCode) ? RAPYD_PSE_TYPES[bankCode] : undefined;
}

/** El código de PSE de un método de Rapyd, o `undefined` si no está en la tabla. */
export function pseCodeForRapydType(type: string): PseBankCode | undefined {
  return PSE_CODE_BY_RAPYD_TYPE.get(type);
}
