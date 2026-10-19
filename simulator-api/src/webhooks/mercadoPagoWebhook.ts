import { randomInt, randomUUID } from "crypto";
import { Gateway } from "kit-pagos-colombia";
import { MercadoPagoOrderResponse, MercadoPagoPaymentResponse } from "../gateways/mercadopago/types";
import { mercadoPagoSignature } from "./signatures";
import { JSON_HEADERS, notDocumented, OutgoingWebhook, WebhookContext, WebhookSubject } from "./webhookTypes";

/**
 * `user_id` y `application_id` se omiten: son de la cuenta del comercio y el simulador no los
 * conoce. El `id` de la notificación es propio de Mercado Pago y no se relaciona con el pago.
 */
function mercadoPagoPaymentBody(payment: MercadoPagoPaymentResponse): Record<string, unknown> {
  return {
    action: "payment.updated",
    api_version: "v1",
    data: { id: String(payment.id) },
    id: randomInt(1_000_000_000, 2 ** 47),
  };
}

/**
 * Nivel 2 — https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/notifications:
 * la orden viaja completa en `data`. El ejemplo documentado es `order.processed`, y el
 * simulador no emite otro estado con un nombre de acción que no comprobó.
 */
function mercadoPagoOrderBody(order: MercadoPagoOrderResponse): Record<string, unknown> {
  if (order.status !== "processed") {
    throw notDocumented(`Mercado Pago does not document the order notification action for '${order.status}'.`);
  }
  return { action: "order.processed", api_version: "v1", data: order };
}

/**
 * Nivel 2 — https://www.mercadopago.com.co/developers/es/docs/your-integrations/notifications/webhooks:
 * la firma va en `x-signature: ts=<ms>,v1=<hmac>` sobre el manifiesto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, y el `data.id` viaja en la URL.
 * El cuerpo no se firma: el SDK solo compara su `data.id` con el de la URL.
 */
function signedWebhook(
  type: "payment" | "order",
  dataId: string,
  partial: Record<string, unknown>,
  context: WebhookContext,
): OutgoingWebhook {
  const { webhookSecret } = context.secret(Gateway.MERCADOPAGO);
  const now = context.now();
  const requestId = randomUUID();
  const ts = String(now);
  const body = JSON.stringify({ ...partial, date_created: new Date(now).toISOString(), live_mode: false, type });
  return {
    gateway: Gateway.MERCADOPAGO,
    query: `data.id=${encodeURIComponent(dataId)}&type=${type}`,
    headers: {
      ...JSON_HEADERS,
      "x-signature": `ts=${ts},v1=${mercadoPagoSignature(dataId, requestId, ts, webhookSecret)}`,
      "x-request-id": requestId,
    },
    body,
  };
}

/** El webhook de un pago (Payments API) o de una orden (PSE y, desde el SDK 0.6.0, tarjeta). */
export function mercadoPagoWebhook(
  subject: Extract<WebhookSubject, { gateway: Gateway.MERCADOPAGO }>,
  context: WebhookContext,
): OutgoingWebhook {
  return subject.kind === "payment"
    ? signedWebhook("payment", String(subject.record.id), mercadoPagoPaymentBody(subject.record), context)
    : signedWebhook("order", subject.record.id, mercadoPagoOrderBody(subject.record), context);
}
