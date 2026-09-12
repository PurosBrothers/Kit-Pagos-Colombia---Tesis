/**
 * Contratos del mock de Mercado Pago (API de Simulación).
 *
 * Representan la estructura nativa que expone la API de Mercado Pago (/v1/payments).
 *
 * Particularidades frente a Wompi:
 * 1. El monto viaja en `transaction_amount` en pesos (unidad mayor con decimales),
 *    no en centavos.
 * 2. Los estados van en minúsculas nativas (`approved`, `pending`, `in_process`,
 *    `rejected`, `cancelled`). Se conservan en minúsculas para auditoría y no se
 *    fuerzan a mayúsculas.
 * 3. La respuesta de Mercado Pago es un objeto JSON plano en la raíz (no viene
 *    envuelto en `data: { ... }` como en Wompi).
 * 4. La notificación de webhook solo envía el identificador en `data.id` (notificación
 *    de dos pasos).
 */

/** Datos del pagador según el esquema de Mercado Pago. */
export interface MercadoPagoPayer {
  email: string;
  first_name?: string;
  last_name?: string;
  identification?: {
    type?: string;
    number?: string;
  };
}

/** Cuerpo de la solicitud para crear un pago (POST /v1/payments). */
export interface MercadoPagoCreatePaymentRequestBody {
  transaction_amount: number;
  description?: string;
  external_reference?: string;
  payment_method_id?: string;
  payer: MercadoPagoPayer;
}

/** Estados nativos de transacción de Mercado Pago en minúsculas. */
export type MercadoPagoPaymentStatus =
  | "approved"
  | "pending"
  | "in_process"
  | "rejected"
  | "cancelled";

/** Respuesta nativa devuelta por Mercado Pago (POST /v1/payments y GET /v1/payments/:id). */
export interface MercadoPagoPaymentResponse {
  id: number | string;
  status: MercadoPagoPaymentStatus;
  status_detail?: string;
  transaction_amount: number;
  currency_id: string;
  description?: string;
  external_reference?: string;
  payer: MercadoPagoPayer;
  date_created?: string;
  date_approved?: string | null;
}

/** Formato nativo de la notificación webhook de dos pasos de Mercado Pago. */
export interface MercadoPagoWebhookNotification {
  action?: string;
  type?: string;
  data: {
    id: string | number;
  };
  date_created?: string;
  user_id?: string | number;
}
