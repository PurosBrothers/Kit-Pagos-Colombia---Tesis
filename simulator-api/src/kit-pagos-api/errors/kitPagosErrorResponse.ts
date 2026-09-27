import { KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";

/**
 * Traduccion de los codigos de error del SDK a codigos HTTP de la API REST.
 *
 * El `Record` exige una entrada por cada valor de `KitPagosErrorCode`: si el SDK
 * agrega un codigo nuevo, la compilacion del simulador falla aqui en lugar de
 * responder un 500 generico en produccion.
 */
const HTTP_STATUS_BY_CODE: Record<KitPagosErrorCode, number> = {
  [KitPagosErrorCode.INVALID_REQUEST]: 400,
  [KitPagosErrorCode.UNSUPPORTED_OPERATION]: 400,
  [KitPagosErrorCode.INVALID_CREDENTIALS]: 401,
  [KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID]: 401,
  [KitPagosErrorCode.RESOURCE_NOT_FOUND]: 404,
  [KitPagosErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [KitPagosErrorCode.CONNECTION_FAILED]: 502,
  [KitPagosErrorCode.GATEWAY_SERVER_ERROR]: 502,
  [KitPagosErrorCode.MALFORMED_RESPONSE]: 502,
  [KitPagosErrorCode.MAX_RETRIES_EXCEEDED]: 502,
  [KitPagosErrorCode.GATEWAY_TIMEOUT]: 504,
  [KitPagosErrorCode.UNKNOWN_ERROR]: 500,
};

export interface KitPagosErrorBody {
  code: KitPagosErrorCode;
  message: string;
}

export interface KitPagosErrorResponse {
  statusCode: number;
  body: KitPagosErrorBody;
}

/**
 * Construye la respuesta HTTP de un `KitPagosError`.
 *
 * El cuerpo lleva solo el codigo y el mensaje. `originalPayload` se descarta a
 * proposito: guarda el cuerpo crudo que devolvio la pasarela, y exponerlo
 * filtraria datos del proveedor. El mensaje si se expone porque el SDK ya lo
 * sanitiza antes de lanzarlo (RF-08). Ver el punto 64 del architecture-log.md.
 */
export function toKitPagosErrorResponse(error: KitPagosError): KitPagosErrorResponse {
  return {
    statusCode: HTTP_STATUS_BY_CODE[error.code] ?? 500,
    body: {
      code: error.code,
      message: error.message || error.code,
    },
  };
}
