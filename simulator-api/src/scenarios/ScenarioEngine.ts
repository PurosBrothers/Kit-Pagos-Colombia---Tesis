import { FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory as WompiMockFactory } from "../gateways/wompi/GatewayMockFactory";
import {
  WompiCreateTransactionRequestBody,
  WompiTransactionResponse,
} from "../gateways/wompi/types";
import { DEFAULT_SCENARIO, headerScenario } from "./scenarioFromRequest";

export { DEFAULT_SCENARIO, SCENARIO_HEADERS } from "./scenarioFromRequest";

/**
 * Escenarios estandarizados soportados por la API de Simulación (issues #65 y #122).
 *
 * `SLOW`, `MALFORMED_JSON`, `MALFORMED_BODY` y `HTML_ERROR` son fallas técnicas
 * (`technicalFailure.ts`).
 * `PENDING_THEN_DECLINED` no se pide por nombre en la práctica: es lo que deriva la tarjeta
 * de prueba `4111 1111 1111 1111` de Wompi.
 */
export enum SimulatorScenario {
  APPROVED = "APPROVED",
  APPROVAL = "APPROVAL",
  PENDING = "PENDING",
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
  SLOW = "SLOW",
  MALFORMED_JSON = "MALFORMED_JSON",
  MALFORMED_BODY = "MALFORMED_BODY",
  HTML_ERROR = "HTML_ERROR",
  PENDING_THEN_DECLINED = "PENDING_THEN_DECLINED",
}

/**
 * El escenario de la cabecera, o `APPROVED` si no vino ninguna.
 *
 * Solo para las rutas que no crean un cobro (tokenización). Las de creación usan
 * `resolveScenario()`, que además mira los datos de prueba y el monto.
 */
export function getSimulatorScenario(request: FastifyRequest): string {
  return headerScenario(request) ?? DEFAULT_SCENARIO;
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
      // `PENDING` construye lo mismo que el aprobado porque en Wompi los dos nacen
      // pendientes. La diferencia la pone el destino que registra la ruta, no la creación.
      case "APPROVED":
      case "APPROVAL":
      case "PENDING":
      case "PENDING_THEN_DECLINED":
        if (requestBody.payment_method?.type === "PSE") {
          return this.wompiMockFactory.buildPendingPseResponse(requestBody);
        }
        return this.wompiMockFactory.buildApprovedResponse(requestBody);

      // Un PSE nace `PENDING` sin URL pase lo que pase (medido el 18 de septiembre de 2026);
      // el rechazo lo registra la ruta y lo cierra la primera consulta, con la URL.
      case "DECLINED":
      case "REJECTED":
        if (requestBody.payment_method?.type === "PSE") {
          return this.wompiMockFactory.buildPendingPseResponse(requestBody);
        }
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
