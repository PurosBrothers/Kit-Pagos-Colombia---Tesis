import { FastifyRequest, FastifyReply } from "fastify";
import * as crypto from "crypto";
import { loadServerEnv } from "./CredentialResolver";

export interface AuthHookOptions {
  expectedToken?: string;
  exemptPaths?: string[];
  logger?: { warn: (msg: string) => void };
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
    env.API_AUTH_TOKEN?.trim() ??
    env.SIMULATOR_API_AUTH_TOKEN?.trim();

  const exemptPaths = options?.exemptPaths ?? ["/health", "/v1/sim"];
  let warningLogged = false;

  return async function authHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Si la ruta está en la lista de excepciones, permitir libre acceso
    const urlPath = request.url.split("?")[0];
    const isExempt = exemptPaths.some(
      (prefix) =>
        urlPath === prefix ||
        urlPath.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
    );
    if (isExempt) {
      return;
    }

    // Si no hay token configurado, opera en modo abierto y advierte
    if (!token) {
      if (!warningLogged) {
        warningLogged = true;
        const logger = options?.logger ?? request.log;
        logger.warn(
          "API_AUTH_TOKEN no está definido. La API REST está operando en modo abierto (desarrollo local).",
        );
      }
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
