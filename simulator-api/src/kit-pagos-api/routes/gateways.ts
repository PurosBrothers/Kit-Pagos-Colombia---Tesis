import { FastifyInstance } from "fastify";
import { SUPPORTED_GATEWAYS } from "../gateway-param";

/**
 * GET /v1/api/gateways: pasarelas que el SDK soporta.
 *
 * Es la prueba de vida del montaje del modulo: no depende de credenciales ni de
 * ningun endpoint de negocio.
 */
export async function gatewaysRoute(app: FastifyInstance): Promise<void> {
  app.get("/gateways", async () => {
    return { gateways: SUPPORTED_GATEWAYS };
  });
}
