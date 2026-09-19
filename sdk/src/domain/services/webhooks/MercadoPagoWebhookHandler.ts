import { Gateway } from "../../value-objects/Gateway";
import { WebhookEvent } from "../../value-objects/WebhookEvent";
import { TransactionStatus } from "../../value-objects/TransactionStatus";
import { GatewayWebhookHandler } from "./GatewayWebhookHandler";
import { safeCompare, hmacSha256 } from "./signature-utils";
import { MERCADOPAGO_NATIVE_STATUS, lookupNativeStatus } from "../native-status";

/** Tipo de evento por defecto cuando el cuerpo no declara `action` ni `type`. */
const DEFAULT_EVENT_TYPE = "payment.updated";

/**
 * Manejador de webhooks de Mercado Pago.
 *
 * Firma: la version "v1" viaja en la cabecera "x-signature" con formato
 * `ts={timestamp},v1={hash}`. La cadena firmada es
 * `id:{data.id};request-id:{x-request-id};ts:{ts};` y el algoritmo es
 * HMAC-SHA256 en hexadecimal con la clave secreta de la aplicacion.
 */
export class MercadoPagoWebhookHandler implements GatewayWebhookHandler {
  verify(
    payload: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    const xSignature = headers["x-signature"];
    const requestId = headers["x-request-id"];
    const body = JSON.parse(payload);
    const dataId = String(body.data.id);

    const parts = parseSignatureHeader(xSignature);
    const manifest = `id:${dataId};request-id:${requestId};ts:${parts["ts"]};`;

    return safeCompare(parts["v1"], hmacSha256(secret, manifest, "hex"));
  }

  parse(payload: string): WebhookEvent {
    const body = JSON.parse(payload);

    // La notificacion nativa de dos pasos solo trae el identificador, sin el
    // estado financiero, asi que `status` puede venir ausente por diseno.
    const rawStatus = body.status
      ? String(body.status).toLowerCase()
      : undefined;

    return new WebhookEvent({
      eventType: body.action ?? body.type ?? DEFAULT_EVENT_TYPE,
      gatewayTransactionId: String(body.data?.id ?? ""),
      newStatus: mapStatus(rawStatus),
      gateway: Gateway.MERCADOPAGO,
    });
  }
}

/** Descompone `ts={timestamp},v1={hash}` en sus partes. */
function parseSignatureHeader(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(",").map((p: string) => p.split("=")),
  );
}

/**
 * Traduce el estado nativo de Mercado Pago al enum unificado.
 *
 * Un estado ausente no es un error: en la notificacion de dos pasos la pasarela
 * solo envia `data.id`, y el evento se inicializa en PENDING a la espera de la
 * conciliacion mediante getPaymentStatus(gatewayTransactionId).
 */
function mapStatus(rawStatus: string | undefined): TransactionStatus {
  if (rawStatus === undefined) {
    return "PENDING";
  }
  // Comparte la tabla con el normalizador, que es lo que suma el vocabulario de
  // la Orders API: antes esta copia solo conocia los estados de tarjeta, asi que
  // una notificacion de una orden de PSE (`processed`, `action_required`) se
  // reportaba como `ERROR` (punto 46 del architecture-log).
  return lookupNativeStatus(MERCADOPAGO_NATIVE_STATUS, rawStatus);
}
