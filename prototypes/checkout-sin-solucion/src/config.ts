import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface CheckoutConfig {
  port: number;
  /** El origen público del checkout: con él se arman la URL de retorno y la de webhooks. */
  publicBaseUrl: string;
}

const DEFAULT_PORT = 4000;

/**
 * Lee `PORT` y `PUBLIC_BASE_URL` del entorno. La configuración de la pasarela es del módulo de pagos.
 * Por omisión el origen es `localtest.me`, un dominio público que resuelve a `127.0.0.1`: hay
 * pasarelas que rechazan una URL de retorno con `localhost`, y así el banco devuelve al comprador
 * a esta máquina sin un túnel.
 */
export function loadCheckoutConfig(env: NodeJS.ProcessEnv = process.env): CheckoutConfig {
  const parsedPort = Number(env.PORT);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
  const publicBaseUrl = (env.PUBLIC_BASE_URL?.trim() || `http://localtest.me:${port}`).replace(/\/+$/, "");
  return { port, publicBaseUrl };
}

/** Las opciones de la línea de comandos y la variable de entorno que cada una fija. */
const OPTIONS: Readonly<Record<string, string>> = {
  "--environment": "CHECKOUT_ENVIRONMENT",
  "--simulator-url": "CHECKOUT_SIMULATOR_URL",
  "--port": "PORT",
};

/**
 * Pasa `--environment=…`, `--simulator-url=…` y `--port=…` a sus variables de entorno, para que
 * `npm start -- --environment=simulator` funcione igual en bash, PowerShell y cmd. Un argumento
 * gana sobre su variable.
 */
export function applyArguments(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): void {
  for (const arg of argv) {
    const separator = arg.indexOf("=");
    const variable = separator > 0 ? OPTIONS[arg.slice(0, separator)] : undefined;
    if (!variable) {
      throw new Error(`Opción desconocida: «${arg}». Se aceptan ${Object.keys(OPTIONS).join(", ")}, con «=valor».`);
    }
    env[variable] = arg.slice(separator + 1);
  }
}

/** El `.env` de la raíz del repositorio, desde `src/` con ts-node o desde `dist/` compilado. */
export const ROOT_ENV_FILE = path.resolve(__dirname, "..", "..", "..", ".env");

/**
 * Lee el `.env` de la raíz, el mismo que usa la API de Simulación y con su mismo criterio: una
 * variable que ya está en el entorno gana sobre el archivo. Una línea vacía no se copia, para que
 * no tape el valor por omisión del módulo de pagos. El esqueleto no sabe qué llaves hay: las lee
 * el módulo. Devuelve si encontró el archivo.
 */
export function loadRootEnv(file: string = ROOT_ENV_FILE, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (value && env[key] === undefined) env[key] = value;
  }
  return true;
}
