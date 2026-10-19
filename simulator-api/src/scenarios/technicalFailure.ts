import { FastifyReply, FastifyRequest } from "fastify";
import { loadServerEnv } from "../auth/CredentialResolver";
import { ScenarioEngine } from "./ScenarioEngine";
import { QueryFailure } from "./scenarioFromRequest";
import { nextFlappingAttempt, queryFailureFor } from "../store/ScenarioMarks";

/**
 * Los cuerpos de error nativos de una pasarela. Cada `GatewayMockFactory` ya los tiene; la
 * falla técnica es la misma en las cuatro y lo que cambia es el cuerpo.
 */
export interface NativeErrorBodies {
  buildTimeoutResponse(): unknown;
  buildRateLimitResponse(): unknown;
  buildServerErrorResponse(status: number): unknown;
}

/** Lo que tarda `SLOW` por omisión: más que un límite de 30 s del lado del cliente. */
export const DEFAULT_SLOW_RESPONSE_MS = 35000;

/**
 * Cuánto espera `SLOW` antes de responder, leído de `SIMULATOR_SLOW_RESPONSE_MS`.
 *
 * Sale de `loadServerEnv()`, igual que `SIMULATOR_WEBHOOK_*`: el `.env` de la raíz con
 * `process.env` encima. Antes leía solo `process.env`, y el valor puesto en el `.env` no
 * tenía efecto. Se lee en cada petición y no al arrancar para que una prueba pueda
 * acortarlo sin reconstruir la app. Un valor que no es un entero positivo cae al de omisión.
 */
