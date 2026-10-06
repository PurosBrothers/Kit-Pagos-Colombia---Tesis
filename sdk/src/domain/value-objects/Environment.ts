import { Gateway } from "./Gateway";
import { KitPagosErrorCode } from "./KitPagosErrorCode";
import { KitPagosError } from "../errors/KitPagosError";

/**
 * Ambientes de ejecución soportados por Kit Pagos Colombia.
 *
 * - `simulator`: API de simulación (local o desplegada en la nube).
 * - `sandbox`: Ambientes de prueba oficiales de cada pasarela (medidos).
 * - `production`: Endpoints productivos oficiales de cada pasarela (sin medir).
 */
export const Environment = {
  SIMULATOR: "simulator",
  SANDBOX: "sandbox",
  PRODUCTION: "production",
} as const;

export type Environment = (typeof Environment)[keyof typeof Environment];

export const ALL_ENVIRONMENTS: readonly Environment[] = [
  Environment.SIMULATOR,
  Environment.SANDBOX,
  Environment.PRODUCTION,
];

/**
 * Valida si un valor arbitrario corresponde a un Environment válido.
 */
export function isEnvironment(value: unknown): value is Environment {
  return typeof value === "string" && ALL_ENVIRONMENTS.includes(value as Environment);
}

/**
 * Parsea y valida un valor de ambiente o lanza KitPagosError (INVALID_REQUEST).
 */
export function parseEnvironment(value: unknown, gateway: Gateway = Gateway.WOMPI): Environment {
  if (isEnvironment(value)) {
    return value;
  }
  throw new KitPagosError(
    KitPagosErrorCode.INVALID_REQUEST,
    gateway,
    null,
    `Ambiente '${String(value)}' no válido: use simulator, sandbox o production.`,
  );
}
