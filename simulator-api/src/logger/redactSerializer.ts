import { FastifyRequest } from "fastify";

export const REDACTED_TEXT = "[REDACTED]";

export const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-gateway-private-key",
  "x-gateway-public-key",
  "x-gateway-integrity-secret",
  "x-gateway-webhook-secret",
]);

/**
 * Sanitiza un mapa de cabeceras reemplazando los valores de cabeceras sensibles por '[REDACTED]'.
 */
export function sanitizeHeaders(
  headers?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!headers) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      sanitized[key] = REDACTED_TEXT;
    } else {
      sanitized[key] = value;
    }
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
