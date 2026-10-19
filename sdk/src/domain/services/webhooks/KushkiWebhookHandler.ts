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

  /**
   * `gatewayTransactionId` es el mismo id con que `createPayment()` reportó el cobro, para que
   * el comercio relacione el webhook y lo pase a `getPaymentStatus()`:
   *
   * - Tarjeta: el ticket, en `ticket_number`. El cuerpo trae además un `transaction_id`
   *   distinto y un `token`, que es el token de la tarjeta y no identifica el cobro.
   * - Transferencia (PSE): el `token`, porque la transferencia se identifica y se consulta por
   *   él (`GET /transfer/v1/status/{token}`, ver `extractTransferRedirect`). Este cuerpo no
   *   trae `ticket_number`; trae `ticketNumber` en camelCase, que no sirve para consultarla.
   *
   * `ticket_number` va primero porque la tarjeta trae los dos campos. Fuentes: la tabla y los
   * ejemplos de https://docs.kushki.com/co/notifications/one-time-payments/webhook-card/ y de
   * https://docs.kushki.com/co/notifications/one-time-payments/webhook-transfer-in/ (y su
   * versión `/co/en/`), consultadas el 7 de octubre de 2026. Que el `token` del webhook sea el
   * mismo de `/transfer/v1/status` lo sugiere el nombre del campo; no se midió con un webhook
   * real.
   *
   * El estado sigue la misma división: tarjeta lo trae en `transaction_status` (`APPROVAL`,
   * `DECLINED`) y transferencia en `status` (`approvedTransaction`, `declinedTransaction`…).
   * `transaction_status` va primero porque la tabla del webhook de tarjeta también lista un
   * campo `status`, sin documentar sus valores.
   */
  parse(webhook: IncomingWebhook): WebhookEvent {
    const body = JSON.parse(webhook.payload);

    return new WebhookEvent({
      eventType: DEFAULT_EVENT_TYPE,
      gatewayTransactionId: String(body.ticket_number ?? body.token ?? ""),
      newStatus: mapStatus(body.transaction_status ?? body.status ?? ""),
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
