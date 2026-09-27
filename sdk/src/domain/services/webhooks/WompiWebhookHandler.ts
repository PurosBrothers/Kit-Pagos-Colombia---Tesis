import { Gateway } from "../../value-objects/Gateway";
import { WebhookEvent } from "../../value-objects/WebhookEvent";
import { TransactionStatus } from "../../value-objects/TransactionStatus";
import {
  GatewayWebhookHandler,
  IncomingWebhook,
  WebhookSigningContext,
  WebhookVerificationOptions,
} from "./GatewayWebhookHandler";
import { safeCompare, sha256Hex, normalizeTimestamp, isTimestampWithinTolerance } from "./signature-utils";
import { WOMPI_NATIVE_STATUS, lookupNativeStatus } from "../native-status";

/** Tipo de evento por defecto cuando el cuerpo no lo declara. */
const DEFAULT_EVENT_TYPE = "transaction.updated";

/**
 * Propiedades que `parse()` lee de una transacción y que por eso la firma tiene que
 * cubrir. La lista `signature.properties` viaja sin firmar: sin esta exigencia, un
 * evento capturado se puede reescribir apuntando la lista a un campo nuevo que
 * repita la concatenación original, y cambiar el estado sin alterar el checksum
 * (punto 66).
 */
const REQUIRED_TRANSACTION_PROPERTIES = ["transaction.id", "transaction.status"];

/**
 * Manejador de webhooks de Wompi.
 *
 * Firma: viaja en la cabecera "x-event-checksum". La cadena a firmar es la
 * concatenacion de los valores de las propiedades que el propio cuerpo declara en
 * `signature.properties`, mas el timestamp y el secreto de eventos. El algoritmo
 * es SHA-256 puro, sin clave HMAC. Las propiedades son rutas relativas al objeto
 * `data` (docs.wompi.co/docs/colombia/eventos/), no a la raíz del cuerpo.
 */
export class WompiWebhookHandler implements GatewayWebhookHandler {
  verify(
    webhook: IncomingWebhook,
    context: WebhookSigningContext,
    options?: WebhookVerificationOptions,
  ): boolean {
    const receivedChecksum = webhook.headers["x-event-checksum"];
    const body = JSON.parse(webhook.payload);

    if (body.timestamp === undefined || body.timestamp === null) {
      throw new Error("Missing timestamp in Wompi webhook payload");
    }
    if (!body.signature?.properties || !Array.isArray(body.signature.properties)) {
      throw new Error("Missing signature.properties in Wompi webhook payload");
    }

    const timestamp = normalizeTimestamp(body.timestamp);
    if (!isTimestampWithinTolerance(timestamp, options?.toleranceSeconds, options?.currentTimestamp)) {
      return false;
    }

    const properties: string[] = body.signature.properties;
    if (!coversParsedTransactionFields(body, properties)) {
      return false;
    }

    // Wompi decide en cada evento cuales campos entran en la firma, asi que la
    // lista no se puede fijar en el SDK; solo se exige que cubra lo que se lee.
    const values = properties.map((prop: string) => resolvePath(body.data, prop));
    const concatenated = values.join("") + body.timestamp + context.secret;

    // La documentación muestra el checksum en mayúsculas y los ejemplos de código lo
    // calculan en minúsculas; el hexadecimal vale lo mismo en los dos casos.
    return safeCompare(receivedChecksum?.toLowerCase(), sha256Hex(concatenated));
  }

  parse(webhook: IncomingWebhook): WebhookEvent {
    const body = JSON.parse(webhook.payload);

    return new WebhookEvent({
      eventType: body.event ?? DEFAULT_EVENT_TYPE,
      gatewayTransactionId: body.data?.transaction?.id ?? "",
      newStatus: mapStatus(body.data?.transaction?.status ?? ""),
      gateway: Gateway.WOMPI,
    });
  }
}

function coversParsedTransactionFields(body: { data?: { transaction?: unknown } }, properties: string[]): boolean {
  if (body.data?.transaction === undefined) {
    return true;
  }
  return REQUIRED_TRANSACTION_PROPERTIES.every((required) => properties.includes(required));
}

/**
 * Resuelve una ruta con notacion de puntos contra el objeto `data` del evento.
 *
 * Devuelve un objeto vacio en cada tramo ausente en vez de lanzar, para que una
 * propiedad que Wompi declare pero no envie produzca una firma que no coincide
 * (webhook rechazado) y no una excepcion no tipada.
 */
function resolvePath(data: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce(
      (obj: Record<string, unknown>, key: string) =>
        obj ? (obj[key] as Record<string, unknown>) : ({} as Record<string, unknown>),
      data as Record<string, unknown>,
    );
}

/**
 * Traduce el estado nativo de Wompi al enum unificado.
 *
 * Comparte la tabla con el normalizador de respuestas: antes tenia su propia
 * copia a la que le faltaba `PENDING`, de modo que la notificacion de un PSE
 * esperando al pagador se reportaba como `ERROR` (punto 46 del architecture-log).
 */
function mapStatus(rawStatus: string): TransactionStatus {
  return lookupNativeStatus(WOMPI_NATIVE_STATUS, rawStatus);
}
