import { FastifyRequest } from "fastify";

export const REDACTED_TEXT = "[REDACTED]";

/**
 * Credenciales del cliente que la ruta de webhooks de la API REST quita antes de verificar la
 * firma (`kit-pagos-api/routes/webhooks.ts`). El log no usa esta lista, sino `LOGGABLE_HEADERS`.
 */
export const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-gateway-private-key",
  "x-gateway-public-key",
  "x-gateway-integrity-secret",
  "x-gateway-webhook-secret",
]);

/**
 * Las únicas cabeceras que el log escribe con su valor. Es una lista de permitidas y no de
 * prohibidas porque cada pasarela manda sus credenciales en cabeceras propias
 * (`Private-Merchant-Id` y `Public-Merchant-Id` en Kushki, `access_key` y `signature` en Rapyd),
 * y una pasarela nueva traería otras.
 */
export const LOGGABLE_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "content-type",
  "host",
  "origin",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "user-agent",
  "x-idempotency-key",
  "x-request-id",
  "x-simulate-scenario",
  "x-simulator-scenario",
]);

/**
 * Reemplaza por '[REDACTED]' el valor de toda cabecera que no esté en `LOGGABLE_HEADERS`.
 */
export function sanitizeHeaders(
  headers?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!headers) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = LOGGABLE_HEADERS.has(key.toLowerCase()) ? value : REDACTED_TEXT;
  }
  return sanitized;
}

export interface LoggableRequest {
  method?: string;
  url?: string;
  routerPath?: string;
  params?: unknown;
  headers?: Record<string, unknown>;
}

/**
 * Serializador personalizado de Fastify para el objeto req.
 * Garantiza que ninguna cabecera de credenciales ni de autorización se escriba en los registros.
 */
export function redactReqSerializer(
  req: FastifyRequest | LoggableRequest,
): Record<string, unknown> {
  const reqObj = req as LoggableRequest;
  const rawHeaders = reqObj.headers;

  return {
    method: reqObj.method,
    url: reqObj.url,
    path: reqObj.routerPath ?? reqObj.url,
    parameters: reqObj.params,
    headers: sanitizeHeaders(rawHeaders),
  };
}

/**
 * Opciones de redacción para el logger de Fastify / Pino.
 */
export const fastifyLoggerConfig = {
  serializers: {
    req: redactReqSerializer,
  },
  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["x-gateway-private-key"]',
      'req.headers["x-gateway-public-key"]',
      'req.headers["x-gateway-integrity-secret"]',
      'req.headers["x-gateway-webhook-secret"]',
      "headers.authorization",
      'headers["x-gateway-private-key"]',
      'headers["x-gateway-public-key"]',
      'headers["x-gateway-integrity-secret"]',
      'headers["x-gateway-webhook-secret"]',
    ],
    censor: REDACTED_TEXT,
  },
};
