import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/kushki/GatewayMockFactory";
import { KushkiCreateChargeRequestBody } from "../gateways/kushki/types";

const SCENARIO_HEADER = "x-simulate-scenario";
const DEFAULT_SCENARIO = "APPROVED";

/**
 * Router HTTP de Kushki (API de Simulación).
 *
 * Expone:
 * 1. POST /v1/sim/kushki/charges: simula la creación de un cargo con
 *    tarjeta, replicando POST /card/v1/charges de Kushki.
 * 2. GET /v1/sim/kushki/charges/:ticketNumber: simula la consulta de
 *    estado por ticketNumber.
 *
 * Punto crítico de esta ruta, explícito en el issue: SIEMPRE responde
 * HTTP 200, incluso cuando el escenario es un rechazo. La decisión
 * de éxito o fallo vive únicamente en el campo transaction_status del
 * cuerpo, nunca en el código HTTP — es justo el comportamiento que rompe
 * un adaptador que decide mirando response.ok.
 */
export async function kushkiRoutes(app: FastifyInstance): Promise<void> {
  const mockFactory = new GatewayMockFactory();

  app.post(
    "/v1/sim/kushki/charges",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = (
        Array.isArray(scenarioHeader)
          ? scenarioHeader[0]
          : (scenarioHeader ?? DEFAULT_SCENARIO)
      ).toUpperCase();

      const requestBody = request.body as KushkiCreateChargeRequestBody;

      if (scenario === "DECLINED" || scenario === "REJECTED") {
        // HTTP 200, no 4xx: Kushki nunca usa el status HTTP para señalar
        // un rechazo de negocio.
        return reply
          .code(200)
          .send(mockFactory.buildDeclinedResponse(requestBody));
      }

      if (scenario === "INITIALIZED" || scenario === "PENDING") {
        return reply
          .code(200)
          .send(mockFactory.buildInitializedResponse(requestBody));
      }

      if (scenario === "APPROVED" || scenario === "APPROVAL") {
        return reply
          .code(200)
          .send(mockFactory.buildApprovedResponse(requestBody));
      }

      return reply
        .code(501)
        .send({ error: `Escenario aún no soportado: ${scenario}` });
    },
  );

  app.get(
    "/v1/sim/kushki/charges/:ticketNumber",
    async (
      request: FastifyRequest<{ Params: { ticketNumber: string } }>,
      reply: FastifyReply,
    ) => {
      const { ticketNumber } = request.params;
      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = (
        Array.isArray(scenarioHeader)
          ? scenarioHeader[0]
          : (scenarioHeader ?? DEFAULT_SCENARIO)
      ).toUpperCase();

      const placeholderRequest: KushkiCreateChargeRequestBody = {
        token: "query-only",
        amount: {
          subtotalIva0: 50000,
          subtotalIva: 0,
          iva: 0,
          ice: 0,
          currency: "COP",
        },
      };

      const response =
        scenario === "DECLINED" || scenario === "REJECTED"
          ? mockFactory.buildDeclinedResponse(placeholderRequest)
          : mockFactory.buildApprovedResponse(placeholderRequest);

      response.ticketNumber = ticketNumber;
      return reply.code(200).send(response);
    },
  );
}
