import { Credentials, Gateway } from "kit-pagos-colombia";
import { KushkiChargeResponse, KushkiTransferStatusResponse } from "../gateways/kushki/types";
import { MercadoPagoOrderResponse, MercadoPagoPaymentResponse } from "../gateways/mercadopago/types";
import { RapydCheckout, RapydPayment } from "../gateways/rapyd/types";
import { WompiTransaction } from "../gateways/wompi/types";

/** El registro guardado sobre el que se arma el webhook, con su pasarela y su recurso. */
export type WebhookSubject =
  | { gateway: Gateway.WOMPI; kind: "transaction"; record: WompiTransaction }
  | { gateway: Gateway.MERCADOPAGO; kind: "payment"; record: MercadoPagoPaymentResponse }
  | { gateway: Gateway.MERCADOPAGO; kind: "order"; record: MercadoPagoOrderResponse }
  | { gateway: Gateway.KUSHKI; kind: "charge"; record: KushkiChargeResponse }
  | { gateway: Gateway.KUSHKI; kind: "transfer"; record: KushkiTransferStatusResponse }
  | { gateway: Gateway.RAPYD; kind: "payment"; record: RapydPayment }
  | { gateway: Gateway.RAPYD; kind: "checkout"; record: RapydCheckout };

/** El webhook firmado, tal como sale hacia el comercio. */
export interface OutgoingWebhook {
  gateway: Gateway;
  /** Query string sin el `?`; solo Mercado Pago firma un parámetro de la URL. */
  query: string | null;
  headers: Record<string, string>;
  /** Los bytes exactos que se firmaron. Reserializarlos rompe Kushki y Rapyd. */
  body: string;
}

export type WebhookUnavailableReason = "WEBHOOK_SECRET_NOT_CONFIGURED" | "WEBHOOK_EVENT_NOT_DOCUMENTED";

/** No hay webhook que enviar: falta el secreto en el servidor o el evento no está documentado. */
export class WebhookUnavailableError extends Error {
  constructor(
    public readonly code: WebhookUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = "WebhookUnavailableError";
  }
}

export function notDocumented(message: string): WebhookUnavailableError {
  return new WebhookUnavailableError("WEBHOOK_EVENT_NOT_DOCUMENTED", message);
}

export const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Lo que el armador de una pasarela recibe de `SignatureGenerator`. Los dos se piden cuando el
 * armador los usa, no antes: así un evento sin cuerpo documentado sigue respondiendo
 * `WEBHOOK_EVENT_NOT_DOCUMENTED` aunque tampoco haya secreto, como antes de separarlos.
 */
export interface WebhookContext {
  /** Los secretos del perfil del servidor, o `WEBHOOK_SECRET_NOT_CONFIGURED`. */
  secret(gateway: Gateway): Credentials & { webhookSecret: string };
  now(): number;
}

/** El armador del webhook de una pasarela, para el registro de esa pasarela. */
export type WebhookBuilder<G extends Gateway> = (
  subject: Extract<WebhookSubject, { gateway: G }>,
  context: WebhookContext,
) => OutgoingWebhook;
