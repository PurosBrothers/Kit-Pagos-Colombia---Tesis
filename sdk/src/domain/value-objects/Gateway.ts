/**
 * Identifica la pasarela de pago concreta.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) y Glosario. Valores en
 * mayuscula por consistencia con TransactionStatus, RejectionCategory y
 * SdkErrorCode (ver docs/architecture/sad-inconsistencies.md, punto 4).
 */
export enum Gateway {
  WOMPI = "WOMPI",
  PAYU = "PAYU",
  MERCADOPAGO = "MERCADOPAGO",
  KUSHKI = "KUSHKI",
}
