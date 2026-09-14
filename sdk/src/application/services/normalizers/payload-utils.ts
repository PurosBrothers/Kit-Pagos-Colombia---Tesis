/**
 * Utilidades compartidas por los normalizadores de las cuatro pasarelas.
 *
 * Las tres ramas que antes vivian inline en ResponseNormalizer.normalize()
 * repetian textualmente el parseo del payload y la validacion del objeto de
 * datos, con el unico cambio del nombre de la pasarela en el mensaje de error.
 * Esa duplicacion era la mitad de la complejidad del metodo.
 *
 * Son funciones de modulo porque son puras y no pertenecen a ninguna pasarela
 * en particular. Ver architecture-log.md, punto 34.
 */
import { Gateway } from "../../../domain/value-objects/Gateway";
import { KitPagosError } from "../../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../../domain/value-objects/KitPagosErrorCode";

/**
 * Convierte la respuesta cruda en un objeto indexable.
 *
 * Acepta tanto el string JSON (como llega de un cuerpo HTTP sin parsear) como
 * el objeto ya deserializado, porque los adaptadores pasan lo segundo y las
 * pruebas de contrato lo primero.
 *
 * @throws KitPagosError con MALFORMED_RESPONSE si el string no es JSON valido.
 */
export function parsePayload(
  rawResponse: unknown,
  gateway: Gateway,
  gatewayLabel: string,
): Record<string, unknown> {
  try {
    return typeof rawResponse === "string"
      ? (JSON.parse(rawResponse) as Record<string, unknown>)
      : (rawResponse as Record<string, unknown>);
  } catch {
    throw new KitPagosError(
      KitPagosErrorCode.MALFORMED_RESPONSE,
      gateway,
      rawResponse,
      `Failed to parse JSON response from ${gatewayLabel}`,
    );
  }
}

/**
 * Valida que el candidato a objeto de datos exista y traiga identificador.
 *
 * El identificador nativo es el unico campo que las cuatro pasarelas exigen sin
 * excepcion: sin el no hay forma de construir un GatewayTransactionId ni de
 * consultar el estado despues, asi que su ausencia es una respuesta malformada
 * y no un caso a tolerar con valores por defecto.
 *
 * Recibe el candidato ya extraido en vez de extraerlo aca porque la ubicacion
 * varia: Wompi y Rapyd envuelven en `data`, Mercado Pago devuelve el pago en la
 * raiz.
 *
 * @throws KitPagosError con MALFORMED_RESPONSE si falta el objeto o su id.
 */
export function requireData(
  candidate: unknown,
  gateway: Gateway,
  rawResponse: unknown,
  message: string,
): Record<string, unknown> {
  const data = candidate as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object" || !data.id) {
    throw new KitPagosError(
      KitPagosErrorCode.MALFORMED_RESPONSE,
      gateway,
      rawResponse,
      message,
    );
  }
  return data;
}

/**
 * Envuelve la construccion de un objeto de valor para que un dato imposible de
 * interpretar llegue al comercio como KitPagosError tipado, y no como el Error
 * nativo que lanza el objeto de valor.
 *
 * Se usa para el monto, que es el unico campo donde el valor crudo puede violar
 * una invariante del dominio (negativo, con notacion exponencial, con mas
 * decimales de los que la divisa admite) en vez de simplemente faltar.
 */
export function mapValueObjectError<T>(
  build: () => T,
  gateway: Gateway,
  rawResponse: unknown,
  prefix: string,
): T {
  try {
    return build();
  } catch (error) {
    throw new KitPagosError(
      KitPagosErrorCode.MALFORMED_RESPONSE,
      gateway,
      rawResponse,
      `${prefix}: ${(error as Error).message}`,
    );
  }
}

/**
 * Normaliza a string un monto que la pasarela puede haber enviado como numero
 * JSON.
 *
 * Cuando llega como numero la escala ya se perdio antes del SDK: `150000.00` es
 * indistinguible de `150000` despues del parseo de JSON. No es algo que el SDK
 * pueda arreglar del lado entrante, y es exactamente la razon por la que si se
 * envia como string en la peticion, donde la escala participa del calculo de la
 * firma.
 */
export function amountToString(rawAmount: unknown): string {
  return typeof rawAmount === "number" ? rawAmount.toString() : String(rawAmount ?? "");
}
