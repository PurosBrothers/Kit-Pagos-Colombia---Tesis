import { FastifyInstance } from "fastify";

/**
 * Endpoint minimo de salud (GET /health).
 *
 * No forma parte de las rutas de simulacion descritas en
 * docs/architecture/layers-and-components.md (esas dependen del modelo de
 * dominio de la API de Simulacion, todavia pendiente). Existe unicamente
 * como el primer caso real y trivial contra el cual demostrar que el arnes
 * de pruebas (Jest + app.inject()) funciona de punta a punta.
 *
 * Registrado como plugin de Fastify para seguir el mismo patron que va a
 * usar el futuro HTTPRouter.
 */
export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return { status: "ok" };
  });
}
