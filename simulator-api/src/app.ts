import Fastify, { FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
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
  MissingCredentialsError,
} from "./auth/CredentialResolver";
import { KitPagosProvider } from "./services/KitPagosProvider";
import { kitPagosApi } from "./kit-pagos-api";
import { toKitPagosErrorResponse } from "./kit-pagos-api/errors/kitPagosErrorResponse";

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
  const loggerConfig = options?.logger ?? false;

  const app = Fastify({
    logger: loggerConfig,
  });

  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Simulator API",
        version: "1.0.0",
        description: "API de simulación de pasarelas de pago para Kit Pagos Colombia",
      },
      servers: [{ url: "http://localhost:3000" }],
    },
  });

  app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });

  const credentialResolver =
    options?.credentialResolver ?? new CredentialResolver();
  const kitPagosProvider =
    options?.kitPagosProvider ?? new KitPagosProvider(credentialResolver);

  app.decorate("credentialResolver", credentialResolver);
  app.decorate("kitPagosProvider", kitPagosProvider);

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
  app.register(kitPagosApi, { prefix: "/v1/api" });

  return app;
}

