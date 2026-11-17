import { randomBytes, randomUUID } from "crypto";
import { Gateway } from "kit-pagos-colombia";
import { RapydCheckout, RapydPayment } from "../gateways/rapyd/types";
import { rapydWebhookSignature } from "./signatures";
import {
  JSON_HEADERS,
  notDocumented,
  OutgoingWebhook,
  WebhookContext,
  WebhookSubject,
  WebhookUnavailableError,
} from "./webhookTypes";

function paymentOfCheckout(checkout: RapydCheckout): RapydCheckout["payment"] {
  if (checkout.payment.id === null) {
    throw notDocumented("The Rapyd checkout has no payment yet; Rapyd notifies payments, not checkouts.");
  }
  return checkout.payment;
}

/**
 * Los tres desenlaces cuya página se consultó. `REV` y un `CLO` sin pagar no tienen un evento
 * documentado que el SDK traduzca con certeza. `ACT` sí tiene avisos medidos, pero solo como
 * parte de la secuencia del checkout pagado (`rapydWebhookSequence`), no como estado propio.
 */
function rapydEventType(payment: RapydPayment | RapydCheckout["payment"]): string {
  if (payment.status === "CLO" && payment.paid === true) return "PAYMENT_COMPLETED";
  if (payment.status === "ERR") return "PAYMENT_FAILED";
  if (payment.status === "EXP") return "PAYMENT_EXPIRED";
  throw notDocumented(`Rapyd has no documented payment event for status '${String(payment.status)}'.`);
}

/**
 * Nivel 2 — https://docs.rapyd.net/en/webhook-format.html (raíz del cuerpo) y
 * https://docs.rapyd.net/en/webhook-authentication.html (firma): base64 del HMAC
 * hexadecimal de `<url registrada><salt><timestamp><access key><secret><cuerpo>`. La URL es
 * `RAPYD_WEBHOOK_URL` y no el destino real, porque es la que el comercio registró en Rapyd.
 * Los tipos de evento salen de las páginas de `PAYMENT_COMPLETED`, `PAYMENT_FAILED` y
 * `PAYMENT_EXPIRED`, consultadas el 6 de octubre de 2026 sin registrar su URL.
 */
function signedWebhook(
  payment: RapydPayment | RapydCheckout["payment"],
  context: WebhookContext,
  type: string = rapydEventType(payment),
): OutgoingWebhook {
  const credentials = context.secret(Gateway.RAPYD);
  if (!credentials.webhookUrl) {
    throw new WebhookUnavailableError(
      "WEBHOOK_SECRET_NOT_CONFIGURED",
      "Rapyd signs the registered webhook URL, and RAPYD_WEBHOOK_URL is not configured.",
    );
  }
  const now = context.now();
  const timestamp = String(Math.floor(now / 1000));
  const salt = randomBytes(16).toString("base64");
  const body = JSON.stringify({
    id: `wh_${randomBytes(16).toString("hex")}`,
    type,
    data: payment,
    trigger_operation_id: randomUUID(),
    status: "NEW",
    created_at: Math.floor(now / 1000),
    extended_timestamp: now,
  });
  const signature = rapydWebhookSignature({
    webhookUrl: credentials.webhookUrl,
    salt,
    timestamp,
    accessKey: credentials.publicKey,
    secret: credentials.webhookSecret,
    body,
  });
  return { gateway: Gateway.RAPYD, query: null, headers: { ...JSON_HEADERS, salt, timestamp, signature }, body };
}

/** El webhook de un pago de Rapyd, o del pago que nació dentro de un checkout. */
export function rapydWebhook(
  subject: Extract<WebhookSubject, { gateway: Gateway.RAPYD }>,
  context: WebhookContext,
): OutgoingWebhook {
  return signedWebhook(subject.kind === "payment" ? subject.record : paymentOfCheckout(subject.record), context);
}

/**
 * Lo que manda el sandbox cuando se paga la tarjeta en su página, medido el 21 de octubre de
 * 2026 con la tarjeta de prueba, que siempre pide 3DS: `PAYMENT_SUCCEEDED` con el pago en `ACT` y
 * `next_action: "3d_verification"`, y en el mismo segundo `PAYMENT_UPDATED`, todavía en `ACT`, y
 * `PAYMENT_COMPLETED` en `CLO` (punto 118). Los dos primeros no son desenlaces, y un comercio que los
 * lea como tales rechaza un pago aprobado. Cualquier otro caso es un solo webhook.
 */
export function rapydWebhookSequence(
  subject: Extract<WebhookSubject, { gateway: Gateway.RAPYD }>,
  context: WebhookContext,
): OutgoingWebhook[] {
  const completed = rapydWebhook(subject, context);
  if (subject.kind !== "checkout") return [completed];
  const payment = paymentOfCheckout(subject.record);
  if (payment.status !== "CLO" || payment.paid !== true) return [completed];
  const pending = { ...payment, status: "ACT" as const, paid: false };
  return [
    signedWebhook({ ...pending, next_action: "3d_verification" } as RapydCheckout["payment"], context, "PAYMENT_SUCCEEDED"),
    signedWebhook({ ...pending, next_action: "not_applicable" } as RapydCheckout["payment"], context, "PAYMENT_UPDATED"),
    completed,
  ];
}
