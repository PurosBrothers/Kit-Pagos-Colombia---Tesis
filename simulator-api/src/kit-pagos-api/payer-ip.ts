import { FastifyRequest } from "fastify";

/**
 * Lee `SIMULATOR_TRUST_FORWARDED_FOR`. Solo `"true"` la activa: sin un proxy delante que escriba
 * la cabecera, cualquier cliente pondría en `X-Forwarded-For` la IP que quisiera.
 */
export function parseTrustForwardedFor(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/**
 * La IP del pagador cuando el cuerpo del cobro no la trae (punto 92 del `architecture-log.md`).
 *
 * Por omisión es la del socket. Con `trustForwardedFor`, la primera de `X-Forwarded-For`, que es
 * donde Render deja la del cliente: su tráfico pasa por Cloudflare y por sus balanceadores
 * (https://render.com/articles/how-render-handles-ddos-attacks, consultada el 13 de octubre de
 * 2026). No se activa el `trustProxy` de Fastify porque cambiaría también `request.protocol` y
 * `request.host`, de los que sale `requestOrigin()` (punto 84).
 */
export function payerIpOf(request: FastifyRequest, trustForwardedFor: boolean): string {
  if (trustForwardedFor) {
    const forwarded = firstForwardedAddress(request.headers["x-forwarded-for"]);
    if (forwarded) {
      return forwarded;
    }
  }
  return request.ip;
}

function firstForwardedAddress(header: string | string[] | undefined): string | undefined {
  const joined = Array.isArray(header) ? header.join(",") : header;
  return joined?.split(",")[0]?.trim() || undefined;
}
