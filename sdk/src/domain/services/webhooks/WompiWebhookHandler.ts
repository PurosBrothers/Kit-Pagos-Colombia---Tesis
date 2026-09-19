import { Gateway } from "../../value-objects/Gateway";
import { WebhookEvent } from "../../value-objects/WebhookEvent";
import { TransactionStatus } from "../../value-objects/TransactionStatus";
import { GatewayWebhookHandler } from "./GatewayWebhookHandler";
import { safeCompare, sha256Hex } from "./signature-utils";
import { WOMPI_NATIVE_STATUS, lookupNativeStatus } from "../native-status";

/** Tipo de evento por defecto cuando el cuerpo no lo declara. */
const DEFAULT_EVENT_TYPE = "transaction.updated";

/**
 * Manejador de webhooks de Wompi.
 *
 * Firma: viaja en la cabecera "x-event-checksum". La cadena a firmar es la
 * concatenacion de los valores de las propiedades que el propio cuerpo declara en
 * `signature.properties`, mas el timestamp y el secreto de eventos. El algoritmo
 * es SHA-256 puro, sin clave HMAC.
 */
export class WompiWebhookHandler implements GatewayWebhookHandler {
  verify(
    payload: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    const receivedChecksum = headers["x-event-checksum"];
    const body = JSON.parse(payload);
    const properties: string[] = body.signature.properties;

    // Cada propiedad es una ruta con puntos ("transaction.amount_in_cents") que
    // hay que resolver contra el cuerpo. Wompi decide en cada evento cuales
    // campos entran en la firma, asi que la lista no se puede fijar en el SDK.
    const values = properties.map((prop: string) => resolvePath(body, prop));
    const concatenated = values.join("") + body.timestamp + secret;

    return safeCompare(receivedChecksum, sha256Hex(concatenated));
  }

  parse(payload: string): WebhookEvent {
    const body = JSON.parse(payload);

    return new WebhookEvent({
      eventType: body.event ?? DEFAULT_EVENT_TYPE,
      gatewayTransactionId: body.data?.transaction?.id ?? "",
      newStatus: mapStatus(body.data?.transaction?.status ?? ""),
      gateway: Gateway.WOMPI,
    });
  }
}

/**
 * Resuelve una ruta con notacion de puntos contra el cuerpo del evento.
 *
 * Devuelve un objeto vacio en cada tramo ausente en vez de lanzar, para que una
 * propiedad que Wompi declare pero no envie produzca una firma que no coincide
 * (webhook rechazado) y no una excepcion no tipada.
 */
function resolvePath(body: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce(
      (obj: Record<string, unknown>, key: string) =>
        obj ? (obj[key] as Record<string, unknown>) : ({} as Record<string, unknown>),
      body as Record<string, unknown>,
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
