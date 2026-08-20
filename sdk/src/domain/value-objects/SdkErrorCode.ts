/**
 * Codigos de error tecnico normalizados por el SDK, independientes de
 * cualquier pasarela. Fuente: lenguaje ubicuo del proyecto y SAD,
 * seccion 15.1 (Nucleo del dominio).
 */
export type SdkErrorCode =
  | "INVALID_CREDENTIALS"
  | "GATEWAY_TIMEOUT"
  | "CONNECTION_FAILED"
  | "RATE_LIMIT_EXCEEDED"
  | "INVALID_REQUEST"
  | "RESOURCE_NOT_FOUND"
  | "GATEWAY_SERVER_ERROR"
  | "MALFORMED_RESPONSE"
  | "WEBHOOK_SIGNATURE_INVALID"
  | "UNSUPPORTED_OPERATION"
  | "MAX_RETRIES_EXCEEDED"
  | "UNKNOWN_ERROR";
