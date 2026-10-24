import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  CreatePaymentRequest,
  DeclineCategory,
  DeclineReason,
  IncomingWebhook,
  MerchantPaymentStatus,
  PaymentSnapshot,
  PaymentTechnicalError,
  PseBankOption,
  WebhookNotification,
} from "../checkout/PaymentsPort";
import { paymentsEnvironment } from "../checkout/environment";
import { GatewayModule, GatewayPayments, declineReasonOf, defaultSleep, fetchWithRetry, readEnv } from "./gateway";

/**
 * Integración directa con Rapyd (prototipo A): `fetch` contra su API, siguiendo la documentación
 * oficial. La tarjeta va por la página de pago de Rapyd y PSE es un método por banco.
 *
 * - Firma de las peticiones: https://docs.rapyd.net/en/request-signatures.html
 * - Página de pago (checkout): https://docs.rapyd.net/en/retrieve-checkout-page.html
 * - Crear un pago: https://docs.rapyd.net/en/create-payment.html
 * - Consultar un pago: https://docs.rapyd.net/en/retrieve-payment.html
 * - Formato y firma de los webhooks: https://docs.rapyd.net/en/webhook-format.html y
 *   https://docs.rapyd.net/en/webhook-authentication.html
 *
 * Lo medido contra el sandbox está en `docs/testing-data/rapyd.md`.
 */
