import { FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory as WompiMockFactory } from "../gateways/wompi/GatewayMockFactory";
import {
  WompiCreateTransactionRequestBody,
  WompiTransactionResponse,
} from "../gateways/wompi/types";

/** Cabeceras reconocidas para solicitar escenarios de simulación. */
export const SCENARIO_HEADERS = [
  "x-simulator-scenario",
  "x-simulate-scenario",
] as const;

/** Escenario por defecto cuando no se envía ninguna cabecera de control. */
export const DEFAULT_SCENARIO = "APPROVED";

/**
 * Escenarios estandarizados soportados por la API de Simulación (Issue #65).
 */
export enum SimulatorScenario {
  APPROVED = "APPROVED",
  APPROVAL = "APPROVAL",
  DECLINED = "DECLINED",
  REJECTED = "REJECTED",
  EXPIRED = "EXPIRED",
  TIMEOUT = "TIMEOUT",
  GATEWAY_TIMEOUT = "GATEWAY_TIMEOUT",
  NETWORK_ERROR = "NETWORK_ERROR",
  CONNECTION_ERROR = "CONNECTION_ERROR",
  RATE_LIMIT = "RATE_LIMIT",
  TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS",
  SERVER_ERROR = "SERVER_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  BAD_GATEWAY = "BAD_GATEWAY",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  FLAPPING = "FLAPPING",
  DUPLICATE_PAYMENT = "DUPLICATE_PAYMENT",
}

/**
 * Extrae y normaliza el escenario solicitado desde las cabeceras HTTP de Fastify.
 */
export function getSimulatorScenario(request: FastifyRequest): string {
  const headers = request.headers;
  const headerValue =
    headers["x-simulator-scenario"] ??
    headers["x-simulate-scenario"];

  if (!headerValue) {
    return DEFAULT_SCENARIO;
  }

  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return raw.trim().toUpperCase();
}

/**
 * Error explícito lanzado cuando se solicita un escenario que el motor
 * todavía no sabe producir.
 */
export class UnsupportedScenarioError extends Error {
  constructor(scenario: string) {
    super(`Escenario aún no soportado: ${scenario}`);
    this.name = "UnsupportedScenarioError";
  }
}

/**
 * Scenario Execution Engine (Issue #65).
 *
 * Responsabilidad: coordinar la ejecución de escenarios de simulación,
 * tanto de negocio (aprobaciones, rechazos, expiración) como técnicos
 * (timeouts, cortes de red, límites de tasa, errores 5xx, flapping).
 */
export class ScenarioEngine {
  constructor(
    private readonly wompiMockFactory: WompiMockFactory = new WompiMockFactory(),
  ) {}

  /**
   * Ejecuta el escenario solicitado para transacciones de Wompi.
   */
  execute(
    scenario: string,
    requestBody: WompiCreateTransactionRequestBody,
  ): WompiTransactionResponse {
    const normalized = scenario.trim().toUpperCase();

    switch (normalized) {
      case "APPROVED":
      case "APPROVAL":
        if (requestBody.payment_method?.type === "PSE") {
          return this.wompiMockFactory.buildPendingPseResponse(requestBody);
        }
        return this.wompiMockFactory.buildApprovedResponse(requestBody);

      case "DECLINED":
      case "REJECTED":
        return this.wompiMockFactory.buildDeclinedResponse(requestBody);

      case "EXPIRED":
        return this.wompiMockFactory.buildExpiredResponse(requestBody);

      default:
        throw new UnsupportedScenarioError(scenario);
    }
  }


  /**
   * Cierra abruptamente el socket TCP si está disponible (para simular NETWORK_ERROR)
   * o responde 500 con error de conexión simulado.
   */
  static handleNetworkError(request: FastifyRequest, reply: FastifyReply) {
    if (request.raw.socket && !request.raw.socket.destroyed) {
      request.raw.socket.destroy();
    }
    return reply.code(500).send({ error: "Simulated network connection reset (socket destroyed)" });
  }
}
