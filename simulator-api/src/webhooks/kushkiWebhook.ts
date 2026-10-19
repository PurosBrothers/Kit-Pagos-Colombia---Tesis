import { createHash } from "crypto";
import { Gateway } from "kit-pagos-colombia";
import { KushkiChargeResponse, KushkiTransferStatusResponse } from "../gateways/kushki/types";
import { traceabilityCodeFor } from "../store/TransferTraceability";
import { kushkiSignature } from "./signatures";
import { JSON_HEADERS, notDocumented, OutgoingWebhook, WebhookContext, WebhookSubject } from "./webhookTypes";

/**
 * Un `transaction_id` distinto del ticket, derivado de él.
 *
 * Nivel 2 para que sean distintos: la página del webhook de tarjeta de Kushki para Colombia
 * (https://docs.kushki.com/co/notifications/one-time-payments/webhook-card/, consultada el 7 de
 * octubre de 2026) lista `ticket_number` y `transaction_id` como campos aparte, y en sus
 * ejemplos difieren (`"992823152575262637"` y `"781482485839103928"`). Antes el simulador
 * repetía el ticket en los dos, y un SDK que leyera el campo equivocado pasaba igual.
 *
 * Nivel 3 para el valor: el simulador no guarda un `transactionId` del cobro, y no se sabe en
 * qué lugar de la respuesta de creación lo devuelve Kushki. Se deriva del ticket con 18 dígitos,
 * como en el ejemplo, para que dos webhooks del mismo cobro lleven el mismo.
 */
function kushkiTransactionId(ticketNumber: string): string {
  const digest = BigInt(`0x${createHash("sha256").update(ticketNumber).digest("hex")}`);
  return (digest % 10n ** 18n).toString().padStart(18, "0");
}

/**
 * La consulta del SDK es por ticket, que viaja en `ticket_number`. `merchant_id` se omite: es
 * de la cuenta del comercio y el simulador no lo conoce.
 */
function kushkiChargeBody(charge: KushkiChargeResponse, now: number): Record<string, unknown> {
  const { details } = charge;
  return {
    ticket_number: charge.ticketNumber,
    transaction_id: kushkiTransactionId(charge.ticketNumber),
    transaction_reference: charge.transactionReference,
    transaction_type: "SALE",
    transaction_status: details.transactionStatus,
    amount: {
      subtotalIva0: details.subtotalIva0,
      subtotalIva: details.subtotalIva,
      iva: details.ivaValue,
      ice: details.iceValue,
      currency: details.currencyCode,
    },
    approved_transaction_amount: details.approvedTransactionAmount,
    currency_code: details.currencyCode,
    response_text: details.responseText,
    created: now,
  };
}

/**
 * El `ticketNumber` de una transferencia, derivado del token.
 *
 * Nivel 2 para el campo: la página del webhook de transferencia lo trae, con 16 dígitos en su
 * ejemplo (`"3135812068015768"`). Nivel 3 para el valor: ni la respuesta de `init` ni la de
 * `status`, medidas el 18 de septiembre de 2026, traen un ticket, así que el simulador no tiene
 * uno guardado. Se deriva del token para que dos webhooks de la misma transferencia lleven el
 * mismo.
 */
function kushkiTransferTicketNumber(token: string): string {
  const digest = BigInt(`0x${createHash("sha256").update(`transfer:${token}`).digest("hex")}`);
  return (digest % 10n ** 16n).toString().padStart(16, "0");
}

/**
 * El rechazo de una transferencia. Nivel 2 para la forma: el ejemplo declinado de la página del
 * webhook trae `responseCode` y `responseText`, y el aprobado no. Nivel 3 para el valor: el
 * registro guardado no tiene un código de rechazo —la consulta de estado medida no lo trae—, así
 * que se usan los del ejemplo.
 */
const KUSHKI_TRANSFER_DECLINE = { responseCode: "T003", responseText: "Monto inválido" };

/**
 * Lo que distingue a una transferencia aprobada de una rechazada en el webhook. En los ejemplos
 * de la página, la aprobada trae `ticketNumber` y `trazabilityCode`, y la rechazada no los trae
 * y trae en cambio el código y el texto del rechazo (nivel 2). El `trazabilityCode` es el que
 * entregó el `init` (`store/TransferTraceability.ts`).
 */
