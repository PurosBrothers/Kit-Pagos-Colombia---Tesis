import cors from "@fastify/cors";
import { FastifyInstance } from "fastify";
import { gatewaysRoute } from "./routes/gateways";

/**
 * Modulo REST que expone las capacidades del SDK bajo `/v1/api`.
 *
 * Vive separado de `src/routes/` y `src/gateways/` porque son responsabilidades
 * opuestas que comparten despliegue: `/v1/sim` finge ser un tercero y `/v1/api`
 * expone lo propio. Este modulo no reimplementa reglas del SDK; solo traduce
 * HTTP a llamadas de la fachada `KitPagos`.
 *
 * CORS se registra aqui dentro, y no en `buildApp()`, para que solo aplique a
 * `/v1/api`: las rutas de simulacion las consume el SDK desde un backend y deben
 * responder exactamente igual que antes (ver el punto 64 del architecture-log.md).
 */
export async function kitPagosApi(app: FastifyInstance): Promise<void> {
  await app.register(cors);
  app.register(gatewaysRoute);
}
