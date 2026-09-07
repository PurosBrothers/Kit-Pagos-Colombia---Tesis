import { GatewayMockFactory } from "../gateways/wompi/GatewayMockFactory";
import {
  WompiCreateTransactionRequestBody,
  WompiTransactionResponse,
} from "../gateways/wompi/types";

/** Escenario por defecto cuando el header `x-simulate-scenario` no fue enviado. */
export const DEFAULT_SCENARIO = "APPROVED";

/**
 * Error explícito lanzado cuando se solicita un escenario que el motor
 * todavía no sabe producir. Existe para que el router pueda distinguirlo
 * de cualquier otro error inesperado y traducirlo a un HTTP 501, en vez de
 * dejar que Fastify responda con un 500 genérico o, peor, un APROBADO falso.
 */
export class UnsupportedScenarioError extends Error {
  constructor(scenario: string) {
    super(`Escenario aún no soportado: ${scenario}`);
    this.name = "UnsupportedScenarioError";
  }
}

/**
 * Scenario Execution Engine (alcance mínimo, issue #27).
 *
 * Responsabilidad: recibir el escenario solicitado (vía header) y decidir
 * qué resultado producir. En este alcance mínimo el único escenario que
 * sabe resolver es APPROVED, delegando la construcción del payload al
 * GatewayMockFactory de Wompi. Cualquier otro valor se rechaza de forma
 * explícita mediante UnsupportedScenarioError.
 *
 * La Iteración 3 extenderá este método para soportar RECHAZADO,
 * FONDOS_INSUFICIENTES, TIMEOUT y ERROR_RED (RF-10), y para recibir la
 * pasarela como parámetro en vez de asumir siempre Wompi.
 */
export class ScenarioEngine {
  constructor(
    private readonly wompiMockFactory: GatewayMockFactory = new GatewayMockFactory(),
  ) {}

  execute(
    scenario: string,
    requestBody: WompiCreateTransactionRequestBody,
  ): WompiTransactionResponse {
    if (scenario === DEFAULT_SCENARIO) {
      return this.wompiMockFactory.buildApprovedResponse(requestBody);
    }

    throw new UnsupportedScenarioError(scenario);
  }
}