import {
  MercadoPagoCreateOrderRequestBody,
  MercadoPagoCreatePaymentRequestBody,
  MercadoPagoOrderResponse,
  MercadoPagoOrderStatus,
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

  /**
   * Construye la respuesta de un pago expirado.
   */
  buildExpiredResponse(
    requestBody: MercadoPagoCreatePaymentRequestBody,
    customId?: number | string,
  ): MercadoPagoPaymentResponse {
    const now = new Date().toISOString();

    return {
      id: customId ?? this.generateId(),
      status: "cancelled",
      status_detail: "expired",
      transaction_amount: requestBody.transaction_amount,
      currency_id: "COP",
      description: requestBody.description,
      external_reference: requestBody.external_reference ?? requestBody.description,
      payer: requestBody.payer,
      date_created: now,
      date_approved: null,
    };
  }

  /**
   * Respuesta nativa de timeout para Mercado Pago (HTTP 504).
   */
  buildTimeoutResponse() {
    return {
      message: "Gateway Timeout",
      error: "gateway_timeout",
      status: 504,
    };
  }

  /**
   * Respuesta nativa de rate limit para Mercado Pago (HTTP 429).
   */
  buildRateLimitResponse() {
    return {
      message: "Too many requests",
      error: "rate_limit_exceeded",
      status: 429,
    };
  }

  /**
   * Respuesta nativa de error de servidor para Mercado Pago (HTTP 5xx).
   */
  buildServerErrorResponse(status = 500) {
    return {
      message: "Internal Server Error",
      error: "server_error",
      status,
    };
  }

  /**
   * Identificador de orden al estilo de la Orders API: un ULID con prefijo.
   *
   * El prefijo no es decorativo. El SDK distingue por él a qué endpoint
   * consultar, porque los pagos con tarjeta usan identificadores numéricos y las
   * órdenes de PSE no (ver `isOrderId()` en el SDK).
   */
  private generateOrderId(prefix: "ORD" | "PAY"): string {
    const suffix = Math.random().toString(36).slice(2, 12).toUpperCase();
    return `${prefix}01${suffix}`;
  }

  /**
   * Construye la respuesta de una orden de PSE esperando al pagador.
   *
   * Reproduce el caso que la API real devuelve con HTTP 201: `action_required` /
   * `waiting_transfer` y la URL del banco ya presente en la creación. A
   * diferencia de Wompi, acá no hay nada que sondear (ver el punto 43 del
   * `architecture-log.md` para la comparación).
   */
  buildPendingOrderResponse(
    requestBody: MercadoPagoCreateOrderRequestBody,
    customId?: string,
  ): MercadoPagoOrderResponse {
    const paymentId = this.generateOrderId("PAY");
    const requested = requestBody.transactions?.payments?.[0];

    return this.buildOrder(requestBody, {
      orderId: customId ?? this.generateOrderId("ORD"),
      paymentId,
      status: "action_required",
      statusDetail: "waiting_transfer",
      // El identificador del pago va en la URL porque es lo que hace la pasarela
      // real, y así el ejemplo muestra una URL distinta por pago.
      redirectUrl: `https://www.mercadopago.com.co/payments/${paymentId}/bank_transfer`,
      financialInstitution: requested?.payment_method?.financial_institution,
    });
  }

  /**
   * Construye la respuesta de una orden ya pagada, que es lo que la pasarela
   * devuelve cuando el pagador completó la transferencia en el banco.
   *
   * No lleva `redirect_url`: la orden ya no espera a nadie. Es el estado que el
   * comercio debería ver al consultar después de que el pagador vuelve.
   */
  buildProcessedOrderResponse(
    requestBody: MercadoPagoCreateOrderRequestBody,
    customId?: string,
  ): MercadoPagoOrderResponse {
    return this.buildOrder(requestBody, {
      orderId: customId ?? this.generateOrderId("ORD"),
      paymentId: this.generateOrderId("PAY"),
      status: "processed",
      statusDetail: "accredited",
      financialInstitution:
        requestBody.transactions?.payments?.[0]?.payment_method?.financial_institution,
    });
  }

  /**
   * Parte común de las dos respuestas de orden.
   *
   * Existe para que los campos que la API real devuelve igual en los dos casos
   * (montos, divisa, país, fechas, eco de la URL de retorno) se escriban una sola
   * vez y no se desincronicen entre escenarios.
   */
  private buildOrder(
    requestBody: MercadoPagoCreateOrderRequestBody,
    attributes: {
      orderId: string;
      paymentId: string;
      status: MercadoPagoOrderStatus;
      statusDetail: string;
      redirectUrl?: string;
      financialInstitution?: string;
    },
  ): MercadoPagoOrderResponse {
    const now = new Date().toISOString();
    const total = requestBody.total_amount;

    return {
      id: attributes.orderId,
      type: requestBody.type ?? "online",
      processing_mode: requestBody.processing_mode ?? "automatic",
      external_reference: requestBody.external_reference,
      total_amount: total,
      total_paid_amount: total,
      country_code: "COL",
      status: attributes.status,
      status_detail: attributes.statusDetail,
      currency: "COP",
      created_date: now,
      last_updated_date: now,
      payer: { entity_type: requestBody.payer?.entity_type },
      config: requestBody.config,
      transactions: {
        payments: [
          {
            id: attributes.paymentId,
            amount: total,
            reference_id: Math.random().toString(36).slice(2, 12),
            status: attributes.status,
            status_detail: attributes.statusDetail,
            payment_method: {
              id: "pse",
              type: "bank_transfer",
              redirect_url: attributes.redirectUrl,
              financial_institution: attributes.financialInstitution,
            },
          },
        ],
      },
    };
  }
}
