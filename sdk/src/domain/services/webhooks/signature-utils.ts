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

/**
 * Normaliza un timestamp numérico o string a segundos Unix enteros.
 * Soporta timestamps en milisegundos (> 1e11) convirtiéndolos a segundos.
 */
export function normalizeTimestamp(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return NaN;
  const num = typeof raw === "string" ? Number(raw) : Number(raw);
  if (isNaN(num)) return NaN;
  return num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
}

/** Tolerancia por defecto en segundos para protección contra ataques de replay (5 minutos). */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Valida que un timestamp caiga dentro de la ventana de tolerancia respecto a la hora actual.
 * Previene ataques de replay (reenvío de webhooks capturados).
 *
 * @param timestampSeconds Timestamp del evento en segundos Unix.
 * @param toleranceSeconds Tolerancia en segundos. Si es <= 0, se desactiva la validación.
 * @param currentTimestampSeconds Timestamp actual de referencia en segundos.
 */
export function isTimestampWithinTolerance(
  timestampSeconds: number,
  toleranceSeconds: number = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  currentTimestampSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (toleranceSeconds <= 0) return true;
  if (!timestampSeconds || isNaN(timestampSeconds)) return false;
  return Math.abs(currentTimestampSeconds - timestampSeconds) <= toleranceSeconds;
}

