import { Gateway } from "../../value-objects/Gateway";
import { WebhookEvent } from "../../value-objects/WebhookEvent";
import { TransactionStatus } from "../../value-objects/TransactionStatus";
import {
  GatewayWebhookHandler,
  IncomingWebhook,
  WebhookSigningContext,
  WebhookVerificationOptions,
} from "./GatewayWebhookHandler";
import { safeCompare, hmacSha256, normalizeTimestamp, isTimestampWithinTolerance } from "./signature-utils";
import { KUSHKI_NATIVE_STATUS, lookupNativeStatus } from "../native-status";

/** Kushki no declara un tipo de evento en el cuerpo. */
const DEFAULT_EVENT_TYPE = "transaction.updated";

/**
 * Manejador de webhooks de Kushki.
 *
 * Firma: cabecera "x-kushki-signature", con el timestamp en "x-kushki-id". La
 * cadena firmada es `body + "." + x_kushki_id` y el algoritmo es HMAC-SHA256 en
 * hexadecimal con el "Webhook signature ID" de la consola.
 *
 * La verificacion de firma ya esta implementada, pero el adaptador de creacion de
 * pagos y el normalizador de respuestas de Kushki se incorporan en la Iteracion 2.
 */
export class KushkiWebhookHandler implements GatewayWebhookHandler {
  verify(
    webhook: IncomingWebhook,
    context: WebhookSigningContext,
    options?: WebhookVerificationOptions,
  ): boolean {
    const receivedSignature = webhook.headers["x-kushki-signature"];
    const kushkiId = webhook.headers["x-kushki-id"];

    if (!kushkiId) {
      throw new Error("Missing required header: x-kushki-id");
    }

    const timestamp = normalizeTimestamp(kushkiId);
    if (!isTimestampWithinTolerance(timestamp, options?.toleranceSeconds, options?.currentTimestamp)) {
      return false;
    }

    const data = webhook.payload + "." + kushkiId;

    return safeCompare(receivedSignature, hmacSha256(context.secret, data, "hex"));
  }

  parse(webhook: IncomingWebhook): WebhookEvent {
    const body = JSON.parse(webhook.payload);

    return new WebhookEvent({
      eventType: DEFAULT_EVENT_TYPE,
      gatewayTransactionId: String(body.transaction_id ?? ""),
      newStatus: mapStatus(body.transaction_status ?? ""),
      gateway: Gateway.KUSHKI,
    });
  }
}

/**
 * Traduce el estado nativo de Kushki al enum unificado.
 *
 * Kushki nombra la aprobacion "APPROVAL" y no "APPROVED", que es la diferencia
 * facil de pasar por alto al leer este mapeo junto al de las otras pasarelas.
 */
/**
 * Comparte la tabla con el normalizador: antes le faltaba `INITIALIZED`, el
 * estado no final de los flujos de efectivo y transferencia (punto 46).
 */
function mapStatus(rawStatus: string): TransactionStatus {
  return lookupNativeStatus(KUSHKI_NATIVE_STATUS, rawStatus);
}
