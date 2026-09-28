import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Gateway, KitPagos } from "kit-pagos-colombia";
import { classifyTarget, TargetEnvironment } from "../auth/targetEnvironment";
import { CREDENTIAL_WARNING_HEADER } from "../services/KitPagosProvider";

/** Código de la advertencia en el cuerpo, para que un cliente la detecte sin leer el texto. */
export const SERVER_SANDBOX_CREDENTIALS_WARNING = "SERVER_SANDBOX_CREDENTIALS_USED";

/** Advertencia que viaja en el campo `warnings` del cuerpo de la respuesta. */
export interface ResponseWarning {
  code: string;
  message: string;
}

const warningsByRequest = new WeakMap<FastifyRequest, ResponseWarning[]>();

/**
 * El `KitPagos` que tiene que usar una ruta que llama a la pasarela.
 *
 * Es la única puerta que deberían usar las rutas de cobro, consulta y bancos: aplica
 * la regla de credenciales según el destino y, si la petición cayó a las credenciales
 * de sandbox del servidor, deja la advertencia en la cabecera, en el cuerpo y en el
 * log. Una ruta que llame a `resolveClient()` directamente la perdería (puntos 69 y 70).
 */
export function gatewayClientFor(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  gateway: Gateway,
): KitPagos {
  const client = app.kitPagosProvider.resolveClient(gateway, request.headers);

  if (client.warning) {
    reply.header(CREDENTIAL_WARNING_HEADER, client.warning);
    warningsByRequest.set(request, [
      ...(warningsByRequest.get(request) ?? []),
      { code: SERVER_SANDBOX_CREDENTIALS_WARNING, message: client.warning },
    ]);
    request.log.warn({ gateway, target: client.target }, "Server sandbox credentials used");
  }

  return client.kitPagos;
}

/**
 * Agrega `warnings` al cuerpo JSON de las respuestas que usaron el respaldo, también
 * a las de error: una llamada al sandbox que falla es justo cuando el desarrollador
 * más necesita saber con qué cuenta se hizo. Aplica a las rutas del contexto donde
 * se registra.
 */
export function attachCredentialWarnings(app: FastifyInstance): void {
  app.addHook("preSerialization", async (request, _reply, payload) => {
    const warnings = warningsByRequest.get(request);
    if (!warnings || !isPlainObject(payload)) {
      return payload;
    }
    return { ...payload, warnings };
  });
}

const POLICY_BY_TARGET: Record<TargetEnvironment, string> = {
  simulator: "Local simulator: server credentials allowed",
  sandbox: "Real sandbox: server credentials allowed with a warning on every response",
  production: "Production: server credentials never used, every request must bring its own",
};

/** Deja en el log de arranque a dónde apunta cada pasarela y qué credenciales admite. */
export function logCredentialPolicy(app: FastifyInstance): void {
  for (const gateway of Object.values(Gateway)) {
    const target = classifyTarget(gateway, app.kitPagosProvider.resolveBaseUrl(gateway));
    const log = target === "simulator" ? app.log.info.bind(app.log) : app.log.warn.bind(app.log);
    log({ gateway: gateway.toLowerCase(), target }, POLICY_BY_TARGET[target]);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
