import { FastifyRequest } from "fastify";

/**
 * Lee `SIMULATOR_TRUST_FORWARDED_FOR`. Solo `"true"` la activa: sin un proxy delante que escriba
 * la cabecera, cualquier cliente pondría en `X-Forwarded-For` la IP que quisiera.
 */
export function parseTrustForwardedFor(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * La misma IP, escrita como la acepta Mercado Pago, o `undefined` si viene en blanco.
 *
 * Medido el 15 de octubre de 2026 contra la API real, con un PSE por Orders: acepta `127.0.0.1`,
 * IPv4 privadas y públicas, una IPv6 completa (`2800:484:1a2b:3c00::20`) y `0:0:0:0:0:0:0:1`, y
 * rechaza con `400` `::1` («length must be >= 7»), `::ffff:127.0.0.1` («does not match pattern»)
 * y un valor con un espacio delante. Con `HOST=::`, Node entrega así la IP del socket (medido con
 * Node 22 el mismo día): `::ffff:a.b.c.d` para un cliente IPv4 y `::1` para el loopback IPv6; con
 * el `HOST` por omisión, `0.0.0.0`, llega como IPv4. Solo se reescriben esas dos formas, que son
 * la misma dirección; lo demás pasa sin validar, y nunca se pone una IP que no llegó.
 */
export function normalizePayerIp(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "::1") {
    return "127.0.0.1";
  }
  return IPV4_MAPPED.exec(trimmed)?.[1] ?? trimmed;
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
    const forwarded = normalizePayerIp(firstForwardedAddress(request.headers["x-forwarded-for"]));
    if (forwarded) {
      return forwarded;
    }
  }
  return normalizePayerIp(request.ip) ?? request.ip;
}

function firstForwardedAddress(header: string | string[] | undefined): string | undefined {
  const joined = Array.isArray(header) ? header.join(",") : header;
  return joined?.split(",")[0];
}
