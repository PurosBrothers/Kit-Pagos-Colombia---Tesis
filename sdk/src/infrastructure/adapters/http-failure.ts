import { ErrorHandler } from "../../application/services/ErrorHandler";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import type { Credentials } from "../../domain/value-objects/Credentials";
import type { Gateway } from "../../domain/value-objects/Gateway";

/**
 * Traduce una respuesta HTTP no exitosa a `KitPagosError`, leyendo el cuerpo una sola vez.
 *
 * Los cuatro adaptadores hacían `await response.json()` y, si fallaba, `await
 * response.text()` en el `catch`. Con el `fetch` real eso nunca funcionó: el primer intento
 * consume el cuerpo aunque no sea JSON, y el segundo rechaza con `TypeError: Body is
 * unusable`, que salía del SDK sin clasificar. Un 502 con HTML de un balanceador, el caso
 * más común de cuerpo no JSON, terminaba así. Los mocks no lo mostraban porque ahí `json()`
 * y `text()` son funciones independientes.
 *
 * Si la lectura del cuerpo falla —por ejemplo, porque la señal de `withRequestTimeout` corta
 * a mitad del cuerpo—, ese fallo es el que se traduce, y el comercio ve `GATEWAY_TIMEOUT` en
 * vez de un status cuyo cuerpo nunca llegó completo.
 *
 * Con `credentials`, el error sale sin ninguno de esos valores: ver `redactCredentials()`.
 */
export async function httpFailure(
  response: Response,
  gateway: Gateway,
  credentials?: Credentials,
): Promise<KitPagosError> {
  const errorHandler = new ErrorHandler();
  let text: string;
  try {
    text = await response.text();
  } catch (readError) {
    return errorHandler.handle(readError, gateway);
  }
  return redactCredentials(
    errorHandler.handle({ status: response.status, body: parseErrorBody(text) }, gateway),
    credentials,
  );
}

/** El cuerpo como JSON si lo es; si no, el texto tal cual, para el `originalPayload`. */
function parseErrorBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Lo que reemplaza a una credencial dentro del error. */
const REDACTED = "[REDACTED]";

/**
 * Por debajo de este largo no se busca el valor: un valor de dos o tres caracteres
 * aparecería por coincidencia en cualquier texto y destrozaría el cuerpo sin proteger nada.
 * Ninguna llave real de las cuatro pasarelas es tan corta.
 */
const MIN_REDACTABLE_LENGTH = 4;

/**
 * Los valores configurados que no pueden salir en un error.
 *
 * `webhookUrl` queda fuera porque no es un secreto: es la URL pública del comercio.
 */
function credentialValues(credentials: Credentials | undefined): string[] {
  if (!credentials) return [];
  return [
    credentials.publicKey,
    credentials.privateKey,
    credentials.integritySecret,
    credentials.webhookSecret,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.length >= MIN_REDACTABLE_LENGTH,
  );
}

function redactText(text: string, secrets: readonly string[]): string {
  return secrets.reduce((current, secret) => current.split(secret).join(REDACTED), text);
}

/**
 * Si un valor es un objeto literal, como los que produce `JSON.parse`.
 *
 * Se compara contra la raíz de la cadena de prototipos y no contra `Object.prototype`: el
 * cuerpo que lee `response.json()` puede venir de otro reino de JavaScript (dentro de Jest,
 * el del `fetch` de Node), con su propio `Object.prototype`.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/** Si un valor es un `Error`, de este reino o de otro. */
function isError(value: unknown): value is Error {
  return Object.prototype.toString.call(value) === "[object Error]";
}

/**
 * Una copia del error con sus propiedades propias limpias, `message` y `stack` incluidos.
 *
 * El `SyntaxError` de `JSON.parse` repite el principio del texto que no pudo leer, y ese
 * error es el `originalPayload` de un `MALFORMED_RESPONSE`. Se conserva el prototipo para
 * que siga siendo `instanceof` su clase, y si no había nada que limpiar se devuelve el mismo
 * error, para no romper la identidad del `cause`.
 */
function redactError(error: Error, secrets: readonly string[]): Error {
  const source = error as unknown as Record<string, unknown>;
  const copy = Object.create(Object.getPrototypeOf(error)) as Record<string, unknown>;
  let changed = false;
  for (const key of Object.getOwnPropertyNames(error)) {
    copy[key] = redactValue(source[key], secrets);
    changed ||= copy[key] !== source[key];
  }
  return changed ? (copy as unknown as Error) : error;
}

/**
 * Recorre un cuerpo JSON y reemplaza los valores en cada texto.
 *
 * Entra en textos, listas y objetos literales, que es todo lo que puede salir de
 * `JSON.parse`, y en errores. Cualquier otro objeto se deja tal cual.
 */
function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (isError(value)) return redactError(value, secrets);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]),
    );
  }
  return value;
}

/**
 * Quita del `message` y del `originalPayload` todo valor de credencial configurado.
 *
 * Wompi repite la llave recibida en el `reason` de un `401`: con la llave `garbage`
 * respondió `"La llave proporcionada no corresponde a este ambiente, se recibió: garbage"`
 * (medido el 6 de octubre de 2026, `docs/testing-data/wompi.md`, sección 1.3). La limpieza
 * por patrones de `ErrorHandler` no lo cubre: busca prefijos como `prv_` o nombres de campo,
 * y una llave mal pegada no tiene ni lo uno ni lo otro. Por eso aquí se busca el valor
 * exacto, que solo conoce el adaptador.
 */
export function redactCredentials(
  error: KitPagosError,
  credentials: Credentials | undefined,
): KitPagosError {
  const secrets = credentialValues(credentials);
  if (secrets.length === 0) return error;

  return new KitPagosError(
    error.code,
    error.gateway,
    redactValue(error.originalPayload, secrets),
    redactText(error.message, secrets),
    { cause: redactValue(error.cause, secrets) },
  );
}