export function slowResponseDelayMs(
  env: Record<string, string | undefined> = loadServerEnv(),
): number {
  const configured = Number(env.SIMULATOR_SLOW_RESPONSE_MS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_SLOW_RESPONSE_MS;
}

/**
 * Nivel 3 — convención del simulador: espera y después responde el 504 nativo.
 *
 * El temporizador va con `unref()` para que un cliente que cortó por su propio límite no
 * deje el proceso vivo esperando una respuesta que nadie va a leer.
 */
async function slow(reply: FastifyReply, bodies: NativeErrorBodies): Promise<FastifyReply> {
  await new Promise<void>((resolve) => setTimeout(resolve, slowResponseDelayMs()).unref());
  return reply.code(504).send(bodies.buildTimeoutResponse());
}

/**
 * Nivel 3 — convención del simulador, sin equivalente medido: un 200 cuyo cuerpo no es JSON.
 * Es lo que hace fallar `response.json()` en los cuatro adaptadores del SDK.
 */
const INVALID_JSON = '{"data": ';

/**
 * Nivel 3 — convención del simulador, aprobada por Joan el 6 de octubre de 2026: la página
 * que devuelve un proxy delante de la pasarela cuando esta no contesta. No imita a ninguna
 * pasarela; prueba que el SDK no supone JSON en un error.
 */
const HTML_ERROR_PAGE =
  "<html><head><title>502 Bad Gateway</title></head>" +
  "<body><center><h1>502 Bad Gateway</h1></center></body></html>";

/**
 * Contesta la falla técnica que pide el escenario, o `undefined` si no pide ninguna.
 *
 * Reemplaza las cuatro copias que tenían las rutas de Kushki, Mercado Pago y Rapyd y las
 * dos que Wompi tenía escritas en línea (issue #122). Ninguna rama guarda nada: una falla de
 * transporte no crea ni muta estado.
 *
 * @param malformedBody El cuerpo de `MALFORMED_BODY`: un 200 con la forma nativa pero sin los
 *   campos que el normalizador del SDK necesita. Nivel 3, convención del simulador.
 */
export async function technicalFailure(
  scenario: string,
  request: FastifyRequest,
  reply: FastifyReply,
  bodies: NativeErrorBodies,
  malformedBody: unknown = {},
): Promise<FastifyReply | undefined> {
  switch (scenario) {
    case "TIMEOUT":
    case "GATEWAY_TIMEOUT":
      return reply.code(504).send(bodies.buildTimeoutResponse());
    case "NETWORK_ERROR":
    case "CONNECTION_ERROR":
      return ScenarioEngine.handleNetworkError(request, reply);
    case "RATE_LIMIT":
    case "TOO_MANY_REQUESTS":
    case "429":
      return reply.code(429).send(bodies.buildRateLimitResponse());
    case "SERVER_ERROR":
    case "INTERNAL_ERROR":
    case "500":
      return reply.code(500).send(bodies.buildServerErrorResponse(500));
    case "BAD_GATEWAY":
    case "502":
      return reply.code(502).send(bodies.buildServerErrorResponse(502));
    case "SERVICE_UNAVAILABLE":
    case "503":
      return reply.code(503).send(bodies.buildServerErrorResponse(503));
    case "SLOW":
      return slow(reply, bodies);
    case "MALFORMED_JSON":
      return reply.code(200).header("content-type", "application/json").send(INVALID_JSON);
    case "MALFORMED_BODY":
      return reply.code(200).send(malformedBody);
    case "HTML_ERROR":
      return reply.code(502).header("content-type", "text/html; charset=utf-8").send(HTML_ERROR_PAGE);
    default:
      return undefined;
  }
}

/**
 * Aplica la falla que la creación registró para las consultas de este cobro (issue #122).
 *
 * La consulta es la operación que el SDK reintenta, así que es donde una falla transitoria
 * se puede ver recuperarse: `QUERY_FLAPPING` falla dos veces y deja pasar la tercera, que
 * es lo que `RetryHandler` necesita para terminar bien. El contador es el mismo de
 * `FLAPPING` (`nextFlappingAttempt`) y vuelve a cero al recuperarse, así que cada llamada a
 * `getPaymentStatus()` muestra su propio reintento.
 */
export async function queryFailure(
  target: { gateway: string; resource: string; id: string },
  reply: FastifyReply,
  bodies: NativeErrorBodies,
): Promise<FastifyReply | undefined> {
  const failure: QueryFailure | undefined = queryFailureFor(
    target.gateway,
    target.resource,
    target.id,
  );

  switch (failure) {
    case "QUERY_SERVER_ERROR":
      return reply.code(500).send(bodies.buildServerErrorResponse(500));
    case "QUERY_FLAPPING":
      return nextFlappingAttempt(`query:${target.gateway}:${target.resource}:${target.id}`)
        ? reply.code(503).send(bodies.buildServerErrorResponse(503))
        : undefined;
    case "QUERY_SLOW":
      return slow(reply, bodies);
    default:
      return undefined;
  }
}

/** Las cabeceras donde el SDK manda la credencial de cada pasarela al pedir los bancos. */
const CREDENTIAL_HEADERS = [
  "authorization",
  "access_key",
  "public-merchant-id",
  "private-merchant-id",
] as const;

function credentialOf(request: FastifyRequest): string {
  return CREDENTIAL_HEADERS.map((header) => request.headers[header])
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

/**
 * Falla la lista de bancos de PSE si la credencial trae una marca (issue #122).
 *
 * La lista no tiene monto ni datos de prueba, y la credencial es lo único que el comercio
 * controla en esa llamada. Nivel 3, convención del simulador: `sim_flapping` falla dos
 * veces y se recupera, `sim_server_error` responde 500 siempre.
 */
export function bankListFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  bodies: NativeErrorBodies,
  route: string,
): FastifyReply | undefined {
  const credential = credentialOf(request);

  if (credential.includes("sim_server_error")) {
    return reply.code(500).send(bodies.buildServerErrorResponse(500));
  }

  if (credential.includes("sim_flapping") && nextFlappingAttempt(`banks:${route}:${credential}`)) {
    return reply.code(503).send(bodies.buildServerErrorResponse(503));
  }

  return undefined;
}
