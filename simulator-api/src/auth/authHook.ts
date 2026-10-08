import { FastifyRequest, FastifyReply } from "fastify";
import * as crypto from "crypto";
import { loadServerEnv } from "./CredentialResolver";

export interface AuthHookOptions {
  expectedToken?: string;
  exemptPaths?: string[];
  /** Prefijos que exigen el token aunque estén dentro de uno exento. */
  protectedPaths?: string[];
  logger?: { warn: (msg: string) => void };
}

/**
 * `/v1/sim` queda exento porque el SDK le habla sin el token de la API. El trigger de webhooks
 * no: devuelve el webhook firmado con los secretos del servidor, y abierto sería un oráculo de
 * firma (decisión de Joan, 6 de octubre de 2026).
 */
const DEFAULT_EXEMPT_PATHS = ["/health", "/v1/sim"];
const DEFAULT_PROTECTED_PATHS = ["/v1/sim/webhooks"];

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/**
 * La ruta sobre la que se decide la exención.
 *
 * Es la ruta registrada que Fastify encontró (`/v1/sim/webhooks/trigger`), no la URL que
 * llegó: Fastify decodifica `%77ebhooks` y resuelve `/wompi/../`, y una URL así enrutaba al
 * trigger sin empezar por `/v1/sim/webhooks`. Sin ruta encontrada (un 404) se usa la URL
 * normalizada —decodificada, en minúsculas, sin barras repetidas ni la final—, que solo puede
 * decidir quién recibe el 404.
 */
function pathForDecision(request: FastifyRequest): string {
  const routed = request.routeOptions?.url;
  if (routed !== undefined) {
    return routed;
  }
  const raw = request.url.split("?")[0];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Una secuencia `%` inválida se evalúa tal cual llegó.
  }
  return decoded.toLowerCase().replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
}

/**
 * Compara dos cadenas en tiempo constante utilizando crypto.timingSafeEqual
 * para evitar vulnerabilidades de fuga de información por análisis de tiempos (timing attacks).
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    // Para mitigar análisis de temporización por diferencia de longitud,
    // se ejecuta la operación contra el mismo buffer antes de descartar
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Hook de autenticación onRequest para Fastify.
 *
 * - Si API_AUTH_TOKEN no está definido: opera abierto en modo desarrollo local y emite advertencia en el log.
 * - Si API_AUTH_TOKEN está definido: exige cabecera 'Authorization: Bearer <token>' con validación en tiempo constante.
 * - Rutas exentas (como /health) quedan excluidas de la autenticación.
 */
export function createAuthHook(options?: AuthHookOptions) {
  const env = loadServerEnv();
  const token =
    options?.expectedToken ??
    (env.API_AUTH_TOKEN?.trim() ||
      env.SIMULATOR_API_AUTH_TOKEN?.trim() ||
      undefined);

  const exemptPaths = options?.exemptPaths ?? DEFAULT_EXEMPT_PATHS;
  const protectedPaths = options?.protectedPaths ?? DEFAULT_PROTECTED_PATHS;

  if (!token) {
    if (options?.logger) {
      options.logger.warn(
        "API_AUTH_TOKEN no está definido. La API REST está operando en modo abierto (desarrollo local).",
      );
    } else if (process.env.NODE_ENV !== "test") {
      console.warn(
        "API_AUTH_TOKEN no está definido. La API REST está operando en modo abierto (desarrollo local).",
      );
    }
  }

  return async function authHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Si la ruta está en la lista de excepciones, y no en la de protegidas, permitir libre acceso
    const path = pathForDecision(request);
    const isExempt =
      exemptPaths.some((prefix) => underPrefix(path, prefix)) &&
      !protectedPaths.some((prefix) => underPrefix(path, prefix));
    if (isExempt) {
      return;
    }

    // El navegador envía el preflight de CORS sin Authorization, antes de la
    // petición real; exigir el token aquí bloquearía a cualquier frontend.
    if (
      request.method === "OPTIONS" &&
      request.headers["access-control-request-method"] !== undefined
    ) {
      return;
    }

    // Si no hay token configurado, opera en modo abierto
    if (!token) {
      return;
    }

    // Si hay token configurado, exigir cabecera Authorization: Bearer <token>
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      reply.status(401).send({
        error: "Unauthorized",
        message: "Missing or malformed Authorization header. Expected 'Bearer <token>'.",
      });
      return reply;
    }

    const providedToken = authHeader.slice("Bearer ".length).trim();
    const isValid = timingSafeCompare(providedToken, token);

    if (!isValid) {
      reply.status(401).send({
        error: "Unauthorized",
        message: "Invalid authorization token.",
      });
      return reply;
    }
  };
}
