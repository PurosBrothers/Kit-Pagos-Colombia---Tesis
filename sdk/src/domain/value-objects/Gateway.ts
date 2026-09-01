/**
 * Identifica la pasarela de pago concreta.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) y Glosario. Valores en
 * mayuscula por consistencia con TransactionStatus, RejectionCategory y
 * SdkErrorCode (ver docs/architecture/architecture-log.md, punto 4).
 *
 * Nota de adquisicion (14 mar 2025): Rapyd completo la adquisicion de PayU GPO
 * en America Latina. El valor RAPYD reemplaza a PAYU en este enum. La API de
 * procesamiento sigue en api.payulatam.com durante el periodo de transicion, pero
 * el mecanismo de firma de webhooks ahora es el de Rapyd (HMAC-SHA256 via header
 * "signature"). Ver docs/architecture/architecture-log.md, punto 9.
 * Fuente: https://www.rapyd.net/es/ | https://docs.rapyd.net/en/merchant-api-reference.html
 */
export enum Gateway {
  WOMPI = "WOMPI",
  /** PayU GPO, operado por Rapyd (adq. 14 mar 2025). Webhook: HMAC-SHA256 header signature. */
  RAPYD = "RAPYD",
  MERCADOPAGO = "MERCADOPAGO",
  KUSHKI = "KUSHKI",
}
