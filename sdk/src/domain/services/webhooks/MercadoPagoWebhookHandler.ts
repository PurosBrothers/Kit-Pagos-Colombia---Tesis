import { Gateway } from "../../value-objects/Gateway";
import { WebhookEvent } from "../../value-objects/WebhookEvent";
import {
  GatewayWebhookHandler,
  IncomingWebhook,
  WebhookSigningContext,
  WebhookVerificationOptions,
} from "./GatewayWebhookHandler";
import { safeCompare, hmacSha256, normalizeTimestamp, isTimestampWithinTolerance } from "./signature-utils";

/** Tipo de evento por defecto cuando el cuerpo no declara `action` ni `type`. */
const DEFAULT_EVENT_TYPE = "payment.updated";

/** Nombre del parámetro de la URL que Mercado Pago firma. */
const DATA_ID_QUERY_PARAM = "data.id";

/**
 * Manejador de webhooks de Mercado Pago.
 *
 * Firma: la version "v1" viaja en la cabecera "x-signature" con formato
 * `ts={timestamp},v1={hash}`. La cadena firmada es
 * `id:{data.id};request-id:{x-request-id};ts:{ts};` y el algoritmo es
 * HMAC-SHA256 en hexadecimal con la clave secreta de la aplicacion.
 *
 * El `data.id` firmado es el **parámetro de la URL**, en minúsculas si es
 * alfanumérico (los ids de la Orders API llegan en mayúsculas). El cuerpo no está
 * firmado, así que si trae otro `data.id` la notificación se rechaza: de lo
 * contrario el evento reportaría un id distinto del que se verificó (punto 67).
 * Sin parámetro en la URL se usa el del cuerpo, que en la Payments API coincide.
 */
export class MercadoPagoWebhookHandler implements GatewayWebhookHandler {
  verify(
    webhook: IncomingWebhook,
    context: WebhookSigningContext,
    options?: WebhookVerificationOptions,
  ): boolean {
    const xSignature = webhook.headers["x-signature"];
    const requestId = webhook.headers["x-request-id"];
    if (!xSignature) {
      throw new Error("Missing required header: x-signature");
    }
    if (!requestId) {
      throw new Error("Missing required header: x-request-id");
    }

    const dataId = signedDataId(webhook.query, JSON.parse(webhook.payload));
    if (dataId === null) {
      return false;
    }

    const parts = parseSignatureHeader(xSignature);
    if (!parts["ts"] || !parts["v1"]) {
      throw new Error("Invalid x-signature header format: missing ts or v1");
    }
    const timestamp = normalizeTimestamp(parts["ts"]);
    if (!isTimestampWithinTolerance(timestamp, options?.toleranceSeconds, options?.currentTimestamp)) {
      return false;
    }

    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts["ts"]};`;

    return safeCompare(parts["v1"], hmacSha256(context.secret, manifest, "hex"));
  }

  /**
   * El evento sale siempre en `PENDING`: la firma no cubre el cuerpo, así que ningún
   * estado que venga en él es confiable, y el estado real se consulta con
   * `getPaymentStatus(gatewayTransactionId)` (punto 70).
   */
  parse(webhook: IncomingWebhook): WebhookEvent {
    const body = JSON.parse(webhook.payload);
    const signedId = webhook.query?.[DATA_ID_QUERY_PARAM];

    return new WebhookEvent({
      eventType: body.action ?? body.type ?? DEFAULT_EVENT_TYPE,
      gatewayTransactionId: signedId ?? String(body.data?.id ?? ""),
      newStatus: "PENDING",
      gateway: Gateway.MERCADOPAGO,
    });
  }
}

/**
 * El `data.id` que Mercado Pago firmó: el de la URL si viene y, si no, el del cuerpo.
 * Devuelve `null` cuando el cuerpo trae otro id, porque el cuerpo no está firmado.
 */
function signedDataId(
  query: Record<string, string> | undefined,
  body: { data?: { id?: unknown } } | null,
): string | null {
  const queryId = query?.[DATA_ID_QUERY_PARAM];
  const bodyId = body?.data?.id === undefined ? undefined : String(body.data.id);
  const dataId = queryId ?? bodyId;
  if (!dataId) {
    throw new Error("Missing data.id in Mercado Pago webhook URL and payload");
  }
  if (queryId !== undefined && bodyId !== undefined && queryId.toLowerCase() !== bodyId.toLowerCase()) {
    return null;
  }
  return dataId;
}

/** Descompone `ts={timestamp},v1={hash}` en sus partes. */
function parseSignatureHeader(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(",").map((p: string) => p.split("=")),
  );
}