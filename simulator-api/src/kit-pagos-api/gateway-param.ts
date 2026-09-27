import { Gateway, KitPagosErrorCode } from "kit-pagos-colombia";

/**
 * Identificadores de pasarela tal como viajan por la API REST: en minúsculas,
 * en la ruta (`/:gateway`) o en el cuerpo (`{ "gateway": "wompi" }`). Salen del
 * enum del SDK para que una pasarela nueva aparezca sin tocar el simulador.
 */
export const SUPPORTED_GATEWAYS: readonly string[] = Object.values(Gateway).map(
  (gateway) => gateway.toLowerCase(),
);

/**
 * Convierte el identificador que llega por HTTP al enum `Gateway` del SDK.
 * Devuelve `undefined` si no corresponde a ninguna pasarela soportada.
 */
export function parseGateway(value: unknown): Gateway | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const candidate = value.toUpperCase();
  return Object.values(Gateway).find((gateway) => gateway === candidate);
}

/**
 * Cuerpo de la respuesta 400 para una pasarela no soportada. No repite el valor
 * recibido, para no reflejar en la respuesta lo que mandó el cliente.
 */
export function unsupportedGatewayBody(): { code: KitPagosErrorCode; message: string } {
  return {
    code: KitPagosErrorCode.INVALID_REQUEST,
    message: `Unsupported gateway. Supported gateways: ${SUPPORTED_GATEWAYS.join(", ")}.`,
  };
}
