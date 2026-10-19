import { FastifyRequest } from "fastify";
import { headerScenario } from "./scenarioFromRequest";

/**
 * Lo que convierte una credencial en «inválida» para el simulador (issue #122).
 *
 * Convención propia del simulador: el sandbox real no tiene una llave de prueba que se
 * rechace, así que la credencial lleva la marca en el texto. Son las mismas tres que ya
 * usaba `POST /v1/sim/wompi/tokens/cards` para su `404 MERCHANT_NOT_FOUND`.
 */
const INVALID_CREDENTIAL_MARKERS = ["invalid", "inexistente", "not_found"] as const;

/** Si un valor de credencial lleva alguna de las marcas, sin distinguir mayúsculas. */
export function hasInvalidCredentialMarker(value: string | undefined): boolean {
  const lower = value?.toLowerCase();
  return lower !== undefined && INVALID_CREDENTIAL_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Si esta petición debe recibir la respuesta de credencial inválida de su pasarela.
 *
 * La cabecera de escenario manda, como en `resolveScenario()`: con cabecera, solo
 * `INVALID_CREDENTIALS` lo pide, aunque la llave lleve la marca. Sin cabecera decide la
 * credencial, y decide antes que los datos de prueba y el monto, porque esos dos se leen del
 * cuerpo y la pasarela rechaza la llave antes de interpretar el cobro: una tarjeta que
 * declina necesita un comercio que la cobre.
 *
 * Contra qué validación del cuerpo va primero no es una regla general, y por eso lo decide
 * cada ruta según lo medido el 6 de octubre de 2026: Wompi valida el cuerpo antes (`{}` con
 * una llave inexistente dio `422`, no `401`) y Kushki tarjeta valida la llave antes (`K004`
 * antes que `K001`).
 *
 * @param credentialHeaders Las cabeceras donde esa ruta recibe la credencial, en minúsculas.
 */
export function invalidCredentialRequested(
  request: FastifyRequest,
  credentialHeaders: readonly string[],
): boolean {
  return invalidCredentialIn(
    request,
    credentialHeaders.map((name) => {
      const value = request.headers[name];
      return Array.isArray(value) ? value[0] : value;
    }),
  );
}

/**
 * La misma regla, para una credencial que no viaja en una cabecera: la llave pública que
 * Wompi recibe en la ruta de `GET /merchants/{llave}`.
 */
export function invalidCredentialIn(
  request: FastifyRequest,
  credentials: ReadonlyArray<string | undefined>,
): boolean {
  const fromHeader = headerScenario(request);
  if (fromHeader !== undefined) {
    return fromHeader === "INVALID_CREDENTIALS";
  }

  return credentials.some(hasInvalidCredentialMarker);
}
