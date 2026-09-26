import Fastify, { FastifyInstance } from "fastify";
import { healthRoute } from "./routes/health";
import { wompiRoutes } from "./routes/wompi";
import { mercadopagoRoutes } from "./routes/mercadopago";
import { rapydRoutes } from "./routes/rapyd";
import { kushkiRoutes } from "./routes/kushki";
import { createAuthHook, AuthHookOptions } from "./auth/authHook";
import { CredentialResolver, MissingCredentialsError } from "./auth/CredentialResolver";
import { KitPagosProvider } from "./services/KitPagosProvider";
import { fastifyLoggerConfig } from "./logger/redactSerializer";

declare module "fastify" {
  interface FastifyInstance {
    credentialResolver: CredentialResolver;
    kitPagosProvider: KitPagosProvider;
  }
}

export interface BuildAppOptions {
  logger?: boolean | Record<string, unknown>;
  authOptions?: AuthHookOptions;
  credentialResolver?: CredentialResolver;
  kitPagosProvider?: KitPagosProvider;
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
  const loggerConfig =
    options?.logger !== undefined ? options.logger : fastifyLoggerConfig;

  const app = Fastify({
    logger: loggerConfig,
  });

  const credentialResolver =
    options?.credentialResolver ?? new CredentialResolver();
  const kitPagosProvider =
    options?.kitPagosProvider ?? new KitPagosProvider(credentialResolver);

  app.decorate("credentialResolver", credentialResolver);
  app.decorate("kitPagosProvider", kitPagosProvider);

  // Hook de autenticación Bearer de la API REST
  app.addHook("onRequest", createAuthHook(options?.authOptions));

  // Manejador centralizado de errores para credenciales faltantes
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MissingCredentialsError) {
      reply.status(401).send({
        error: "Unauthorized",
        message: error.message,
      });
      return;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name: string }).name === "MissingCredentialsError"
    ) {
      const err = error as { message?: string };
      reply.status(401).send({
        error: "Unauthorized",
        message: err.message ?? "Missing credentials for requested gateway",
      });
      return;
    }

    reply.send(error);
  });

  app.register(healthRoute);
  app.register(wompiRoutes);
  app.register(mercadopagoRoutes);
  app.register(rapydRoutes);
  app.register(kushkiRoutes);

  return app;
}

