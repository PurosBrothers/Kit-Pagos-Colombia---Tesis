import * as crypto from "crypto";

/**
 * Las fórmulas de firma de webhook de cada pasarela, escritas desde la documentación oficial y
 * no desde el verificador del SDK (issue #130, bloque 1).
 *
 * Si se copiaran del SDK, una prueba que valida con el SDK no demostraría nada: la primera
 * versión de los firmantes de prueba copió esas fórmulas y pasaba mientras Rapyd y Wompi
 * rechazaban cualquier webhook real (punto 67). Ninguna pasarela publica un vector completo;
 * ver `test/webhook-signatures.test.ts`.
 */

/**
 * Wompi (https://docs.wompi.co/docs/colombia/eventos/): los valores de `signature.properties`,
 * el `timestamp` del evento y el secreto de eventos, concatenados sin separador.
 */
export function wompiChecksumInput(values: readonly unknown[], timestamp: number, secret: string): string {
  return `${values.map(String).join("")}${timestamp}${secret}`;
}

/** Wompi: SHA-256 sin llave de `wompiChecksumInput`, en hexadecimal. */
export function wompiEventChecksum(values: readonly unknown[], timestamp: number, secret: string): string {
  return crypto.createHash("sha256").update(wompiChecksumInput(values, timestamp, secret)).digest("hex");
}

/**
 * Mercado Pago
 * (https://www.mercadopago.com.co/developers/es/docs/your-integrations/notifications/webhooks):
 * el manifiesto, con el `data.id` del query en minúsculas.
 */
export function mercadoPagoManifest(dataId: string, requestId: string, ts: string): string {
  return `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
}

/** Mercado Pago: el `v1` de `x-signature`, HMAC-SHA256 del manifiesto en hexadecimal. */
export function mercadoPagoSignature(dataId: string, requestId: string, ts: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(mercadoPagoManifest(dataId, requestId, ts)).digest("hex");
}

/**
 * Kushki (https://docs.kushki.com/co/notifications/overview): HMAC-SHA256 en hexadecimal de
 * los bytes exactos del cuerpo, un punto y `X-Kushki-Id`.
 */
export function kushkiSignature(body: string, kushkiId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${body}.${kushkiId}`).digest("hex");
}

export interface RapydSignatureParts {
  /** La URL completa registrada en el panel de Rapyd. */
  webhookUrl: string;
  salt: string;
  timestamp: string;
  accessKey: string;
  secret: string;
  body: string;
}

/**
 * Rapyd (https://docs.rapyd.net/en/webhook-authentication.html): base64 del **texto**
 * hexadecimal de HMAC-SHA256, no de los bytes del digest (punto 67, defecto 1).
 */
export function rapydWebhookSignature(parts: RapydSignatureParts): string {
  const toSign = `${parts.webhookUrl}${parts.salt}${parts.timestamp}${parts.accessKey}${parts.secret}${parts.body}`;
  const hex = crypto.createHmac("sha256", parts.secret).update(toSign).digest("hex");
  return Buffer.from(hex).toString("base64");
}
