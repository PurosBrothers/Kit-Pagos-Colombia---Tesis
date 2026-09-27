import cors from "@fastify/cors";
import { FastifyInstance } from "fastify";
import { CREDENTIAL_WARNING_HEADER } from "../services/KitPagosProvider";
import { attachCredentialWarnings, logCredentialPolicy } from "./gateway-client";
import { gatewaysRoute } from "./routes/gateways";
import { webhooksRoute } from "./routes/webhooks";

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
  // Sin `exposedHeaders` el navegador esconde la advertencia del respaldo en sandbox
  // al JavaScript del frontend, aunque viaje en la respuesta (punto 68).
  await app.register(cors, { exposedHeaders: [CREDENTIAL_WARNING_HEADER] });
  attachCredentialWarnings(app);
  logCredentialPolicy(app);
  app.register(gatewaysRoute);
  app.register(webhooksRoute);
}
