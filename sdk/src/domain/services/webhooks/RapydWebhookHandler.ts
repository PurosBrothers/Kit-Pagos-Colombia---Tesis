import { Gateway } from "../../value-objects/Gateway";
import { WebhookEvent } from "../../value-objects/WebhookEvent";
import { TransactionStatus } from "../../value-objects/TransactionStatus";
import { GatewayWebhookHandler, WebhookVerificationOptions } from "./GatewayWebhookHandler";
import { safeCompare, hmacSha256, normalizeTimestamp, isTimestampWithinTolerance } from "./signature-utils";

/**
 * Prefijo de `failure_code` que identifica un rechazo del procesador de tarjeta.
 * Catalogo completo en docs.rapyd.net/en/card-network-errors.html; por ejemplo
 * "ERROR_PROCESSING_CARD - [51]" es fondos insuficientes.
 */
const CARD_DECLINE_PREFIX = "ERROR_PROCESSING_CARD";

/**
 * Manejador de webhooks de Rapyd (adquirida por PayU GPO el 14 mar 2025).
 *
 * Firma: cabecera "signature", HMAC-SHA256 en base64 sobre
 * `url_path + salt + timestamp + access_key + secret_key + body_string`.
 * Fuente: https://docs.rapyd.net/en/webhook-authentication.html
 *
 * "url_path" aqui es la URL COMPLETA (protocolo + dominio + path) configurada en
 * el panel de Rapyd, no un path relativo del request entrante, a diferencia de la
 * firma de requests salientes. El SDK no puede derivarla del propio request, asi
 * que el middleware del comercio debe inyectarla en la cabecera sintetica
 * "x-webhook-url" antes de llamar verify(). Ver architecture-log.md, punto 16.
 */
export class RapydWebhookHandler implements GatewayWebhookHandler {
  verify(
    payload: string,
    headers: Record<string, string>,
    secret: string,
    options?: WebhookVerificationOptions,
  ): boolean {
    const receivedSignature = headers["signature"] ?? "";
    const accessKey = headers["access_key"] ?? "";
    const salt = headers["salt"] ?? "";
    const rawTimestamp = headers["timestamp"] ?? "";
    const webhookUrl = headers["x-webhook-url"];

    if (!rawTimestamp) {
      throw new Error("Missing required header: timestamp");
    }

    if (!webhookUrl) {
      throw new Error("Missing required header: x-webhook-url");
    }

    const timestampNum = normalizeTimestamp(rawTimestamp);
    if (!isTimestampWithinTolerance(timestampNum, options?.toleranceSeconds, options?.currentTimestamp)) {
      return false;
    }

    const toSign = webhookUrl + salt + rawTimestamp + accessKey + secret + payload;

    return safeCompare(receivedSignature, hmacSha256(secret, toSign, "base64"));
  }

  parse(payload: string): WebhookEvent {
    const body = JSON.parse(payload);
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