function kushkiTransferOutcome(transfer: KushkiTransferStatusResponse): Record<string, string> {
  if (transfer.status === "declinedTransaction") {
    return KUSHKI_TRANSFER_DECLINE;
  }
  const trazabilityCode = traceabilityCodeFor(transfer.token);
  return {
    ticketNumber: kushkiTransferTicketNumber(transfer.token),
    ...(trazabilityCode === undefined ? {} : { trazabilityCode }),
  };
}

/**
 * Los campos de la página del webhook de transferencia que el registro guardado conoce, con sus
 * valores. `amount` es el que se guardó al emitir el token, sin `extraTaxes` porque la petición
 * no lo trae. `completedAt` es el momento de la notificación (nivel 3). Se omite lo que el
 * simulador no sabe: `publicMerchantId`, `userIp`, `userType`,
 * `processorId`, `bankurl` y los demás datos del procesador y de la cuenta.
 */
function kushkiTransferBody(transfer: KushkiTransferStatusResponse, now: number): Record<string, unknown> {
  return {
    ...kushkiTransferOutcome(transfer),
    token: transfer.token,
    status: transfer.status,
    amount: transfer.amount,
    currency: transfer.currency,
    country: transfer.country,
    bankId: transfer.bankId,
    documentType: transfer.documentType,
    documentNumber: transfer.documentNumber,
    email: transfer.email,
    paymentDescription: transfer.paymentDescription,
    callbackUrl: transfer.callbackUrl,
    merchantName: transfer.merchantName,
    transactionReference: transfer.transactionReference,
    created: transfer.created,
    completedAt: now,
  };
}

/**
 * Firma: nivel 2 — https://docs.kushki.com/co/notifications/overview, consultada el 7 de
 * octubre de 2026: HMAC-SHA256 de `<cuerpo>.<x-kushki-id>` en `x-kushki-signature`. La página
 * la exige a «los Webhooks válidos» y lista la transferencia entre los cuerpos posibles, así
 * que es la misma para tarjeta y transferencia.
 */
function signedWebhook(bodyAt: (now: number) => Record<string, unknown>, context: WebhookContext): OutgoingWebhook {
  const { webhookSecret } = context.secret(Gateway.KUSHKI);
  const now = context.now();
  const kushkiId = String(Math.floor(now / 1000));
  const body = JSON.stringify(bodyAt(now));
  return {
    gateway: Gateway.KUSHKI,
    query: null,
    headers: {
      ...JSON_HEADERS,
      "x-kushki-id": kushkiId,
      "x-kushki-signature": kushkiSignature(body, kushkiId, webhookSecret),
    },
    body,
  };
}

/**
 * Cuerpo del cobro con tarjeta: nivel 2 —
 * https://docs.kushki.com/co/notifications/one-time-payments/webhook-card/, consultada el 7 de
 * octubre de 2026: notifica al aprobarse o declinarse, con el cuerpo plano. Un cobro
 * `INITIALIZED` no se notifica.
 */
function chargeWebhook(charge: KushkiChargeResponse, context: WebhookContext): OutgoingWebhook {
  if (charge.details.transactionStatus === "INITIALIZED") {
    throw notDocumented("Kushki only notifies a card charge when it is approved or declined.");
  }
  return signedWebhook((now) => kushkiChargeBody(charge, now), context);
}

/**
 * Cuerpo de la transferencia: nivel 2 —
 * https://docs.kushki.com/co/notifications/one-time-payments/webhook-transfer-in/, consultada el
 * 7 de octubre de 2026 (la versión en inglés, `/co/en/…`, trae los mismos campos). Kushki lo
 * envía «cuando se complete un pago con transferencia»: el simulador notifica los desenlaces
 * que produce, `approvedTransaction` y `declinedTransaction`. Un token sin iniciar o una
 * transferencia todavía en el banco no se notifican.
 */
function transferWebhook(transfer: KushkiTransferStatusResponse, context: WebhookContext): OutgoingWebhook {
  if (transfer.status !== "approvedTransaction" && transfer.status !== "declinedTransaction") {
    throw notDocumented(`Kushki notifies a transfer when it is completed, not in '${transfer.status}'.`);
  }
  return signedWebhook((now) => kushkiTransferBody(transfer, now), context);
}

/** El webhook de un cobro con tarjeta o de una transferencia de Kushki. */
export function kushkiWebhook(
  subject: Extract<WebhookSubject, { gateway: Gateway.KUSHKI }>,
  context: WebhookContext,
): OutgoingWebhook {
  return subject.kind === "transfer" ? transferWebhook(subject.record, context) : chargeWebhook(subject.record, context);
}
