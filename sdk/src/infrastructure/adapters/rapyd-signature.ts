/**
 * Autenticación de peticiones salientes de Rapyd.
 *
 * ## Por qué está separado del RapydAdapter
 *
 * El esquema de firma de Rapyd es un algoritmo cerrado, con una especificación
 * externa publicada (`docs.rapyd.net/en/request-signatures.html`) y un vector
 * de prueba oficial contra el que se puede verificar. No tiene nada que ver con
 * "ser un adaptador de pasarela": es criptografía con un contrato preciso, y
 * cuatro detalles fáciles de implementar mal (ver `computeRapydSignature`).
 *
 * Sacarlo del adaptador tiene dos beneficios concretos:
 *
 * 1. Se puede probar de forma aislada contra el vector oficial, sin montar una
 *    petición HTTP ni mockear `fetch`.
 * 2. `buildRapydHeaders()` recibe las credenciales como argumento en vez de
 *    leer `this.credentials`, lo que la vuelve una función pura: mismos
 *    argumentos, mismos headers, sin instanciar un adaptador.
 *
 * Son funciones de módulo por lo mismo que en `big-arithmetic.ts`: no hay
 * estado que mantener entre llamadas. El único punto de impureza deliberada es
 * `generateSalt()` y `currentUnixTimestamp()`, que por definición dependen del
 * reloj y del generador aleatorio.
 * Ver architecture-log.md, punto 33.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { Credentials } from "../../domain/value-objects/Credentials";

/** Longitud del salt en bytes. 8 bytes → 16 caracteres hexadecimales. */
const SALT_BYTES = 8;

/**
 * Calcula la firma HMAC de una petición saliente de Rapyd.
 *
 * Fórmula oficial (`docs.rapyd.net/en/request-signatures.html`):
 *
 *   signature = BASE64( HEX( HMAC-SHA256_secret(
 *     http_method + url_path + salt + timestamp + access_key + secret_key + body_string
 *   )))
 *
 * Cuatro detalles que la vuelven fácil de implementar mal:
 * 1. El resultado del HMAC se serializa primero a **hexadecimal** y ese texto
 *    hex es lo que se codifica en Base64. No es `digest("base64")`.
 * 2. El método HTTP va en **minúsculas**.
 * 3. La `secret_key` aparece **dos veces**: en la cadena y como llave del HMAC.
 * 4. Un cuerpo vacío se firma como string vacío, **no** como `"{}"`.
 */
export function computeRapydSignature(
  credentials: Credentials,
  httpMethod: string,
  urlPath: string,
  salt: string,
  timestamp: number,
  bodyString: string,
): string {
  const { publicKey: accessKey, privateKey: secretKey } = credentials;
  const toSign =
    httpMethod.toLowerCase() +
    urlPath +
    salt +
    timestamp +
    accessKey +
    secretKey +
    bodyString;
  const hmac = createHmac("sha256", secretKey);
  hmac.update(toSign);
  return Buffer.from(hmac.digest("hex")).toString("base64");
}

/**
 * Genera un salt aleatorio en hexadecimal.
 * Rapyd recomienda entre 8 y 16 caracteres; usamos 8 bytes → 16 caracteres.
 */
export function generateSalt(): string {
  return randomBytes(SALT_BYTES).toString("hex");
}

/**
 * Timestamp Unix en segundos enteros.
 * Rapyd rechaza peticiones que se desvíen más de 60 segundos del reloj real.
 */
export function currentUnixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Extrae el path que participa en la firma de Rapyd.
 *
 * Rapyd firma la porción de la URL posterior al host, incluida la query string.
 * Se usa el parser de URL nativo para no depender de concatenar strings a mano.
 */
export function extractRapydUrlPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Serializa el cuerpo de la petición para envío y firma.
 *
 * `JSON.stringify` sin espacios es lo que Rapyd exige: la firma se calcula
 * sobre este string exacto y cualquier diferencia de formato la invalida.
 */
export function serializeBody(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

/**
 * Construye los headers de una petición firmada de Rapyd.
 *
 * Cuando no hay credenciales devuelve solo `Content-Type`: el mock no
 * verifica la firma, y firmar con llaves vacías sería teatro.
 *
 * `bodyString` debe ser exactamente el mismo texto que se enviará como cuerpo:
 * si se serializara dos veces cualquier diferencia produciría una firma inválida.
 */
export function buildRapydHeaders(
  httpMethod: string,
  url: string,
  bodyString: string,
  credentials?: Credentials,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!credentials) {
    return headers;
  }

  const salt = generateSalt();
  const timestamp = currentUnixTimestamp();
  const urlPath = extractRapydUrlPath(url);

  headers["access_key"] = credentials.publicKey;
  headers["salt"] = salt;
  headers["timestamp"] = String(timestamp);
  headers["signature"] = computeRapydSignature(
    credentials,
    httpMethod,
    urlPath,
    salt,
    timestamp,
    bodyString,
  );

  return headers;
}
