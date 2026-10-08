import Fastify, { FastifyInstance } from "fastify";
import { KitPagosError } from "kit-pagos-colombia";
import { healthRoute } from "./routes/health";
import { wompiRoutes } from "./routes/wompi";
import { mercadopagoRoutes } from "./routes/mercadopago";
import { rapydRoutes } from "./routes/rapyd";
import { kushkiRoutes } from "./routes/kushki";
import { createAuthHook, AuthHookOptions } from "./auth/authHook";
import {
  ClientCredentialsRequiredError,
  CredentialResolver,
  loadServerEnv,
  MissingCredentialsError,
} from "./auth/CredentialResolver";
import { webhookTriggerRoute } from "./routes/webhooks";
import { startAutoEmission } from "./webhooks/autoEmission";
import { SignatureGenerator } from "./webhooks/SignatureGenerator";
import {
  WebhookDispatchConfig,
  WebhookDispatcher,
  webhookConfigFromEnv,
} from "./webhooks/webhookDispatch";
import { KitPagosProvider } from "./services/KitPagosProvider";
import { kitPagosApi } from "./kit-pagos-api";
import { toKitPagosErrorResponse } from "./kit-pagos-api/errors/kitPagosErrorResponse";
import { parsePublicOrigin } from "./store/BankRedirectOrigins";

declare module "fastify" {
  interface FastifyInstance {
    credentialResolver: CredentialResolver;
    kitPagosProvider: KitPagosProvider;
    /** `SIMULATOR_PUBLIC_ORIGIN` ya validado, o `undefined` si no está configurado. */
    publicOrigin: string | undefined;
  }
}

export interface BuildAppOptions {
  logger?: boolean | Record<string, unknown>;
  authOptions?: AuthHookOptions;
  credentialResolver?: CredentialResolver;
  kitPagosProvider?: KitPagosProvider;
  /**
   * Salida de webhooks. Sin esta opción se lee de `SIMULATOR_WEBHOOK_*`; con ella, lo que
   * traiga reemplaza esos valores, y `{}` es «sin destino ni emisión automática».
   */
  webhooks?: Partial<WebhookDispatchConfig>;
  /** Reemplaza `SIMULATOR_PUBLIC_ORIGIN`; `null` es «sin origen configurado». */
  publicOrigin?: string | null;
}

function webhookConfig(override?: Partial<WebhookDispatchConfig>): WebhookDispatchConfig {
  const fromEnv = webhookConfigFromEnv(override === undefined ? loadServerEnv() : {});
  return { ...fromEnv, ...override };
}

/**
 * Construye y configura la instancia de Fastify de la API de Simulacion,
 * sin ponerla a escuchar en ningun puerto.
 *
 * Se separa deliberadamente de `listen()` (ver server.ts) para que las
 * pruebas puedan usar `app.inject()` sobre la misma app real que corre en
 * produccion, sin necesidad de abrir un socket de red.
 */
export function buildApp(options?: BuildAppOptions): FastifyInstance {
  const loggerConfig = options?.logger ?? false;
  // Antes de crear la app: un destino o un origen inválido detiene el arranque.
  const dispatcher = new WebhookDispatcher(webhookConfig(options?.webhooks));
  const publicOrigin = parsePublicOrigin(
    options?.publicOrigin === undefined
      ? loadServerEnv().SIMULATOR_PUBLIC_ORIGIN
      : options.publicOrigin ?? undefined,
  );

  const app = Fastify({
    logger: loggerConfig,
  });

  const credentialResolver =
    options?.credentialResolver ?? new CredentialResolver();
  const kitPagosProvider =
    options?.kitPagosProvider ?? new KitPagosProvider(credentialResolver);

  app.decorate("credentialResolver", credentialResolver);
  app.decorate("kitPagosProvider", kitPagosProvider);
  app.decorate("publicOrigin", publicOrigin);

  // Hook de autenticación Bearer de la API REST
  app.addHook("onRequest", createAuthHook(options?.authOptions));

  // Manejador centralizado de errores: credenciales faltantes y errores del SDK
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof MissingCredentialsError || error instanceof ClientCredentialsRequiredError) {
      reply.status(401).send({
        error: "Unauthorized",
        message: error.message,
      });
      return;
    }

    if (error instanceof KitPagosError) {
      const { statusCode, body } = toKitPagosErrorResponse(error);
      request.log.warn({ code: error.code, gateway: error.gateway }, error.message);
      reply.status(statusCode).send(body);
      return;
    }

    reply.send(error);
  });

  app.register(healthRoute);
  app.register(wompiRoutes);
  app.register(mercadopagoRoutes);
  app.register(rapydRoutes);
  app.register(kushkiRoutes);

  const generator = new SignatureGenerator((gateway) => credentialResolver.getServerCredentials(gateway));
  app.register(webhookTriggerRoute, { generator, dispatcher });
  const stopAutoEmission = startAutoEmission(generator, dispatcher, app.log);
  app.addHook("onClose", async () => stopAutoEmission());

  app.register(kitPagosApi, { prefix: "/v1/api" });

  return app;
}

