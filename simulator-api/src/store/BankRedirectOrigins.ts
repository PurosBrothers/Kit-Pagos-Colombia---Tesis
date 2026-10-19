import { FastifyRequest } from "fastify";
import { loadServerEnv } from "../auth/CredentialResolver";

/**
 * El origen (`protocolo://host`) de la petición que creó cada cobro con redirección al banco
 * (issue #122).
 *
 * La URL del banco de un PSE de Wompi aparece en una consulta, y la tabla que la arma no ve
 * ninguna petición. Antes el host estaba fijo en `http://localhost:3000`, así que el
 * simulador desplegado en Render publicaba una URL hacia la máquina de quien la abriera.
 *
 * Va al lado del registro y no dentro por la misma razón que `scenarioTarget.ts`: el
 * registro es la respuesta nativa de la pasarela, y un campo propio del simulador viajaría
 * en ella.
 */
const origins = new Map<string, string>();

function keyFor(gateway: string, id: string): string {
  return `${gateway}:${id}`;
}

/**
 * Valida `SIMULATOR_PUBLIC_ORIGIN` al arrancar y la reduce a `protocolo://host[:puerto]`.
 *
 * Existe porque detrás de un balanceador el protocolo de la petición no es el público: Render
 * termina TLS y reenvía por HTTP (https://render.com/docs/web-services, consultada el 7 de
 * octubre de 2026), y no documenta que mande `X-Forwarded-Proto`, así que `trustProxy` no
 * alcanza. Un valor inválido detiene el arranque, como `SIMULATOR_WEBHOOK_TARGET_URL`.
 */
export function parsePublicOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("SIMULATOR_PUBLIC_ORIGIN is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("SIMULATOR_PUBLIC_ORIGIN must use http or https.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("SIMULATOR_PUBLIC_ORIGIN must not carry credentials.");
  }
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("SIMULATOR_PUBLIC_ORIGIN must be an origin, without path, query or fragment.");
  }
  return parsed.origin;
}

/**
 * El origen público del simulador: `SIMULATOR_PUBLIC_ORIGIN` si está configurado y, si no, el
 * protocolo y la cabecera `Host` de la petición, que es lo correcto sin un proxy delante.
 */
export function requestOrigin(request: FastifyRequest): string {
  return request.server.publicOrigin ?? `${request.protocol}://${request.host}`;
}

/** Registra el origen de la petición que creó el cobro. Lo llama la ruta de creación. */
export function rememberBankRedirectOrigin(gateway: string, id: string, origin: string): void {
  origins.set(keyFor(gateway, id), origin);
}

/**
 * El origen registrado para el cobro o, si no hay ninguno, el del propio proceso, con el
 * mismo criterio que `KitPagosProvider` (`http://localhost:${PORT}`, 3000 sin `PORT`). Sin
 * registro solo queda un cobro que no pasó por la ruta de creación, como en las pruebas de
 * la tabla.
 */
export function bankRedirectOriginFor(gateway: string, id: string): string {
  return (
    origins.get(keyFor(gateway, id)) ??
    `http://localhost:${loadServerEnv().PORT?.trim() || "3000"}`
  );
}

/** Borra los orígenes registrados. Lo llama `resetSimulatorState()`. */
export function clearBankRedirectOrigins(): void {
  origins.clear();
}
