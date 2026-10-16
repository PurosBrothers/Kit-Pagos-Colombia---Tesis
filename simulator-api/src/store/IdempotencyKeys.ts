import { createHash } from "node:crypto";

/**
 * La idempotencia de `POST /v1/orders` de Mercado Pago, por credencial y `X-Idempotency-Key`.
 *
 * Nivel 1 — medido el 15 de octubre de 2026 entre las 21:37 y las 21:45 con el vendedor de
 * prueba (`docs/testing-data/mercado-pago.md`, «Duplicados e idempotencia en la Orders API»):
 *
 * - La misma llave con el mismo cuerpo responde una copia byte a byte de la respuesta
 *   original, con su status, aunque la orden haya cambiado de estado desde entonces.
 * - La misma llave con otro cuerpo responde `409 idempotency_key_already_used` y no crea nada.
 * - La misma llave mientras la primera petición sigue en curso responde `423 resource_locked`.
 *
 * Nivel 3 — convenciones del simulador:
 *
 * - La llave vence a las 24 horas. La vigencia no se midió; la documentación de Mercado Pago
 *   solo la menciona para Point. Como los demás almacenes, se borra al reiniciar.
 * - Solo se recuerdan las respuestas que crean una orden (`201` y el `402` de una orden
 *   fallida). Una validación (`400`), un `501` o una falla técnica liberan la llave, para que
 *   el reintento con la misma llave pueda crear la orden. Lo que hace la API real con una
 *   llave cuya petición falló así no está medido.
 * - Una llave en curso responde `423` aunque el cuerpo sea otro; lo medido es con el mismo.
 *
 * La credencial se guarda como huella SHA-256, no en claro.
 */

const LIFETIME_MS = 24 * 60 * 60 * 1000;

interface InProgress {
  readonly fingerprint: string;
  readonly inProgress: true;
}

interface Remembered {
  readonly fingerprint: string;
  readonly inProgress: false;
  readonly statusCode: number;
  readonly payload: string;
  readonly expiresAt: number;
}

export type IdempotencyClaim =
  | { readonly outcome: "new" }
  | { readonly outcome: "locked" }
  | { readonly outcome: "conflict" }
  | { readonly outcome: "replay"; readonly statusCode: number; readonly payload: string };

const entries = new Map<string, InProgress | Remembered>();

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** La entrada de una llave: la huella de la credencial y la llave tal como llegó. */
export function idempotencyEntryKey(credential: string | undefined, key: string): string {
  return `${sha256(credential ?? "")}:${key}`;
}

/** La huella del cuerpo de la petición, para saber si una llave repetida trae otro cuerpo. */
export function bodyFingerprint(body: unknown): string {
  return sha256(JSON.stringify(body ?? null));
}

/**
 * Reserva la llave para una petición nueva, o dice qué responder si ya se usó.
 *
 * Una llave vencida cuenta como nueva.
 */
export function claimIdempotencyKey(
  entryKey: string,
  fingerprint: string,
  now = Date.now(),
): IdempotencyClaim {
  const entry = entries.get(entryKey);
  if (entry === undefined || (!entry.inProgress && entry.expiresAt <= now)) {
    entries.set(entryKey, { fingerprint, inProgress: true });
    return { outcome: "new" };
  }
  if (entry.inProgress) {
    return { outcome: "locked" };
  }
  if (entry.fingerprint !== fingerprint) {
    return { outcome: "conflict" };
  }
  return { outcome: "replay", statusCode: entry.statusCode, payload: entry.payload };
}

/** Recuerda la respuesta de una petición que creó una orden. */
export function rememberIdempotentResponse(
  entryKey: string,
  statusCode: number,
  payload: string,
  now = Date.now(),
): void {
  const entry = entries.get(entryKey);
  if (entry === undefined) {
    return;
  }
  entries.set(entryKey, {
    fingerprint: entry.fingerprint,
    inProgress: false,
    statusCode,
    payload,
    expiresAt: now + LIFETIME_MS,
  });
}

/** Libera una llave que sigue en curso; una respuesta ya recordada no se toca. */
export function releaseIdempotencyKey(entryKey: string): void {
  if (entries.get(entryKey)?.inProgress) {
    entries.delete(entryKey);
  }
}

/** Borra todas las llaves. */
export function clearIdempotencyKeys(): void {
  entries.clear();
}
