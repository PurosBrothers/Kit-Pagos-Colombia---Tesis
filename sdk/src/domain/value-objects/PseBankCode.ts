/**
 * Código de compensación de las entidades habilitadas para cobrar por PSE.
 *
 * ## Por qué el SDK tiene un catálogo de bancos
 *
 * Porque el código no lo inventa ni el SDK ni la pasarela: es el **código de
 * compensación** de cuatro dígitos que el Banco de la República publica para CENIT
 * y que ACH Colombia usa en PSE. En los establecimientos bancarios es un `1`
 * seguido del código de la entidad en la Superintendencia Financiera, y por eso
 * Bancolombia, que es la entidad `007`, es `1007`.
 *
 * Con este catálogo, un comercio puede pedir Bancolombia en cualquier pasarela sin
 * conocer los códigos de los demás bancos ni la forma en que cada pasarela los
 * nombra: `PaymentMethod.pse({ bankCode: PseBankCode.BANCOLOMBIA })`. Mercado Pago,
 * Wompi y Kushki reciben este código tal cual; Rapyd, que identifica a cada banco
 * con un método de pago propio, lo traduce su adaptador.
 *
 * ## De dónde salen las 47 entradas
 *
 * No se copiaron de una tabla publicada. Se midieron el 26 de septiembre de 2026:
 * son exactamente las 47 entidades que devolvió la lista de PSE de Mercado Pago, y
 * cada una tiene su método `co_pse_*` en las 47 de Rapyd. Las tablas publicadas por
 * Wompi y otros proveedores traen más códigos (Bancoldex, Banco W, Pibank), pero son
 * de dispersión de pagos, no de PSE.
 *
 * El nombre de cada entrada es la marca vigente, no la razón social: `1019` es
 * `DAVIBANK`, que antes se llamaba Scotiabank Colpatria. El razonamiento completo,
 * incluido por qué esto revierte la decisión del punto 47, está en el punto 68 del
 * `architecture-log.md`.
 */
export enum PseBankCode {
  BANCO_DE_BOGOTA = "1001",
  BANCO_POPULAR = "1002",
  BANCO_ITAU = "1006",
  BANCOLOMBIA = "1007",
  CITIBANK = "1009",
  BANCO_GNB_SUDAMERIS = "1012",
  BBVA_COLOMBIA = "1013",
  DAVIBANK = "1019",
  BANCO_DE_OCCIDENTE = "1023",
  BANCO_CAJA_SOCIAL = "1032",
  BANCO_AGRARIO = "1040",
  BANCO_MUNDO_MUJER = "1047",
  DAVIVIENDA = "1051",
  BANCO_AV_VILLAS = "1052",
  BANCAMIA = "1059",
  BANCO_PICHINCHA = "1060",
  BANCOOMEVA = "1061",
  BANCO_FALABELLA = "1062",
  BANCO_FINANDINA = "1063",
  BANCO_SANTANDER = "1065",
  BANCO_COOPCENTRAL = "1066",
  BANCO_SERFINANZA = "1069",
  LULO_BANK = "1070",
  JP_MORGAN = "1071",
  DALE = "1097",
  JURISCOOP = "1121",
  CFA_COOPERATIVA_FINANCIERA = "1283",
  JFK_COOPERATIVA_FINANCIERA = "1286",
  COTRAFA = "1289",
  CONFIAR = "1292",
  BANCO_UNION = "1303",
  COLTEFINANCIERA = "1370",
  NEQUI = "1507",
  DAVIPLATA = "1551",
  BAN100 = "1558",
  IRIS = "1637",
  MOVII = "1801",
  DING = "1802",
  POWWI = "1803",
  UALA = "1804",
  BOLD = "1808",
  NU = "1809",
  RAPPIPAY = "1811",
  COINK = "1812",
  GLOBAL66 = "1814",
  ALIANZA_FIDUCIARIA = "1815",
  CREZCAMOS = "1816",
}

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(PseBankCode));

/** Si `value` es uno de los códigos de compensación del catálogo. */
export function isPseBankCode(value: string): value is PseBankCode {
  return KNOWN_CODES.has(value);
}
