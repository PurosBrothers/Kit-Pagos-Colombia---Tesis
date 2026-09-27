import { Gateway } from "../../value-objects/Gateway";
import { WebhookEvent } from "../../value-objects/WebhookEvent";
import { TransactionStatus } from "../../value-objects/TransactionStatus";
import { KitPagosError } from "../../errors/KitPagosError";
import { KitPagosErrorCode } from "../../value-objects/KitPagosErrorCode";
import {
  GatewayWebhookHandler,
  IncomingWebhook,
  WebhookSigningContext,
  WebhookVerificationOptions,
} from "./GatewayWebhookHandler";
import {
  safeCompare,
  hmacSha256HexAsBase64,
  normalizeTimestamp,
  isTimestampWithinTolerance,
} from "./signature-utils";

/**
 * Prefijo de `failure_code` que identifica un rechazo del procesador de tarjeta.
 * Catalogo completo en docs.rapyd.net/en/card-network-errors.html; por ejemplo
 * "ERROR_PROCESSING_CARD - [51]" es fondos insuficientes.
 */
const CARD_DECLINE_PREFIX = "ERROR_PROCESSING_CARD";

/**
 * Manejador de webhooks de Rapyd (adquirida por PayU GPO el 14 mar 2025).
 *
 * Firma: cabecera "signature", `BASE64(HMAC-SHA256(url_path + salt + timestamp +
 * access_key + secret_key + body_string))`, con el base64 aplicado al texto
 * hexadecimal del HMAC. Fuente: https://docs.rapyd.net/en/webhook-authentication.html
 *
 * Rapyd solo manda `salt`, `timestamp` y `signature`
 * (docs.rapyd.net/en/webhook-format.html). Los otros dos valores firmados salen de
 * la configuración: `access_key` es `credentials.publicKey`, y `url_path` es la URL
 * COMPLETA registrada en el panel, `credentials.webhookUrl`. Antes se leían de
 * cabeceras que Rapyd no envía; tomarlos de la petición dejaría además que quien la
 * manda eligiera a qué destino queda atada la firma (punto 67).
 */
export class RapydWebhookHandler implements GatewayWebhookHandler {
  verify(
    webhook: IncomingWebhook,
    context: WebhookSigningContext,
    options?: WebhookVerificationOptions,
  ): boolean {
    const { payload, headers } = webhook;
    const receivedSignature = headers["signature"] ?? "";
    const salt = headers["salt"] ?? "";
    const rawTimestamp = headers["timestamp"] ?? "";

    if (!rawTimestamp) {
      throw new Error("Missing required header: timestamp");
    }

    const webhookUrl = requireWebhookUrl(context.webhookUrl);
    if (!context.publicKey) {
      throw new KitPagosError(
        KitPagosErrorCode.INVALID_CREDENTIALS,
        Gateway.RAPYD,
        null,
        "Rapyd webhook verification requires credentials.publicKey (the Rapyd access key)",
      );
    }

    const timestampNum = normalizeTimestamp(rawTimestamp);
    if (!isTimestampWithinTolerance(timestampNum, options?.toleranceSeconds, options?.currentTimestamp)) {
      return false;
    }

    const toSign =
      webhookUrl + salt + rawTimestamp + context.publicKey + context.secret + payload;

    return safeCompare(receivedSignature, hmacSha256HexAsBase64(context.secret, toSign));
  }

  parse(webhook: IncomingWebhook): WebhookEvent {
    const body = JSON.parse(webhook.payload);
    const eventType: string = body.type ?? "";

    // Rapyd nombra el campo `failure_code` en unos eventos y `error_code` en
    // otros para el mismo dato.
    const failureCode: string =
      body.data?.failure_code ?? body.data?.error_code ?? "";

    return new WebhookEvent({
      eventType,
      gatewayTransactionId: body.data?.id ?? "",
      newStatus: mapStatus(eventType, failureCode),
      gateway: Gateway.RAPYD,
    });
  }
}

/**
 * Exige una URL absoluta http(s) y la devuelve tal cual se configuró. No se normaliza
 * porque Rapyd firma la cadena exacta del panel: una barra final o un puerto explícito
 * de más producen otra firma.
 */
function requireWebhookUrl(webhookUrl: string | undefined): string {
  const invalid = () =>
    new KitPagosError(
      KitPagosErrorCode.INVALID_CREDENTIALS,
      Gateway.RAPYD,
      null,
      "Rapyd webhook verification requires credentials.webhookUrl, the absolute URL registered in the Rapyd panel",
    );
  if (!webhookUrl || webhookUrl.trim() !== webhookUrl) {
    throw invalid();
  }
  let protocol: string;
  try {
    protocol = new URL(webhookUrl).protocol;
  } catch {
    throw invalid();
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw invalid();
  }
  return webhookUrl;
}

/**
 * Traduce el tipo de evento de Rapyd al enum unificado.
 *
 * Rapyd envia un webhook distinto segun el resultado, no un unico evento con un
 * campo de estado variable como Wompi. Fuente: ubiquitous-language.md, seccion 2
 * (columna Rapyd Nativo) y Apendice EstadoTransaccion. Corrige la suposicion sin
 * cita que asumia el formato x-www-form-urlencoded de PayU (architecture-log.md,
 * punto 16).
 */
function mapStatus(eventType: string, failureCode: string): TransactionStatus {
  switch (eventType) {
    case "PAYMENT_COMPLETED":
      return "APPROVED";
    case "PAYMENT_SUCCEEDED":
      // data.status "ACT": la solicitud fue recibida pero puede seguir pendiente
      // de un paso adicional (ej. 3DS).
      return "PENDING";
    case "PAYMENT_EXPIRED":
      return "EXPIRED";
    case "PAYMENT_CANCELED":
      return "VOIDED";
    case "PAYMENT_FAILED":
      // Rapyd no separa el rechazo de negocio (fondos insuficientes) del fallo
      // tecnico mediante data.status: es "ERR" en ambos casos. El criterio de
      // desambiguacion es el prefijo de failure_code/error_code, que identifica
      // un rechazo del procesador de tarjeta; cualquier otro codigo (ej.
      // MISSING_AUTHENTICATION_HEADERS) es un fallo de validacion o
      // infraestructura previo al intento de cobro.
      return failureCode.startsWith(CARD_DECLINE_PREFIX) ? "DECLINED" : "ERROR";
    default:
      return "ERROR";
  }
}
