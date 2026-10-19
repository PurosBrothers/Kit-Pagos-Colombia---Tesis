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
 *
 * Si falta `data.id` (en la URL y en el cuerpo) o la cabecera `x-request-id`, su parte se
 * quita del manifiesto en vez de rechazar la notificación: «If any of the values (`data.id`,
 * `x-request-id`) are not present in the received notification, you must remove them from
 * the manifest before computing the `HMAC`.» Mercado Pago Developers, Webhooks, «Validate
 * notification origin» (`/developers/en/docs/subscriptions/additional-content/your-integrations/notifications/webhooks`),
 * consultada el 7 de octubre de 2026.
 */
export class MercadoPagoWebhookHandler implements GatewayWebhookHandler {
  verify(
    webhook: IncomingWebhook,
    context: WebhookSigningContext,
    options?: WebhookVerificationOptions,
  ): boolean {
    const xSignature = webhook.headers["x-signature"];
    if (!xSignature) {
      throw new Error("Missing required header: x-signature");
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

    const manifest = buildManifest(dataId, webhook.headers["x-request-id"], parts["ts"]);

    return safeCompare(parts["v1"], hmacSha256(context.secret, manifest, "hex"));
  }

  /**
   * El evento sale siempre en `PENDING`: la firma no cubre el cuerpo, así que ningún
   * estado que venga en él es confiable, y el estado real se consulta con
   * `getPaymentStatus(gatewayTransactionId)` (punto 70). Es el diseño, no un defecto: la
   * misma página de Webhooks indica obtener «the complete information of the notified
   * resource» con `GET /v1/payments/[ID]` o `GET /v1/orders/{id}` después de recibir la
   * notificación.
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
 * Devuelve `undefined` cuando no viene en ninguno de los dos, y `null` cuando el cuerpo trae
 * otro id, porque el cuerpo no está firmado.
 */
function signedDataId(
  query: Record<string, string> | undefined,
  body: { data?: { id?: unknown } } | null,
): string | undefined | null {
  const queryId = query?.[DATA_ID_QUERY_PARAM];
  const bodyId = body?.data?.id === undefined ? undefined : String(body.data.id);
  if (queryId !== undefined && bodyId !== undefined && queryId.toLowerCase() !== bodyId.toLowerCase()) {
    return null;
  }
  return (queryId ?? bodyId) || undefined;
}

/**
 * `id:[data.id];request-id:[x-request-id];ts:[ts];` sin las partes cuyo valor no llegó. El
 * `data.id` va en minúsculas porque los ids alfanuméricos de la Orders API llegan en mayúsculas.
 */
function buildManifest(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  const idPart = dataId ? `id:${dataId.toLowerCase()};` : "";
  const requestIdPart = requestId ? `request-id:${requestId};` : "";
  return `${idPart}${requestIdPart}ts:${ts};`;
}

/** Descompone `ts={timestamp},v1={hash}` en sus partes. */
function parseSignatureHeader(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(",").map((p: string) => p.split("=")),
  );
}