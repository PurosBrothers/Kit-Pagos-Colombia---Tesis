import { randomUUID } from "node:crypto";
import {
  WompiCreateTransactionRequestBody,
  WompiTransactionResponse,
} from "./types";

/**
 * Gateway Mock Factory — Wompi (alcance mínimo, issue #27).
 *
 * Responsabilidad única: construir el payload de respuesta que replica la
 * estructura nativa de Wompi para un escenario dado. No conoce headers, no
 * decide qué escenario ejecutar (eso es responsabilidad del ScenarioEngine)
 * y no valida el body de la solicitud (eso es responsabilidad del router).
 *
 * La Iteración 3 ampliará este archivo con los demás escenarios
 * (RECHAZADO, FONDOS_INSUFICIENTES) y con las fábricas del resto de
 * pasarelas, tal como lo describe layers-and-components.md. Este issue
 * solo cubre APROBADO.
 */
export class GatewayMockFactory {
  /**
   * Construye la respuesta de una transacción aprobada, con la misma forma
   * que retornaría la API real de Wompi: el objeto `transaction` envuelto
   * en `data`, con un `id` generado y reflejando el monto, la referencia y el
   * correo del pagador recibidos en la solicitud original.
   */
  buildApprovedResponse(
    requestBody: WompiCreateTransactionRequestBody,
  ): WompiTransactionResponse {
    return {
      data: {
        id: randomUUID(),
        status: "APPROVED",
        amount_in_cents: requestBody.amount_in_cents,
        currency: requestBody.currency,
        reference: requestBody.reference,
        customer_email: requestBody.customer_email,
      },
    };
  }
}