import { createHash, randomBytes, randomInt, randomUUID } from "crypto";
import { Credentials, Gateway } from "kit-pagos-colombia";
import { KushkiChargeResponse, KushkiTransferStatusResponse } from "../gateways/kushki/types";
import { MercadoPagoOrderResponse, MercadoPagoPaymentResponse } from "../gateways/mercadopago/types";
import { RapydCheckout, RapydPayment } from "../gateways/rapyd/types";
import { WompiTransaction } from "../gateways/wompi/types";
import { traceabilityCodeFor } from "../store/TransferTraceability";
import {
  kushkiSignature,
  mercadoPagoSignature,
  rapydWebhookSignature,
  wompiEventChecksum,
} from "./signatures";

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

const JSON_HEADERS = { "content-type": "application/json" };

/** Las propiedades que el simulador firma en Wompi; el SDK exige las dos primeras. */
const WOMPI_SIGNED_PROPERTIES = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];

function notDocumented(message: string): WebhookUnavailableError {
  return new WebhookUnavailableError("WEBHOOK_EVENT_NOT_DOCUMENTED", message);
}

/**
 * Arma el cuerpo nativo del webhook de un registro guardado y lo firma con los secretos del
 * perfil del servidor (issue #122, paso 7; issue #130, bloque 1).
 *
 * Los secretos salen solo de `secretsFor`, que en la app es
 * `credentialResolver.getServerCredentials`: nunca de la petición. La compatibilidad la decide
 * el verificador del SDK instalado, y las pruebas la comprueban contra
 * `POST /v1/api/webhooks/:gateway`.
 *
 * Cada pasarela documenta su cuerpo; lo que el simulador no puede saber (el `user_id` de
 * Mercado Pago, el `merchant_id` de Kushki) se omite en vez de inventarlo, y un evento sin
 * cuerpo documentado lanza `WEBHOOK_EVENT_NOT_DOCUMENTED`.
 */
export class SignatureGenerator {
  constructor(
    private readonly secretsFor: (gateway: Gateway) => Credentials | undefined,
    private readonly clock: () => number = Date.now,
  ) {}

  generate(subject: WebhookSubject): OutgoingWebhook {
    switch (subject.gateway) {
      case Gateway.WOMPI:
        return this.wompi(subject.record);
      case Gateway.MERCADOPAGO:
        return subject.kind === "payment"
          ? this.mercadoPago("payment", String(subject.record.id), mercadoPagoPaymentBody(subject.record))
          : this.mercadoPago("order", subject.record.id, mercadoPagoOrderBody(subject.record));
      case Gateway.KUSHKI:
        return subject.kind === "transfer" ? this.kushkiTransfer(subject.record) : this.kushki(subject.record);
      case Gateway.RAPYD:
        return this.rapyd(subject.kind === "payment" ? subject.record : paymentOfCheckout(subject.record));
    }
  }

  private secret(gateway: Gateway): Credentials & { webhookSecret: string } {
    const credentials = this.secretsFor(gateway);
    if (!credentials?.webhookSecret) {
      throw new WebhookUnavailableError(
        "WEBHOOK_SECRET_NOT_CONFIGURED",
        `The server profile has no webhook secret for ${gateway.toLowerCase()}.`,
      );
    }
    return { ...credentials, webhookSecret: credentials.webhookSecret };
  }

  /**
   * Nivel 2 — https://docs.wompi.co/docs/colombia/eventos/: `event`, `data.transaction`,
   * `environment`, `signature { properties, checksum }`, `timestamp` en segundos y `sent_at`.
   * El checksum es SHA256 de los valores de `properties`, el `timestamp` y el secreto de
   * eventos; el ejemplo publicado no se reproduce con su propio secreto (ver
   * `test/webhook-signatures.test.ts`), así que la fórmula se valida contra el SDK.
   */
  private wompi(transaction: WompiTransaction): OutgoingWebhook {
    const { webhookSecret } = this.secret(Gateway.WOMPI);
    const now = this.clock();
    const timestamp = Math.floor(now / 1000);
    const checksum = wompiEventChecksum(
      [transaction.id, transaction.status, transaction.amount_in_cents],
      timestamp,
      webhookSecret,
    );
    const body = JSON.stringify({
      event: "transaction.updated",
      data: { transaction },
      environment: "test",
      signature: { properties: WOMPI_SIGNED_PROPERTIES, checksum },
      timestamp,
      sent_at: new Date(now).toISOString(),
    });
    return { gateway: Gateway.WOMPI, query: null, headers: { ...JSON_HEADERS, "x-event-checksum": checksum }, body };
  }

