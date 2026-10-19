import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/**
 * Registra @fastify/swagger (especificación OpenAPI 3.0) y
 * @fastify/swagger-ui (interfaz interactiva en /docs).
 *
 * La especificación completa queda disponible en:
 *   GET /docs/json   — OpenAPI 3.0 en JSON
 *   GET /docs/yaml   — OpenAPI 3.0 en YAML
 *   GET /docs        — Interfaz interactiva Swagger UI
 */
async function registerOpenApiPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Kit Pagos Colombia — Simulator API",
        description:
          "API REST que expone el SDK Kit Pagos Colombia y simula las cuatro pasarelas de pago " +
          "(Wompi, Mercado Pago, Kushki y Rapyd) en un único servidor determinista.\n\n" +
          "## Autenticación\n\n" +
          "Todos los endpoints requieren `Authorization: Bearer <token>` donde el token es el " +
          "configurado en la variable de entorno `API_KEY` del servidor.\n\n" +
          "## Credenciales de pasarela\n\n" +
          "Los endpoints bajo `/v1/api` aceptan credenciales de pasarela opcionales mediante " +
          "cabeceras `x-gateway-*`. Si se omiten, el servidor usa las suyas propias, lo que " +
          "solo está permitido cuando el destino es el simulador local o un sandbox conocido. " +
          "Contra producción, las credenciales propias son obligatorias.\n\n" +
          "## Dos caras de la misma API\n\n" +
          "- **Kit Pagos** (`/v1/api`): endpoints de negocio que el SDK expone al comercio.\n" +
          "- **Simulación** (`/v1/sim`): endpoints que imitan la API nativa de cada pasarela, " +
          "usados por el SDK en pruebas sin conexión real.",
        version: "0.1.0",
        contact: {
          name: "Kit Pagos Colombia — Tesis PurosBrothers",
          url: "https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis",
        },
        license: {
          name: "Apache 2.0",
          url: "https://www.apache.org/licenses/LICENSE-2.0",
        },
      },
      tags: [
        {
          name: "Kit Pagos",
          description:
            "Operaciones de negocio del SDK: cobros, bancos PSE y verificación de webhooks. " +
            "Estas rutas son las que consumiría el frontend o backend de un comercio real.",
        },
        {
          name: "Simulación",
          description:
            "Endpoints que replican la API nativa de cada pasarela. Son usados internamente " +
            "por el SDK cuando la variable de entorno apunta al simulador. " +
            "No son parte de la interfaz pública del SDK.",
        },
        {
          name: "Diagnóstico",
          description: "Endpoints de infraestructura: health check y estado del servidor.",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description:
              "Token de API del servidor. Configúralo en la variable de entorno `API_KEY`. " +
              "No corresponde a ninguna clave de pasarela.",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    hideUntagged: false,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
    },
    staticCSP: true,
  });
}

export const registerOpenApi = fp(registerOpenApiPlugin);

