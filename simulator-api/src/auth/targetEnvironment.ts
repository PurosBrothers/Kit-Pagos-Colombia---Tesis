import { Gateway, KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";

/** Cabecera HTTP donde el cliente declara el ambiente al que desea dirigir la petición. */
export const ENVIRONMENT_HEADER = "x-kit-pagos-environment";

/**
 * A dónde van las llamadas del SDK que arma la API:
 * - `simulator`: los mocks de `/v1/sim/<pasarela>`, locales o desplegados en Render.
 * - `sandbox`: el ambiente de pruebas oficial de cada pasarela (catálogo cerrado medido).
 * - `production`: los endpoints de producción oficiales de cada pasarela (catálogo cerrado sin medir).
 */
export type TargetEnvironment = "simulator" | "sandbox" | "production";

/**
 * Resuelve el ambiente destino a partir de las cabeceras HTTP de la petición (issue #123).
 *
 * - Sin cabecera (o vacía): devuelve `simulator`, que es el valor seguro por defecto.
 * - Con valor válido (`simulator`, `sandbox` o `production`): devuelve ese ambiente.
 * - Con valor desconocido o inválido: lanza `KitPagosError` con código `INVALID_REQUEST` (HTTP 400).
 */
export function resolveTargetEnvironment(
  headers?: Record<string, string | string[] | undefined>,
  gateway: Gateway = Gateway.WOMPI,
): TargetEnvironment {
  if (!headers) {
    return "simulator";
  }

  const rawValue = headers[ENVIRONMENT_HEADER] ?? headers[ENVIRONMENT_HEADER.toLowerCase()];
  const envValue = Array.isArray(rawValue) ? rawValue[0] : rawValue;

  if (!envValue || envValue.trim() === "") {
    return "simulator";
  }

  const normalized = envValue.trim().toLowerCase();
  if (normalized === "simulator" || normalized === "sandbox" || normalized === "production") {
    return normalized as TargetEnvironment;
  }

  throw new KitPagosError(
    KitPagosErrorCode.INVALID_REQUEST,
    gateway,
    null,
    `Ambiente '${envValue}' no válido: use simulator, sandbox o production.`,
  );
}
