import { randomUUID } from "node:crypto";
import {
  KushkiChargeResponse,
  KushkiCreateChargeRequestBody,
  KushkiTransactionStatus,
} from "./types";

/**
 * Gateway Mock Factory — Kushki (API de Simulación).
 *
 * Responsabilidad única: construir el payload de respuesta que replica la
 * estructura nativa de Kushki para un escenario dado. No decide qué
 * escenario ejecutar (eso es responsabilidad de la ruta) y no valida el
 * body de la solicitud.
 *
 * A diferencia de Wompi, esta respuesta refleja el mismo objeto `amount`
 * descompuesto que llegó en la solicitud: Kushki no lo colapsa a un
 * escalar en ningún punto del ciclo de vida de la transacción.
 */
export class GatewayMockFactory {
  private buildResponse(
    requestBody: KushkiCreateChargeRequestBody,
    status: KushkiTransactionStatus,
  ): KushkiChargeResponse {
    return {
      ticketNumber: randomUUID().replace(/-/g, "").slice(0, 18),
      transaction_status: status,
      amount: requestBody.amount,
      transactionReference: randomUUID(),
    };
  }

  buildApprovedResponse(
    requestBody: KushkiCreateChargeRequestBody,
  ): KushkiChargeResponse {
    return this.buildResponse(requestBody, "APPROVAL");
  }

  /**
   * Construye una respuesta de rechazo. Deliberadamente con el mismo shape
   * y el mismo código HTTP que una aprobada: es el escenario que da valor
   * a la prueba, porque un adaptador que decide éxito mirando el status
   * HTTP en vez del cuerpo va a reportar este rechazo como aprobado.
   */
  buildDeclinedResponse(
    requestBody: KushkiCreateChargeRequestBody,
  ): KushkiChargeResponse {
    return this.buildResponse(requestBody, "DECLINED");
  }

  buildInitializedResponse(
    requestBody: KushkiCreateChargeRequestBody,
  ): KushkiChargeResponse {
    return this.buildResponse(requestBody, "INITIALIZED");
  }
}