export interface RapydPaymentsConfig {
  /** `https://sandboxapi.rapyd.net/v1` o la raíz del simulador. */
  baseUrl: string;
  /** `access_key`: identifica a la organización y viaja en claro. */
  accessKey: string;
  /** `secret_key`: nunca se transmite, solo firma. */
  secretKey: string;
  /** La URL exacta registrada en el panel de Rapyd, que entra en la firma de los webhooks. */
  webhookUrl: string;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RAPYD_SANDBOX_URL = "https://sandboxapi.rapyd.net/v1";

const SANDBOX_KEYS = ["RAPYD_API_ACCESS_KEY", "RAPYD_API_SECRET_KEY"] as const;

/** Las del simulador, publicadas en `examples/README.md`: no son llaves reales. */
const SIMULATOR_ACCESS_KEY = "rapyd_access_key_ejemplo_no_real";
const SIMULATOR_SECRET_KEY = "rapyd_secret_kit_pagos_simulator";

/** En Rapyd PSE no es un método con un campo de banco: es un método por entidad, `co_pse_{banco}_bank`. */
const PSE_TYPE_PREFIX = "co_pse_";

/**
 * Los bancos que el sandbox cobra. Lista los 50, pero los otros 41 responden `400
 * ERROR_GET_GATEWAY` al pagar, y nada en el catálogo los distingue (medido el 17 de octubre de
 * 2026, `docs/testing-data/rapyd.md` §5.8).
 */
const SANDBOX_PSE_TYPES = new Set([
  "co_pse_banco_davivienda_bank",
  "co_pse_bancolombia_bank",
  "co_pse_banco_caja_social_bank",
  "co_pse_banco_av_villas_bank",
  "co_pse_banco_union_bank",
  "co_pse_banco_contactar_bank",
  "co_pse_accion_fiduciaria_bank",
  "co_pse_ding_bank",
  "co_pse_paycash_bank",
]);

const CHECKOUT_ID_PREFIX = "checkout_";

/**
 * Solo un `failure_code` del procesador de tarjetas es un rechazo del banco; los demás fallos de
 * un pago `ERR` son técnicos y no traen un motivo para el comprador.
 */
const CARD_DECLINE_PREFIX = "ERROR_PROCESSING_CARD";

/**
 * Las categorías de los `failure_code` con fuente: solo `[51]`, «Insufficient Funds» en las
 * tarjetas de error del sandbox (`docs/testing-data/rapyd.md` §2). `[05]` «Do Not Honor» y `[43]`
 * «Stolen Card» no dicen la causa sin interpretarla y quedan fuera.
 */
const RAPYD_DECLINE_CATEGORIES: Readonly<Record<string, DeclineCategory>> = {
  "ERROR_PROCESSING_CARD - [51]": "INSUFFICIENT_FUNDS",
};

/** El motivo de un pago rechazado por el procesador, del checkout o del pago. */
function rapydDeclineReason(resource: Record<string, any>): DeclineReason | undefined {
  const failureCode = String(resource.failure_code ?? "");
  if (String(resource.status ?? "").toUpperCase() !== "ERR" || !failureCode.startsWith(CARD_DECLINE_PREFIX)) {
    return undefined;
  }
  return declineReasonOf(failureCode, RAPYD_DECLINE_CATEGORIES);
}

/**
 * El estado de un pago o de un checkout. `CLO` es «cerrado», no «pagado»: solo con `paid` el
 * cobro salió. `NEW` es el checkout que nadie pagó todavía.
 */
function mapRapydStatus(rawStatus: string, paid: unknown): MerchantPaymentStatus {
  switch (rawStatus.toUpperCase()) {
    case "CLO":
      return paid === true ? "APPROVED" : "DECLINED";
    case "ACT":
    case "NEW":
      return "PENDING";
    default:
      return "DECLINED";
  }
}

/**
 * Rapyd manda un webhook distinto por desenlace, no un evento con un estado variable. La
 * excepción es `PAYMENT_UPDATED`, que solo avisa que el pago cambió: con 3DS llega en el mismo
 * segundo que `PAYMENT_COMPLETED`, todavía en `ACT` (medido en el sandbox el 21 de octubre de
 * 2026), así que vale lo que diga el estado del pago.
 */
function mapRapydEvent(eventType: string, payment: Record<string, any> | undefined): MerchantPaymentStatus {
  if (eventType === "PAYMENT_COMPLETED") return "APPROVED";
  if (eventType === "PAYMENT_SUCCEEDED") return "PENDING";
  if (eventType === "PAYMENT_UPDATED") return mapRapydStatus(String(payment?.status ?? ""), payment?.paid);
  return "DECLINED";
}

/** El monto en pesos como string con dos decimales: `JSON.stringify(12.00)` da `12` y rompe la firma. */
function rapydAmount(amountInPesos: number): string {
  return amountInPesos.toFixed(2);
}

function headerValue(headers: IncomingWebhook["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function sameSignature(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** El HMAC-SHA256 en hexadecimal, y ese texto en Base64: así firma Rapyd, en las peticiones y en los webhooks. */
function rapydSignature(secretKey: string, toSign: string): string {
  return Buffer.from(createHmac("sha256", secretKey).update(toSign).digest("hex")).toString("base64");
}

function errorMessage(body: Record<string, any>, status: number): string {
  const detail = body.status;
  if (detail?.error_code) return `${detail.error_code}: ${detail.message ?? ""}`.trim();
  return `Rapyd respondió HTTP ${status}`;
}

class RapydPayments implements GatewayPayments {
  private readonly baseUrl: string;
  private readonly retry: { maxRetries: number; retryDelayMs: number; sleep: (ms: number) => Promise<void> };

  constructor(private readonly config: RapydPaymentsConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.retry = {
      maxRetries: config.maxRetries ?? 2,
      retryDelayMs: config.retryDelayMs ?? 100,
      sleep: config.sleep ?? defaultSleep,
    };
  }

  /** La tarjeta no se tokeniza en la tienda: la pide la página de Rapyd. */
  publicConfig(): Record<string, string> {
    return {};
  }

  /**
   * Una petición firmada: `BASE64(HEX(HMAC-SHA256(método en minúsculas + ruta con la query + salt +
   * timestamp + access_key + secret_key + cuerpo)))`. El cuerpo se firma y se manda como el mismo
   * texto. Los POST llevan una llave de idempotencia, la misma en cada reintento.
   */
  private async send(method: "get" | "post", path: string, payload?: Record<string, unknown>): Promise<Record<string, any>> {
    const url = `${this.baseUrl}${path}`;
    const body = payload ? JSON.stringify(payload) : "";
    const salt = randomBytes(8).toString("hex");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const { pathname, search } = new URL(url);
    const signature = rapydSignature(
      this.config.secretKey,
      `${method}${pathname}${search}${salt}${timestamp}${this.config.accessKey}${this.config.secretKey}${body}`,
    );
    const response = await fetchWithRetry("Rapyd", url, {
      method: method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        access_key: this.config.accessKey,
        salt,
        timestamp,
        signature,
        ...(method === "post" ? { idempotency: randomUUID() } : {}),
      },
      body: payload ? body : undefined,
    }, this.retry);
    const parsed = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok) throw new Error(errorMessage(parsed, response.status));
    if (!parsed.data) throw new PaymentTechnicalError("Rapyd respondió sin data");
    return parsed.data;
  }

  /**
   * Rapyd no tiene una lista de bancos: PSE son los métodos `co_pse_*` del catálogo de Colombia.
   * El código que ve la tienda es el método mismo.
   */
  async listPseBanks(): Promise<PseBankOption[]> {
    const methods = await this.send("get", "/payment_methods/country?country=CO");
    const inSandbox = new URL(this.baseUrl).host === new URL(RAPYD_SANDBOX_URL).host;
    return (Array.isArray(methods) ? methods : [])
      .filter((method) => typeof method.type === "string" && method.type.startsWith(PSE_TYPE_PREFIX))
      .filter((method) => !inSandbox || SANDBOX_PSE_TYPES.has(method.type))
      .map((method) => ({ code: String(method.type), name: String(method.name ?? method.type) }));
  }

  async createPayment(request: CreatePaymentRequest): Promise<PaymentSnapshot> {
    const returnUrls = { complete_payment_url: request.returnUrl, error_payment_url: request.returnUrl };

    if (request.method.type === "CARD") {
      // Cobrar un token sin la página exige el número de la tarjeta en la petición (medido:
      // `400 ERROR_CARD_NOT_AUTHENTICATED`), así que el pagador la escribe en el checkout de Rapyd.
      const checkout = await this.send("post", "/checkout", {
        amount: rapydAmount(request.amountInPesos),
        currency: "COP",
        country: "CO",
        merchant_reference_id: request.orderReference,
        payment_method_type_categories: ["card"],
        receipt_email: request.payer.email,
        ...returnUrls,
      });
      return this.redirectOf(checkout);
    }

    // PSE son dos llamadas: el cliente (con el teléfono, que en el pago se rechaza) y el pago.
    const customer = await this.send("post", "/customers", {
      name: request.payer.fullName,
      email: request.payer.email,
      phone_number: request.payer.phone,
    });
    if (!customer.id) throw new PaymentTechnicalError("Rapyd creó el cliente sin id");
    const payment = await this.send("post", "/payments", {
      amount: rapydAmount(request.amountInPesos),
      currency: "COP",
      customer: customer.id,
      payment_method: {
        type: request.method.bankCode,
        fields: {
          customer_identification_type: request.payer.documentType,
          customer_identification_number: request.payer.documentNumber,
        },
      },
      merchant_reference_id: request.orderReference,
      ...returnUrls,
    });
    return this.redirectOf(payment);
  }

  /** El checkout y el pago de PSE nacen con la URL a la que hay que mandar al pagador. */
  private redirectOf(resource: Record<string, any>): PaymentSnapshot {
    const transactionId = String(resource.id ?? "");
    const redirectUrl = typeof resource.redirect_url === "string" && resource.redirect_url ? resource.redirect_url : undefined;
    if (!transactionId || !redirectUrl) {
      throw new PaymentTechnicalError(`Rapyd respondió ${transactionId || "sin id"} sin la URL a la que redirigir al pagador`);
    }
    const nativeStatus = String(resource.status ?? "");
    return { transactionId, status: mapRapydStatus(nativeStatus, resource.paid), nativeStatus, redirectUrl };
  }

  /**
   * Un checkout y un pago son recursos distintos (un id de checkout en `/payments/{id}` responde
   * `400 ERROR_GET_PAYMENT`). El checkout trae su pago en `payment` cuando el pagador termina.
   */
  async getPaymentStatus(transactionId: string): Promise<PaymentSnapshot> {
    if (transactionId.startsWith(CHECKOUT_ID_PREFIX)) {
      const checkout = await this.send("get", `/checkout/${encodeURIComponent(transactionId)}`);
      const payment = checkout.payment;
      const source = payment?.id ? payment : checkout;
      return this.snapshotOf(transactionId, source);
    }
    const payment = await this.send("get", `/payments/${encodeURIComponent(transactionId)}`);
    return this.snapshotOf(transactionId, payment);
  }

  private snapshotOf(transactionId: string, resource: Record<string, any>): PaymentSnapshot {
    const nativeStatus = String(resource.status ?? "");
    const declineReason = rapydDeclineReason(resource);
    return {
      transactionId,
      status: mapRapydStatus(nativeStatus, resource.paid),
      nativeStatus,
      ...(declineReason ? { declineReason } : {}),
    };
  }

  /**
   * Verifica la cabecera `signature`: la misma fórmula de las peticiones, con la URL completa
   * registrada en el panel en lugar del método y la ruta. Rapyd solo manda `salt`, `timestamp` y
   * `signature`; la URL sale de la configuración, no de la petición. Un pago con tarjeta notifica
   * el pago, no el checkout que guarda la orden, y el pago no trae ningún campo que apunte al
   * checkout (medido en el sandbox el 21 de octubre de 2026): por eso va también
   * `merchant_reference_id`, la orden, que la firma cubre con el resto del cuerpo.
   */
  async verifyWebhook(webhook: IncomingWebhook): Promise<WebhookNotification | null> {
    if (!this.config.webhookUrl || !webhook.rawBody.trim()) return null;
    const signature = headerValue(webhook.headers, "signature");
    const salt = headerValue(webhook.headers, "salt") ?? "";
    const timestamp = headerValue(webhook.headers, "timestamp");
    if (!signature || !timestamp) return null;
    const expected = rapydSignature(
      this.config.secretKey,
      `${this.config.webhookUrl}${salt}${timestamp}${this.config.accessKey}${this.config.secretKey}${webhook.rawBody}`,
    );
    if (!sameSignature(expected, signature)) return null;

    let body: Record<string, any>;
    try {
      body = JSON.parse(webhook.rawBody);
    } catch {
      return null;
    }
    const transactionId = String(body.data?.id ?? "");
    if (!transactionId) return null;
    const eventType = String(body.type ?? "");
    return {
      transactionId,
      status: mapRapydEvent(eventType, body.data),
      nativeStatus: String(body.data?.status ?? eventType),
      orderReference: body.data?.merchant_reference_id ? String(body.data.merchant_reference_id) : undefined,
    };
  }
}

export function createRapydPayments(config: RapydPaymentsConfig): GatewayPayments {
  return new RapydPayments(config);
}

/** Rapyd en el registro de pasarelas del prototipo A (`index.ts`). */
export const rapydModule: GatewayModule = {
  option: { id: "rapyd", name: "Rapyd", cardCapture: "HOSTED_PAGE" },
  sandboxKeys: SANDBOX_KEYS,
  baseUrlVariable: "RAPYD_BASE_URL",
  create: (env) => {
    const { environment, simulatorUrl } = paymentsEnvironment(env);
    return createRapydPayments({
      baseUrl: readEnv(env, "RAPYD_BASE_URL") ?? (environment === "sandbox" ? RAPYD_SANDBOX_URL : `${simulatorUrl}/v1/sim/rapyd`),
      accessKey: readEnv(env, "RAPYD_API_ACCESS_KEY") ?? SIMULATOR_ACCESS_KEY,
      secretKey: readEnv(env, "RAPYD_API_SECRET_KEY") ?? SIMULATOR_SECRET_KEY,
      webhookUrl: readEnv(env, "RAPYD_WEBHOOK_URL") ?? "",
    });
  },
};
