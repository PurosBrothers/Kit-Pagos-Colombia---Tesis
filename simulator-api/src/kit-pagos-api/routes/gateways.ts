import { FastifyInstance } from "fastify";
import { Gateway } from "kit-pagos-colombia";

/**
 * GET /v1/api/gateways: pasarelas que el SDK soporta.
 *
 * Es la prueba de vida del montaje del modulo: no depende de credenciales ni de
 * ningun endpoint de negocio. La lista sale del enum del SDK y no se repite
 * aqui, para que una pasarela nueva aparezca sin tocar el simulador. Se devuelve
 * en minusculas porque es la forma en que viaja en las rutas (`/:gateway`).
 */
export async function gatewaysRoute(app: FastifyInstance): Promise<void> {
  app.get("/gateways", async () => {
    return {
      gateways: Object.values(Gateway).map((gateway) => gateway.toLowerCase()),
    };
  });
}
