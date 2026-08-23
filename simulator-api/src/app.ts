import Fastify, { FastifyInstance } from "fastify";
import { healthRoute } from "./routes/health";

/**
 * Construye y configura la instancia de Fastify de la API de Simulacion,
 * sin ponerla a escuchar en ningun puerto.
 *
 * Se separa deliberadamente de `listen()` (ver server.ts) para que las
 * pruebas puedan usar `app.inject()` sobre la misma app real que corre en
 * produccion, sin necesidad de abrir un socket de red.
 *
 * A medida que se implementen los componentes descritos en
 * docs/architecture/layers-and-components.md (HTTPRouter, ScenarioEngine,
 * etc.), sus plugins se registran aqui, no en server.ts.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify();

  app.register(healthRoute);

  return app;
}
