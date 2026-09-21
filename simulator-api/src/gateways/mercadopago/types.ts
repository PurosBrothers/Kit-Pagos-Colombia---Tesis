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
  /**
   * Mercado Pago **deduce el método de pago del token**, así que el comercio no manda
   * `payment_method_id` en un cobro con tarjeta: se midió que mandar el token sin ese campo
   * responde `201`, y que omitir el token responde
   * `400 "payment_method_id attribute can't be null"`.
   */
  token?: string;
  /** Obligatorio incluso cuando son una: sin él responde `400 "Invalid installments"`. */
  installments?: number;
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

/**
 * Contratos de la Orders API (`/v1/orders`), que es por donde se cobra PSE.
 *
 * No es una variante del cuerpo de `/v1/payments`: es otra API, con otro
 * vocabulario de estados y con los montos como **string sin decimales**. Todo lo
 * que sigue reproduce la forma que devolvió la API real el 18 de septiembre de
 * 2026; el detalle de lo medido está en `sdk/src/infrastructure/adapters/mercadopago-pse.ts`.
 */

/** Cuerpo de la solicitud para crear una orden (POST /v1/orders). */
export interface MercadoPagoCreateOrderRequestBody {
  type?: string;
  total_amount: string;
  external_reference?: string;
  processing_mode?: string;
  payer: MercadoPagoPayer & {
    entity_type?: string;
    phone?: { area_code?: string; number?: string };
    address?: Record<string, string>;
  };
  transactions: {
    payments: Array<{
      amount: string;
      payment_method: {
        id: string;
        type: string;
        financial_institution?: string;
      };
    }>;
  };
  additional_info?: Record<string, unknown>;
  config?: { online?: { callback_url?: string } };
}

/**
 * Estados nativos de una orden.
 *
 * `action_required` es el que importa para PSE: la orden existe y espera que el
 * pagador vuelva del banco. Convive con `processed` (pagada) y `failed`.
 */
export type MercadoPagoOrderStatus =
  | "created"
  | "processing"
  | "action_required"
  | "processed"
  | "canceled"
  | "failed"
  | "expired";

/** Respuesta nativa de la Orders API (POST /v1/orders y GET /v1/orders/:id). */
export interface MercadoPagoOrderResponse {
  id: string;
  type: string;
  processing_mode: string;
  external_reference?: string;
  /** String sin decimales: la API real rechaza `"2000.00"` con HTTP 400. */
  total_amount: string;
  total_paid_amount: string;
  country_code: string;
  status: MercadoPagoOrderStatus;
  status_detail: string;
  currency: string;
  created_date: string;
  last_updated_date: string;
  /** La API real solo devuelve `entity_type` acá; no repite el email del pagador. */
  payer: { entity_type?: string };
  config?: { online?: { callback_url?: string } };
  transactions: {
    payments: Array<{
      id: string;
      amount: string;
      reference_id: string;
      status: MercadoPagoOrderStatus;
      status_detail: string;
      payment_method: {
        id: string;
        type: string;
        redirect_url?: string;
        financial_institution?: string;
      };
    }>;
  };
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
