import {
  MercadoPagoCreatePaymentRequestBody,
  MercadoPagoPaymentResponse,
} from "./types";

/**
 * Gateway Mock Factory — Mercado Pago (API de Simulación).
 *
 * Responsabilidad única: construir el payload de respuesta que replica la
 * estructura nativa de Mercado Pago (/v1/payments) para los escenarios soportados.
 *
 * Particularidades nativas de Mercado Pago:
 * - Estados en minúsculas (`approved`, `rejected`, etc.).
 * - Monto en pesos decimales (`transaction_amount`), no en centavos.
 * - Objeto plano sin envoltorio `data`.
 * - `status_detail` con el código nativo de acreditación o rechazo.
 */
export class GatewayMockFactory {
  /**
   * Genera un identificador numérico aleatorio al estilo de Mercado Pago (ej. 1234567890).
   */
  private generateId(): number {
    return Math.floor(1000000000 + Math.random() * 9000000000);
  }

  /**
   * Construye la respuesta de un pago aprobado (POST o GET).
   */
  buildApprovedResponse(
    requestBody: MercadoPagoCreatePaymentRequestBody,
    customId?: number | string,
  ): MercadoPagoPaymentResponse {
    const now = new Date().toISOString();

    return {
      id: customId ?? this.generateId(),
      status: "approved",
      status_detail: "accredited",
      transaction_amount: requestBody.transaction_amount,
      currency_id: "COP",
      description: requestBody.description,
      external_reference: requestBody.external_reference ?? requestBody.description,
      payer: requestBody.payer,
      date_created: now,
      date_approved: now,
    };
  }

  /**
   * Construye la respuesta de un pago rechazado.
   */
  buildRejectedResponse(
    requestBody: MercadoPagoCreatePaymentRequestBody,
    customId?: number | string,
  ): MercadoPagoPaymentResponse {
    const now = new Date().toISOString();

    return {
      id: customId ?? this.generateId(),
      status: "rejected",
      status_detail: "cc_rejected_other_reason",
      transaction_amount: requestBody.transaction_amount,
      currency_id: "COP",
      description: requestBody.description,
      external_reference: requestBody.external_reference ?? requestBody.description,
      payer: requestBody.payer,
      date_created: now,
      date_approved: null,
    };
  }
}
