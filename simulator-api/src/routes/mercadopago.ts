import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/mercadopago/GatewayMockFactory";
import { MercadoPagoCreatePaymentRequestBody } from "../gateways/mercadopago/types";

const SCENARIO_HEADER = "x-simulate-scenario";
export const DEFAULT_SCENARIO = "APPROVED";

/**
 * Router HTTP de Mercado Pago (API de Simulación).
 *
 * Expone:
 * 1. POST /v1/sim/mercadopago/payments: simula la creación de un pago (status 201).
 * 2. GET /v1/sim/mercadopago/payments/:id: simula la consulta del estado de un pago (status 200).
 *
 * Particularidades de Mercado Pago:
 * - El monto se procesa en pesos (`transaction_amount`).
 * - Los estados son en minúsculas (`approved`, `rejected`, `pending`).
 * - Respuesta JSON plana sin envoltorio `data`.
 */
export async function mercadopagoRoutes(app: FastifyInstance): Promise<void> {
  const mockFactory = new GatewayMockFactory();

  // 1. Creación de pago (POST /v1/sim/mercadopago/payments)
  app.post(
    "/v1/sim/mercadopago/payments",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = Array.isArray(scenarioHeader)
        ? scenarioHeader[0]
        : (scenarioHeader ?? DEFAULT_SCENARIO);

      const requestBody = request.body as MercadoPagoCreatePaymentRequestBody;

      if (scenario === DEFAULT_SCENARIO || scenario.toUpperCase() === "APPROVED") {
        const response = mockFactory.buildApprovedResponse(requestBody);
        return reply.code(201).send(response);
      }

      if (scenario.toUpperCase() === "REJECTED" || scenario.toUpperCase() === "DECLINED") {
        const response = mockFactory.buildRejectedResponse(requestBody);
        return reply.code(201).send(response);
      }

      return reply.code(501).send({ error: `Escenario aún no soportado: ${scenario}` });
    },
  );

  // 2. Consulta de pago (GET /v1/sim/mercadopago/payments/:id)
  app.get(
    "/v1/sim/mercadopago/payments/:id",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = Array.isArray(scenarioHeader)
        ? scenarioHeader[0]
        : (scenarioHeader ?? DEFAULT_SCENARIO);

      if (scenario.toUpperCase() === "NOT_FOUND") {
        return reply.code(404).send({
          message: "Payment not found",
          error: "not_found",
          status: 404,
        });
      }

      if (scenario.toUpperCase() === "REJECTED" || scenario.toUpperCase() === "DECLINED") {
        const response = mockFactory.buildRejectedResponse(
          {
            transaction_amount: 50000,
            description: `Consulta de pago ${id}`,
            payer: { email: "customer@example.com" },
          },
          id,
        );
        return reply.code(200).send(response);
      }

      // Por defecto retorna aprobado reflejando el id consultado
      const response = mockFactory.buildApprovedResponse(
        {
          transaction_amount: 50000,
          description: `Consulta de pago ${id}`,
          payer: { email: "customer@example.com" },
        },
        id,
      );
      return reply.code(200).send(response);
    },
  );
}