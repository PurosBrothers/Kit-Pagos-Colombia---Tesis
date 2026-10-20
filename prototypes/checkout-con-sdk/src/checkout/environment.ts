/**
 * El ambiente contra el que cobra el checkout. Es del esqueleto común y no nombra ninguna
 * pasarela: cada módulo de pagos lo traduce a sus URLs (punto 111 del `architecture-log.md`).
 *
 * - `sandbox`, por omisión: el sandbox oficial de la pasarela, como `npm start` en el
 *   prototipo C (punto 104).
 * - `simulator`: la API de Simulación en `CHECKOUT_SIMULATOR_URL`, que por omisión es la de
 *   Render. `npm run start:local` la apunta a `http://localhost:3000`.
 */
export type CheckoutEnvironment = "sandbox" | "simulator";

export interface PaymentsEnvironment {
  environment: CheckoutEnvironment;
  /** El origen de la API de Simulación, sin barra final. Solo cuenta con `simulator`. */
  simulatorUrl: string;
}

export const RENDER_SIMULATOR_URL = "https://kit-pagos-colombia.onrender.com";

export function paymentsEnvironment(env: NodeJS.ProcessEnv = process.env): PaymentsEnvironment {
  const environment = env.CHECKOUT_ENVIRONMENT?.trim() || "sandbox";
  if (environment !== "sandbox" && environment !== "simulator") {
    throw new Error(`CHECKOUT_ENVIRONMENT tiene que ser sandbox o simulator, no «${environment}».`);
  }
  const simulatorUrl = (env.CHECKOUT_SIMULATOR_URL?.trim() || RENDER_SIMULATOR_URL).replace(/\/+$/, "");
  return { environment, simulatorUrl };
}
