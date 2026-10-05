import { Gateway } from "../../domain/value-objects/Gateway";
import { Environment } from "../../domain/value-objects/Environment";

/**
 * Catálogo cerrado de URLs base por pasarela y ambiente.
 *
 * - sandbox: URLs medidas por las pruebas de contrato en `sdk/test/sandbox/sandbox-env.ts`.
 * - production: URLs tomadas de la documentación oficial de cada pasarela (nivel de evidencia: sin medir).
 * - simulator: URLs por defecto hacia el simulador desplegado en Render (`https://kit-pagos-colombia.onrender.com/v1/sim/<pasarela>`).
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
    [Gateway.WOMPI]: "https://kit-pagos-colombia.onrender.com/v1/sim/wompi",
    [Gateway.MERCADOPAGO]: "https://kit-pagos-colombia.onrender.com/v1/sim/mercadopago",
    [Gateway.RAPYD]: "https://kit-pagos-colombia.onrender.com/v1/sim/rapyd",
    [Gateway.KUSHKI]: "https://kit-pagos-colombia.onrender.com/v1/sim/kushki",
  },
};

/**
 * Resuelve la URL base oficial desde el catálogo cerrado para la pasarela y ambiente indicados.
 */
export function resolveGatewayCatalogUrl(gateway: Gateway, env: Environment): string {
  return GATEWAY_URL_CATALOG[env][gateway];
}
