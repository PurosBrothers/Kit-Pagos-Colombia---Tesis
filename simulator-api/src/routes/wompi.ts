import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEFAULT_SCENARIO,
  ScenarioEngine,
  UnsupportedScenarioError,
} from "../scenarios/ScenarioEngine";
import { WompiCreateTransactionRequestBody } from "../gateways/wompi/types";

const SCENARIO_HEADER = "x-simulate-scenario";

/**
 * Router HTTP de Wompi (alcance mínimo, RF-09 / RF-10, issue #27).
 *
 * Expone POST /v1/sim/wompi/transactions replicando el endpoint real de
 * creación de transacciones de Wompi. No contiene lógica de decisión de
 * escenario ni de construcción de payload: extrae el header de control y
 * el body, y delega todo el trabajo al ScenarioEngine.
 *
 * La Iteración 3 extenderá este archivo (o lo generalizará en un
 * HTTPRouter común) para cubrir el resto de pasarelas bajo el patrón
 * /v1/sim/{pasarela}/*, tal como lo describe layers-and-components.md.
 */
export async function wompiRoutes(app: FastifyInstance): Promise<void> {
  const scenarioEngine = new ScenarioEngine();

  app.post(
    "/v1/sim/wompi/transactions",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = Array.isArray(scenarioHeader)
        ? scenarioHeader[0]
        : (scenarioHeader ?? DEFAULT_SCENARIO);

      const requestBody = request.body as WompiCreateTransactionRequestBody;

      try {
        const response = scenarioEngine.execute(scenario, requestBody);
        return reply.code(201).send(response);
      } catch (error) {
        if (error instanceof UnsupportedScenarioError) {
          return reply.code(501).send({ error: error.message });
        }

        throw error;
      }
    },
  );
}