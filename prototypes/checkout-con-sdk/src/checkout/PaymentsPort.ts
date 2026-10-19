import { IncomingHttpHeaders } from "node:http";

/**
 * El contrato entre el esqueleto común y el módulo de pagos de cada prototipo.
 *
 * Es lo único que el esqueleto sabe de los pagos. El prototipo A lo implementa con `fetch`
 * contra la API nativa de la pasarela y el B con `kit-pagos-colombia`, cada uno en su
 * `src/payments/`. Las seis funciones del plan de evaluación (§2) quedan repartidas así:
 *
 * 1. Crear el pago: `createPayment`.
 * 2. Traducir el resultado a un estado del comercio: el `status` de cada respuesta.
 * 3. Distinguir un rechazo de negocio de un fallo técnico, y reintentar solo el segundo:
 *    un rechazo vuelve como `DECLINED`; un fallo técnico se reintenta dentro del módulo y,
 *    si persiste, sale como `PaymentTechnicalError`.
 * 4. Verificar la firma de un webhook: `verifyWebhook`. El esqueleto actualiza la orden.
 * 5. Consultar el estado por el identificador: `getPaymentStatus`.
 * 6. Registrar el estado nativo para auditoría: el `nativeStatus` de cada respuesta, que el
 *    esqueleto guarda en el historial de la orden.
 *
 * Este archivo es del esqueleto y no se toca desde los prototipos (punto 90 del
 * `architecture-log.md`).
 */

/** El estado de un pago visto por el comercio. */
export type MerchantPaymentStatus = "APPROVED" | "DECLINED" | "PENDING";

export type DocumentType = "CC" | "CE" | "NIT" | "PP";

export interface Payer {
  fullName: string;
  email: string;
  documentType: DocumentType;
  documentNumber: string;
  phone: string;
}

/** El medio de pago que eligió el pagador en la página. */
export type PaymentMethodRequest =
  | {
      type: "CARD";
      /** Lo produce `tokenizeCard()` de `src/payments/browser/client.js`, en el navegador. */
      cardToken: string;
      installments: number;
    }
  | {
      type: "PSE";
      /** Uno de los `code` que devolvió `listPseBanks()`. */
      bankCode: string;
      personType: "NATURAL" | "LEGAL";
    };

export interface CreatePaymentRequest {
  /** El identificador de la orden del comercio. */
  orderReference: string;
  /** En pesos enteros: el esqueleto no conoce la unidad de ninguna pasarela. */
  amountInPesos: number;
  description: string;
  payer: Payer;
  method: PaymentMethodRequest;
  /** La página de la orden, a la que vuelve el pagador después del banco. */
  returnUrl: string;
}

export interface PaymentSnapshot {
  /** El identificador de la transacción en la pasarela. */
  transactionId: string;
  status: MerchantPaymentStatus;
  /** El estado tal como lo dijo la pasarela, sin traducir. */
  nativeStatus: string;
  /** Si el pago exige ir a otra página (el banco en PSE), su URL. */
  redirectUrl?: string;
}

export interface WebhookNotification {
  transactionId: string;
  status: MerchantPaymentStatus;
  nativeStatus: string;
}

/** Un webhook tal como llegó al checkout. */
export interface IncomingWebhook {
  /** El cuerpo exactamente como llegó por la red, porque la firma se calcula sobre él. */
  rawBody: string;
  headers: IncomingHttpHeaders;
  /** Mercado Pago firma con el `data.id` de la URL, no solo con el cuerpo. */
  query: Record<string, string | undefined>;
}

export interface PseBankOption {
  code: string;
  name: string;
}

/**
 * Un fallo técnico que siguió después de reintentar: la pasarela no respondió, respondió
 * 5xx o con un cuerpo ilegible. No es un rechazo: el pago no se decidió.
 */
export class PaymentTechnicalError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PaymentTechnicalError";
  }
}

export interface PaymentsPort {
  /** Los valores públicos que necesita `tokenizeCard()` en el navegador, como la llave pública. */
  publicConfig(): Record<string, string>;
  listPseBanks(): Promise<PseBankOption[]>;
  createPayment(request: CreatePaymentRequest): Promise<PaymentSnapshot>;
  getPaymentStatus(transactionId: string): Promise<PaymentSnapshot>;
  /**
   * Verifica la firma y dice qué transacción cambió. Devuelve `null` si la firma no es válida.
   * Es asíncrona porque el webhook de Mercado Pago solo trae el identificador, y el estado
   * exige una segunda petición (plan de evaluación, §3).
   */
  verifyWebhook(webhook: IncomingWebhook): Promise<WebhookNotification | null>;
}
