export interface CheckoutConfig {
  port: number;
  /** El origen público del checkout: con él se arman la URL de retorno y la de webhooks. */
  publicBaseUrl: string;
}

const DEFAULT_PORT = 4000;

/** Lee `PORT` y `PUBLIC_BASE_URL` del entorno. La configuración de la pasarela es del módulo de pagos. */
export function loadCheckoutConfig(env: NodeJS.ProcessEnv = process.env): CheckoutConfig {
  const parsedPort = Number(env.PORT);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
  const publicBaseUrl = (env.PUBLIC_BASE_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, "");
  return { port, publicBaseUrl };
}
