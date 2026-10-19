import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Los secretos con los que el simulador verifica las firmas de Wompi y de Rapyd.
 *
 * El simulador se comporta como una sola cuenta de comercio por pasarela (punto 86 del
 * `architecture-log.md`): verifica la firma de integridad de Wompi y la firma de cada petición
 * de Rapyd con el secreto de su perfil, que lee del `.env` de la raíz del repositorio y del
 * entorno. Si no tiene perfil, usa un valor por omisión publicado en `examples/README.md`.
 *
 * Este módulo resuelve los mismos valores con las mismas reglas, para que los ejemplos firmen
 * con el secreto que el simulador espera:
 *
 * - Wompi: `WOMPI_INTEGRITY_SECRET`, si también están `WOMPI_PUBLIC_KEY` y `WOMPI_PRIVATE_KEY`
 *   (el simulador no arma el perfil sin las dos llaves).
 * - Rapyd: `RAPYD_API_SECRET_KEY`, si también está `RAPYD_API_ACCESS_KEY`.
 *
 * Contra un simulador desplegado en otra máquina, exporte en la terminal los secretos de ese
 * despliegue: el entorno gana sobre el `.env`.
 */

/** El valor de `DEFAULT_WOMPI_INTEGRITY_SECRET` en `simulator-api/src/auth/merchantSecrets.ts`. */
export const SIMULATOR_DEFAULT_WOMPI_INTEGRITY_SECRET = "test_integrity_kit_pagos_simulator";

/** El valor de `DEFAULT_RAPYD_SECRET_KEY` en `simulator-api/src/auth/merchantSecrets.ts`. */
export const SIMULATOR_DEFAULT_RAPYD_SECRET_KEY = "rapyd_secret_kit_pagos_simulator";

/** El `.env` de la raíz, con el mismo criterio que `loadServerEnv()` del simulador. */
function rootEnv(): Record<string, string | undefined> {
  const entries: Record<string, string> = {};
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const separator = trimmed.indexOf("=");
      const key = trimmed.slice(0, separator).trim();
      if (key) entries[key] = trimmed.slice(separator + 1).trim();
    }
  }
  return { ...entries, ...process.env };
}

function present(env: Record<string, string | undefined>, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

const env = rootEnv();

/** El secreto de integridad de Wompi que el simulador espera. */
export const WOMPI_INTEGRITY_SECRET =
  (present(env, "WOMPI_PUBLIC_KEY") && present(env, "WOMPI_PRIVATE_KEY")
    ? present(env, "WOMPI_INTEGRITY_SECRET")
    : undefined) ?? SIMULATOR_DEFAULT_WOMPI_INTEGRITY_SECRET;

/** La `secret_key` de Rapyd que el simulador espera. */
export const RAPYD_SECRET_KEY =
  (present(env, "RAPYD_API_ACCESS_KEY") ? present(env, "RAPYD_API_SECRET_KEY") : undefined) ??
  SIMULATOR_DEFAULT_RAPYD_SECRET_KEY;
