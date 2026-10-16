import { loadServerEnv } from "./auth/CredentialResolver";

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";

/**
 * El puerto de la API: en el que escucha (`server.ts`) y el de las URL que arma hacia sí misma
 * sin `SIMULATOR_SDK_BASE_URL` (`KitPagosProvider`, `BankRedirectOrigins`). Los tres lo leen de
 * aquí y de `loadServerEnv()`, como las demás variables, para que nunca difieran.
 *
 * Sin valor, 3000. Un valor que no es un entero entre 1 y 65535 lanza un error, y en el arranque
 * lo detiene: `Number("")` es 0, y con 0 Fastify escucharía en un puerto al azar.
 */
export function serverPort(env: Record<string, string | undefined> = loadServerEnv()): number {
  const raw = env.PORT?.trim();
  if (!raw) {
    return DEFAULT_PORT;
  }
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 1 && port <= 65535)) {
    throw new Error(`PORT debe ser un entero entre 1 y 65535, y vale "${raw}".`);
  }
  return port;
}

/** El puerto y la interfaz en los que escucha `server.ts`. `HOST` sin valor es `0.0.0.0`. */
export function listenAddress(env: Record<string, string | undefined> = loadServerEnv()): {
  port: number;
  host: string;
} {
  return { port: serverPort(env), host: env.HOST?.trim() || DEFAULT_HOST };
}
