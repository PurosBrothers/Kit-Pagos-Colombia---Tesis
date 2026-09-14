/**
 * Primitivas criptograficas compartidas por los manejadores de webhook.
 *
 * Este modulo es el unico importador de `crypto` en la verificacion de webhooks.
 * Aisla la comparacion en tiempo constante, que es el detalle donde un error
 * silencioso se convierte en una vulnerabilidad: comparar firmas con `===`
 * filtra informacion por el tiempo de respuesta y permite reconstruir la firma
 * byte a byte.
 */
import * as crypto from "crypto";

/**
 * Compara dos firmas en tiempo constante.
 *
 * Devuelve false ante cualquier ausencia o diferencia de longitud en vez de
 * lanzar, porque `crypto.timingSafeEqual` exige buffers del mismo tamano y una
 * firma ausente es un webhook no autentico, no un error de programacion.
 */
export function safeCompare(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/** SHA-256 puro en hexadecimal, sin clave. Lo usa Wompi para su checksum. */
export function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** HMAC-SHA256 con la codificacion de salida que exija la pasarela. */
export function hmacSha256(
  secret: string,
  data: string,
  encoding: "hex" | "base64",
): string {
  return crypto.createHmac("sha256", secret).update(data).digest(encoding);
}
