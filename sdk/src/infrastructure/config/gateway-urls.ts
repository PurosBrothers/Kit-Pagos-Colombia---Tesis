import { Gateway } from "../../domain/value-objects/Gateway";
import { Environment } from "../../domain/value-objects/Environment";

/**
 * Catálogo cerrado de URLs base por pasarela y ambiente.
 *
 * - sandbox: URLs medidas por las pruebas de contrato en `sdk/test/sandbox/sandbox-env.ts`.
 * - production: URLs tomadas de la documentación oficial de cada pasarela (nivel de evidencia: sin medir).
 * - simulator: la API de Simulación local (`http://localhost:3000/v1/sim/<pasarela>`). El despliegue
 *   en Render se usa con `baseUrl`, porque el valor por defecto no debe sacar peticiones de la máquina.
 */
export const GATEWAY_URL_CATALOG: Readonly<Record<Environment, Readonly<Record<Gateway, string>>>> = {
  [Environment.SANDBOX]: {
    [Gateway.WOMPI]: "https://sandbox.wompi.co/v1",
    [Gateway.MERCADOPAGO]: "https://api.mercadopago.com/v1",
    [Gateway.RAPYD]: "https://sandboxapi.rapyd.net/v1",
    [Gateway.KUSHKI]: "https://api-uat.kushkipagos.com",
  },
  [Environment.PRODUCTION]: {
    [Gateway.WOMPI]: "https://production.wompi.co/v1",
    [Gateway.MERCADOPAGO]: "https://api.mercadopago.com/v1",
    [Gateway.RAPYD]: "https://api.rapyd.net/v1",
    [Gateway.KUSHKI]: "https://api.kushkipagos.com",
  },
  [Environment.SIMULATOR]: {
    [Gateway.WOMPI]: "http://localhost:3000/v1/sim/wompi",
    [Gateway.MERCADOPAGO]: "http://localhost:3000/v1/sim/mercadopago",
    [Gateway.RAPYD]: "http://localhost:3000/v1/sim/rapyd",
    [Gateway.KUSHKI]: "http://localhost:3000/v1/sim/kushki",
  },
};

/**
 * Resuelve la URL base oficial desde el catálogo cerrado para la pasarela y ambiente indicados.
 */
export function resolveGatewayCatalogUrl(gateway: Gateway, env: Environment): string {
  return GATEWAY_URL_CATALOG[env][gateway];
}
