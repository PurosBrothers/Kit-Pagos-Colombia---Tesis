import { createHmac, randomUUID } from "node:crypto";

/*
 * La firma de las peticiones a la API de Rapyd (punto 86).
 *
 * Nivel 1 — medido contra `sandboxapi.rapyd.net` el 7 de octubre de 2026, entre las 21:06 y las
 * 21:27 (UTC−5), firmando como `sdk/src/infrastructure/adapters/rapyd-signature.ts`.
 * `GET /v1/payment_methods/country` y `POST /v1/checkout` respondieron igual:
 *
 * - falta la cabecera `signature`: `400 MISSING_AUTHENTICATION_HEADERS`;
 * - la firma no coincide: `401 UNAUTHENTICATED_API_CALL` con el mensaje de la firma;
 * - el timestamp está fuera de rango: `401` con su mensaje. De −300 s a +3600 s pasó; −360 s se
 *   rechazó; más allá de +3600 s no se midió;
 * - el salt se repite, aunque cambien el timestamp y la firma: `401` con su mensaje. El salt de
 *   una petición rechazada por la firma no queda gastado;
 * - con varios problemas a la vez: la cabecera faltante, después la firma, después el resto.
 *
 * Lo que el simulador decide y no está medido está marcado en cada constante.
 */

/** Cuánto en el pasado puede estar el timestamp: −300 s pasó y −360 s no (medido). */
export const TIMESTAMP_MAX_AGE_SECONDS = 300;

/**
 * Cuánto en el futuro puede estar el timestamp. +3600 s pasó (medido); más allá no se midió, y
 * el simulador lo rechaza (nivel 3): quien firme dentro de lo medido nunca recibe un rechazo
 * que Rapyd no daría.
 */
export const TIMESTAMP_MAX_LEAD_SECONDS = 3600;

/** Las cuatro cabeceras de autenticación. Solo se midió la falta de `signature`. */
export const AUTHENTICATION_HEADERS = ["access_key", "salt", "timestamp", "signature"] as const;

export interface RapydRejection {
  statusCode: 400 | 401;
  body: {
    status: {
      error_code: string;
      status: "ERROR";
      message: string;
      response_code: string;
      operation_id: string;
    };
  };
}

function rejection(statusCode: 400 | 401, errorCode: string, message: string): RapydRejection {
  return {
    statusCode,
    body: {
      status: {
        error_code: errorCode,
        status: "ERROR",
        message,
        response_code: errorCode,
        // Rapyd responde un `operation_id` nuevo en cada rechazo (medido).
        operation_id: randomUUID(),
      },
    },
  };
}

export const missingHeadersRejection = (): RapydRejection =>
  rejection(
    400,
    "MISSING_AUTHENTICATION_HEADERS",
    "The request did not contain the required headers for authentication. The request was rejected. " +
      "Corrective action: Add authentication headers.",
  );

export const signatureMismatchRejection = (): RapydRejection =>
  rejection(
    401,
    "UNAUTHENTICATED_API_CALL",
    "The API received a request, but the signature did not match. The request was rejected. " +
      "Corrective action: (1) Remove all whitespace that is not inside a string. " +
      "(2) Remove trailing zeroes and decimal points, or wrap numbers in a string.",
  );

export const timestampOutOfRangeRejection = (): RapydRejection =>
  rejection(401, "UNAUTHENTICATED_API_CALL", "timestamp header is out of allowed range");

export const saltReusedRejection = (): RapydRejection =>
  rejection(401, "UNAUTHENTICATED_API_CALL", "salt header value is not valid, same value used not long ago");

/** La fórmula de `computeRapydSignature()` del SDK, con el secreto del perfil. */
export function computeRapydRequestSignature(
  parts: { method: string; urlPath: string; salt: string; timestamp: string; accessKey: string; body: string },
  secretKey: string,
): string {
  const toSign =
    parts.method.toLowerCase() + parts.urlPath + parts.salt + parts.timestamp + parts.accessKey + secretKey + parts.body;
  return Buffer.from(createHmac("sha256", secretKey).update(toSign).digest("hex")).toString("base64");
}

/**
 * Los salts de las peticiones que pasaron la autenticación.
 *
 * Cuánto dura el «not long ago» de Rapyd no se midió. El simulador recuerda cada salt hasta que
 * el timestamp con el que llegó sale de la ventana (`timestamp + 300 s`), porque desde ahí la
 * misma petición repetida tal cual ya la rechaza el timestamp (nivel 3). El salt de una petición
 * rechazada no se guarda: medido para el rechazo por firma; para el de timestamp, no medido.
 */
export class SaltRegistry {
  private readonly expiries = new Map<string, number>();

  public isRecent(salt: string, nowSeconds: number): boolean {
    const expiry = this.expiries.get(salt);
    return expiry !== undefined && expiry > nowSeconds;
  }

  public remember(salt: string, timestampSeconds: number, nowSeconds: number): void {
    for (const [stored, expiry] of this.expiries) {
      if (expiry <= nowSeconds) this.expiries.delete(stored);
    }
    this.expiries.set(salt, timestampSeconds + TIMESTAMP_MAX_AGE_SECONDS);
  }
}

export interface SignedRequest {
  method: string;
  /** La ruta con la query string, tal como llegó: es lo que el SDK firma. */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** El cuerpo exacto que llegó, sin volver a serializar; vacío si no hay. */
  rawBody: string;
}

function header(request: SignedRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Si faltan cabeceras de autenticación. Va primero en el orden medido. */
export function missingAuthentication(request: SignedRequest): RapydRejection | undefined {
  return AUTHENTICATION_HEADERS.some((name) => !header(request, name)) ? missingHeadersRejection() : undefined;
}

/**
 * Firma, timestamp y salt, en ese orden. El orden entre timestamp y salt no se midió.
 *
 * Un timestamp que no es un número se trata como fuera de rango (nivel 3: no se midió).
 */
export function signatureRejection(
  request: SignedRequest,
  secretKey: string,
  salts: SaltRegistry,
  nowSeconds: number,
): RapydRejection | undefined {
  const salt = header(request, "salt") as string;
  const timestamp = header(request, "timestamp") as string;
  const expected = computeRapydRequestSignature(
    {
      method: request.method,
      urlPath: request.url,
      salt,
      timestamp,
      accessKey: header(request, "access_key") as string,
      body: request.rawBody,
    },
    secretKey,
  );

  if (header(request, "signature") !== expected) {
    return signatureMismatchRejection();
  }

  const timestampSeconds = Number(timestamp);
  const offset = timestampSeconds - nowSeconds;
  if (!Number.isFinite(timestampSeconds) || offset < -TIMESTAMP_MAX_AGE_SECONDS || offset > TIMESTAMP_MAX_LEAD_SECONDS) {
    return timestampOutOfRangeRejection();
  }

  if (salts.isRecent(salt, nowSeconds)) {
    return saltReusedRejection();
  }

  salts.remember(salt, timestampSeconds, nowSeconds);
  return undefined;
}
