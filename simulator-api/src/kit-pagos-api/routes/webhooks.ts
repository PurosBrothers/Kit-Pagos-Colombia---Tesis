import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Gateway, KitPagosError, KitPagosErrorCode, WebhookEvent } from "kit-pagos-colombia";
import { loadServerEnv } from "../../auth/CredentialResolver";
import { SENSITIVE_HEADERS } from "../../logger/redactSerializer";
import { parseGateway, unsupportedGatewayBody } from "../gateway-param";

/**
 * Respuesta única para todo webhook rechazado. Firma falsificada, cuerpo
 * malformado, marca de tiempo vencida y secreto sin configurar responden lo
 * mismo, para no decirle a quien envía la petición por qué falló (puntos 22 y
 * 36.6 del architecture-log.md; ver el punto 65).
 */
const REJECTED_WEBHOOK_BODY = {
  code: KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID,
  message: "Invalid webhook signature",
};

/**
 * `INVALID_CREDENTIALS` es la configuración del servidor incompleta, por ejemplo Rapyd
 * sin `RAPYD_WEBHOOK_URL`: se rechaza igual que un secreto sin configurar.
 */
const REJECTION_CODES: readonly KitPagosErrorCode[] = [
  KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID,
  KitPagosErrorCode.MALFORMED_RESPONSE,
  KitPagosErrorCode.INVALID_CREDENTIALS,
];

interface WebhookParams {
  gateway: string;
}

/**
 * Lee la ventana de tolerancia contra reenvíos. Es configuración del servidor y
 * nunca de la petición: un cliente que pudiera ampliarla podría reproducir
 * notificaciones viejas. Sin valor válido se usa el del SDK (300 s).
 */
export function parseToleranceSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Cabeceras en minúsculas, como las espera el SDK, sin las de autorización ni
 * las de credenciales `x-gateway-*`: ninguna participa en la verificación.
 */
function toVerificationHeaders(headers: FastifyRequest["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (value === undefined || SENSITIVE_HEADERS.has(key)) {
      continue;
    }
    result[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

/**
 * Parámetros de la URL como cadenas. Un parámetro repetido se une con comas en vez de
 * elegir uno: así un `data.id` duplicado no coincide con el que firmó Mercado Pago.
 */
function toVerificationQuery(query: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries((query ?? {}) as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[name] = value;
    } else if (Array.isArray(value)) {
      result[name] = value.join(",");
    }
  }
  return result;
}

function toResponseBody(event: WebhookEvent) {
  return {
    gateway: event.gateway.toLowerCase(),
    eventType: event.eventType,
    gatewayTransactionId: event.gatewayTransactionId,
    newStatus: event.newStatus,
  };
}

/**
 * POST /v1/api/webhooks/:gateway: verifica una notificación de pasarela con
 * `KitPagos.validateWebhook()` y devuelve el evento normalizado.
 *
 * Las credenciales salen solo del perfil del servidor, nunca de las cabeceras
 * `x-gateway-*`: el SDK usa `webhookSecret ?? privateKey`, así que con una llave
 * privada del cliente y sin secreto en el servidor, quien envía el webhook
 * elegiría el secreto con que se lo verifica. Por lo mismo se exige un
 * `webhookSecret` configurado, sin caer a la llave privada (punto 65).
 */
export async function webhooksRoute(app: FastifyInstance): Promise<void> {
  const toleranceSeconds = parseToleranceSeconds(loadServerEnv().WEBHOOK_TOLERANCE_SECONDS);

  // Las firmas de Kushki y Rapyd se calculan sobre los bytes exactos del cuerpo:
  // reserializar el JSON parseado las rompe aunque se vea idéntico. Este parser
  // solo aplica a las rutas de este plugin.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );

  app.post<{ Params: WebhookParams; Body: string }>(
    "/webhooks/:gateway",
    async (request, reply) => {
      const gateway = parseGateway(request.params.gateway);
      if (!gateway) {
        return reply.status(400).send(unsupportedGatewayBody());
      }

      if (!app.credentialResolver.getServerCredentials(gateway)?.webhookSecret) {
        request.log.warn({ gateway }, "Webhook secret is not configured for this gateway");
        return rejectWebhook(reply);
      }

      return verifyWebhook(app, request, reply, gateway, toleranceSeconds);
    },
  );
}

function verifyWebhook(
  app: FastifyInstance,
  request: FastifyRequest<{ Body: string }>,
  reply: FastifyReply,
  gateway: Gateway,
  toleranceSeconds: number | undefined,
) {
  const kitPagos = app.kitPagosProvider.getWebhookVerifier(gateway);
  const payload = typeof request.body === "string" ? request.body : "";

  try {
    const event = kitPagos.validateWebhook(payload, toVerificationHeaders(request.headers), {
      gateway,
      toleranceSeconds,
      query: toVerificationQuery(request.query),
    });
    return reply.status(200).send(toResponseBody(event));
  } catch (error) {
    if (error instanceof KitPagosError && REJECTION_CODES.includes(error.code)) {
      request.log.warn({ gateway, code: error.code }, "Webhook rejected");
      return rejectWebhook(reply);
    }
    throw error;
  }
}

function rejectWebhook(reply: FastifyReply) {
  return reply.status(401).send(REJECTED_WEBHOOK_BODY);
}