  /**
   * Nivel 2 — https://www.mercadopago.com.co/developers/es/docs/your-integrations/notifications/webhooks:
   * la firma va en `x-signature: ts=<ms>,v1=<hmac>` sobre el manifiesto
   * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, y el `data.id` viaja en la URL.
   * El cuerpo no se firma: el SDK solo compara su `data.id` con el de la URL.
   */
  private mercadoPago(type: "payment" | "order", dataId: string, partial: Record<string, unknown>): OutgoingWebhook {
    const { webhookSecret } = this.secret(Gateway.MERCADOPAGO);
    const now = this.clock();
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

  /**
   * Cuerpo: nivel 2 — https://docs.kushki.com/co/notifications/one-time-payments/webhook-card/,
   * consultada el 7 de octubre de 2026: notifica al aprobarse o declinarse, con el cuerpo
   * plano. Un cobro `INITIALIZED` no se notifica.
   */
  private kushki(charge: KushkiChargeResponse): OutgoingWebhook {
    const status = charge.details.transactionStatus;
    if (status === "INITIALIZED") {
      throw notDocumented("Kushki only notifies a card charge when it is approved or declined.");
    }
    return this.kushkiSigned((now) => kushkiChargeBody(charge, now));
  }

  /**
   * Cuerpo: nivel 2 —
   * https://docs.kushki.com/co/notifications/one-time-payments/webhook-transfer-in/, consultada el
   * 7 de octubre de 2026 (la versión en inglés, `/co/en/…`, trae los mismos campos). Kushki lo
   * envía «cuando se complete un pago con transferencia»: el simulador notifica los desenlaces
   * que produce, `approvedTransaction` y `declinedTransaction`. Un token sin iniciar o una
   * transferencia todavía en el banco no se notifican.
   */
  private kushkiTransfer(transfer: KushkiTransferStatusResponse): OutgoingWebhook {
    if (transfer.status !== "approvedTransaction" && transfer.status !== "declinedTransaction") {
      throw notDocumented(`Kushki notifies a transfer when it is completed, not in '${transfer.status}'.`);
    }
    return this.kushkiSigned((now) => kushkiTransferBody(transfer, now));
  }

  /**
   * Firma: nivel 2 — https://docs.kushki.com/co/notifications/overview, consultada el 7 de
   * octubre de 2026: HMAC-SHA256 de `<cuerpo>.<x-kushki-id>` en `x-kushki-signature`. La página
   * la exige a «los Webhooks válidos» y lista la transferencia entre los cuerpos posibles, así
   * que es la misma para tarjeta y transferencia.
   */
  private kushkiSigned(bodyAt: (now: number) => Record<string, unknown>): OutgoingWebhook {
    const { webhookSecret } = this.secret(Gateway.KUSHKI);
    const now = this.clock();
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
   * Nivel 2 — https://docs.rapyd.net/en/webhook-format.html (raíz del cuerpo) y
   * https://docs.rapyd.net/en/webhook-authentication.html (firma): base64 del HMAC
   * hexadecimal de `<url registrada><salt><timestamp><access key><secret><cuerpo>`. La URL es
   * `RAPYD_WEBHOOK_URL` y no el destino real, porque es la que el comercio registró en Rapyd.
   * Los tipos de evento salen de las páginas de `PAYMENT_COMPLETED`, `PAYMENT_FAILED` y
   * `PAYMENT_EXPIRED`, consultadas el 6 de octubre de 2026 sin registrar su URL.
   */
  private rapyd(payment: RapydPayment | RapydCheckout["payment"]): OutgoingWebhook {
    const type = rapydEventType(payment);
    const credentials = this.secret(Gateway.RAPYD);
    if (!credentials.webhookUrl) {
      throw new WebhookUnavailableError(
        "WEBHOOK_SECRET_NOT_CONFIGURED",
        "Rapyd signs the registered webhook URL, and RAPYD_WEBHOOK_URL is not configured.",
      );
    }
    const now = this.clock();
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
}

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

function paymentOfCheckout(checkout: RapydCheckout): RapydCheckout["payment"] {
  if (checkout.payment.id === null) {
    throw notDocumented("The Rapyd checkout has no payment yet; Rapyd notifies payments, not checkouts.");
  }
  return checkout.payment;
}

/**
 * Solo los tres eventos cuya página se consultó. `ACT` (esperando al pagador), `REV` y un
 * `CLO` sin pagar no tienen un evento documentado que el SDK traduzca con certeza.
 */
function rapydEventType(payment: RapydPayment | RapydCheckout["payment"]): string {
  if (payment.status === "CLO" && payment.paid === true) return "PAYMENT_COMPLETED";
  if (payment.status === "ERR") return "PAYMENT_FAILED";
  if (payment.status === "EXP") return "PAYMENT_EXPIRED";
  throw notDocumented(`Rapyd has no documented payment event for status '${String(payment.status)}'.`);
}
