import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CreatePaymentRequest,
  DeclineCategory,
  IncomingWebhook,
  MerchantPaymentStatus,
  PaymentSnapshot,
  PaymentTechnicalError,
  PseBankOption,
  WebhookNotification,
} from "../checkout/PaymentsPort";
import { paymentsEnvironment } from "../checkout/environment";
import {
  COLOMBIA_PHONE_CODE,
  GatewayModule,
  GatewayPayments,
  declineReasonOf,
  defaultSleep,
  fetchWithRetry,
  readEnv,
  splitName,
} from "./gateway";

/**
 * Integración directa con Kushki (prototipo D): `fetch` contra su API, siguiendo la referencia
 * oficial de Colombia. Kushki llama Transfer In a su PSE.
 *
 * - Tarjetas: https://api-docs.kushkipagos.com/colombia/online-payments/card-payments
 * - Transfer In: https://api-docs.kushkipagos.com/2163826m0
 * - Webhook de tarjeta: https://docs.kushki.com/co/notifications/one-time-payments/webhook-card/
 * - Webhook de transferencia: https://docs.kushki.com/co/notifications/one-time-payments/webhook-transfer-in/
 *
 * Lo medido contra UAT que la referencia no dice está en `docs/testing-data/kushki.md`.
 */
export interface KushkiPaymentsConfig {
  /** `https://api-uat.kushkipagos.com` o la raíz del simulador. */
  baseUrl: string;
  /** `Public-Merchant-Id`: la lista de bancos, el token de la tarjeta y el de la transferencia. */
  publicMerchantId: string;
  /** `Private-Merchant-Id`: el cobro, el inicio de la transferencia y la consulta. */
  privateMerchantId: string;
  /** El «Webhook signature ID» de la consola. Sin él no se acepta ningún webhook. */
  webhookSecret: string;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const KUSHKI_UAT_URL = "https://api-uat.kushkipagos.com";

const SANDBOX_KEYS = ["KUSHKI_PUBLIC_MERCHANT_ID", "KUSHKI_PRIVATE_MERCHANT_ID"] as const;

/** Valores para la API de Simulación, que no valida estas credenciales. No son llaves reales. */
const SIMULATOR_PUBLIC_MERCHANT_ID = "simulador-kit-pagos-publico";
const SIMULATOR_PRIVATE_MERCHANT_ID = "simulador-kit-pagos-privado";

/** La lista de bancos empieza con el texto de relleno de un `<select>`, con este código. */
const PLACEHOLDER_BANK_CODE = "0";

/** El estado de una transferencia recién iniciada: la respuesta de `init` no trae estado. */
const INITIALIZED_TRANSFER = "initializedTransaction";

/**
 * Las categorías de los códigos de rechazo de Kushki que tienen fuente. Los de tarjeta se
 * midieron el 24 de octubre de 2026 con las tarjetas de `docs/testing-data/kushki.md` §1 (punto
 * 122): el motivo de cada uno dice la categoría sin interpretarlo, salvo `019`, «Tarjeta no
 * compatible», que queda fuera. `00011` es «Fondos insuficientes» de la red PSE (§5.5).
 */
const KUSHKI_DECLINE_CATEGORIES: Readonly<Record<string, DeclineCategory>> = {
  "017": "INVALID_CARD_DATA",
  "021": "INSUFFICIENT_FUNDS",
  "022": "INVALID_CARD_DATA",
  "023": "CARD_RESTRICTED",
  "00011": "INSUFFICIENT_FUNDS",
};

/**
 * Kushki rechaza la tarjeta con un `400`, y el código del banco va en `details.responseCode`:
 * numérico, a diferencia de sus propios errores, que llevan `K` (`K001`, `K004`, `K220`, que
 * también puede traer `details`). Medido el 24 de octubre de 2026 (punto 122).
 */
const BANK_RESPONSE_CODE = /^\d+$/;

/**
 * El 400 no trae un estado; se registra el de su vocabulario de tarjeta para un rechazo, y el
 * código va en el motivo.
 */
const DECLINED_CHARGE = "DECLINED";

/** Si el estado nativo es un rechazo: los vencidos también son `DECLINED` para el comercio, pero sin motivo. */
function isDeclinedStatus(rawStatus: string): boolean {
  return ["declined", "declinedtransaction"].includes(rawStatus.trim().toLowerCase());
}

/**
 * Kushki tiene dos vocabularios: el de tarjeta (`APPROVAL`) y el de transferencia, con nombres
 * propios (`initializedTransaction`). Se comparan en minúsculas.
 */
function mapKushkiStatus(rawStatus: string): MerchantPaymentStatus {
  switch (rawStatus.trim().toLowerCase()) {
    case "approval":
    case "approved":
    case "approvedtransaction":
      return "APPROVED";
    case "initialized":
    case "requestedtoken":
    case "initializedtransaction":
      return "PENDING";
    default:
      return "DECLINED";
  }
}

/**
 * El monto como lo recibe Kushki: no un total, sino sus partes tributarias, en pesos. La tienda
 * no desglosa IVA, así que todo va como exento (`subtotalIva0`).
 */
function kushkiAmount(amountInPesos: number): Record<string, number | string> {
  return { subtotalIva0: amountInPesos, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" };
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

/** Kushki responde `{ code, message }`, y las rutas de transferencia el `{ Message }` de AWS. */
function errorMessage(body: Record<string, any>, status: number): string {
  const message = body.message ?? body.Message;
  if (message) return body.code ? `${body.code}: ${message}` : String(message);
  return `Kushki respondió HTTP ${status}`;
}

class KushkiPayments implements GatewayPayments {
  private readonly baseUrl: string;
  private readonly retry: { maxRetries: number; retryDelayMs: number; sleep: (ms: number) => Promise<void> };

  constructor(private readonly config: KushkiPaymentsConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.retry = {
      maxRetries: config.maxRetries ?? 2,
      retryDelayMs: config.retryDelayMs ?? 100,
      sleep: config.sleep ?? defaultSleep,
    };
  }

  /** Lo que necesita el navegador para `POST /card/v1/tokens` con el `Public-Merchant-Id`. */
  publicConfig(): Record<string, string> {
    return { publicKey: this.config.publicMerchantId, baseUrl: this.baseUrl };
  }

  /** Cada ruta pide una de las dos llaves; mandar la privada donde va la pública la expondría. */
  private async call(
    path: string,
    key: "public" | "private",
    body?: Record<string, unknown>,
  ): Promise<{ response: Response; body: Record<string, any> | unknown[] }> {
    const response = await fetchWithRetry("Kushki", `${this.baseUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(key === "public"
          ? { "Public-Merchant-Id": this.config.publicMerchantId }
          : { "Private-Merchant-Id": this.config.privateMerchantId }),
      },
      body: body ? JSON.stringify(body) : undefined,
    }, this.retry);
    const parsed = (await response.json().catch(() => ({}))) as Record<string, any> | unknown[];
    return { response, body: parsed ?? {} };
  }

  private async callOk(path: string, key: "public" | "private", body?: Record<string, unknown>): Promise<Record<string, any>> {
    const result = await this.call(path, key, body);
    if (!result.response.ok) throw new Error(errorMessage(result.body as Record<string, any>, result.response.status));
    return result.body as Record<string, any>;
  }

  /** `GET /transfer/v1/bankList`. En Colombia elegir el banco de esta lista es parte del método. */
  async listPseBanks(): Promise<PseBankOption[]> {
    const { response, body } = await this.call("/transfer/v1/bankList", "public");
    if (!response.ok) throw new Error(errorMessage(body as Record<string, any>, response.status));
    if (!Array.isArray(body)) throw new PaymentTechnicalError("Kushki respondió la lista de bancos sin un arreglo");
    return body
      .map((bank) => bank as Record<string, unknown>)
      .filter((bank) => String(bank.code ?? "") !== PLACEHOLDER_BANK_CODE && bank.code !== undefined)
      .map((bank) => ({ code: String(bank.code), name: String(bank.name ?? bank.code) }));
  }

  async createPayment(request: CreatePaymentRequest): Promise<PaymentSnapshot> {
    return request.method.type === "CARD" ? this.chargeCard(request) : this.startTransfer(request);
  }

  /**
   * `POST /card/v1/charges` con el token del navegador. El cobro de Colombia es síncrono: con
   * `fullResponse: true` la respuesta trae el estado en `details.transactionStatus`. El token
   * quedó atado al monto al emitirse, así que se cobra exactamente el mismo.
   */
  private async chargeCard(request: CreatePaymentRequest): Promise<PaymentSnapshot> {
    const { method, payer } = request;
    if (method.type !== "CARD" || !method.cardToken) throw new Error("Kushki cobra la tarjeta con un token del navegador");
    const { firstName, lastName } = splitName(payer.fullName);
    const { response, body } = await this.call("/card/v1/charges", "private", {
      token: method.cardToken,
      amount: kushkiAmount(request.amountInPesos),
      contactDetails: {
        documentType: payer.documentType,
        documentNumber: payer.documentNumber,
        firstName,
        lastName,
        email: payer.email,
        phoneNumber: `+${COLOMBIA_PHONE_CODE}${payer.phone}`,
      },
      metadata: { orderReference: request.orderReference },
      ...(method.installments > 1 ? { months: method.installments } : {}),
      fullResponse: true,
    });
    const charge = body as Record<string, any>;
    if (response.status === 400 && BANK_RESPONSE_CODE.test(String(charge.details?.responseCode ?? ""))) {
      return this.declinedCharge(charge);
    }
    if (!response.ok) throw new Error(errorMessage(charge, response.status));
    const ticketNumber = String(charge.ticketNumber ?? "");
    if (!ticketNumber) throw new PaymentTechnicalError("Kushki respondió el cobro sin ticketNumber");
    const nativeStatus = String(charge.details?.transactionStatus ?? "");
    const declineReason = isDeclinedStatus(nativeStatus)
      ? declineReasonOf(charge.details?.responseCode, KUSHKI_DECLINE_CATEGORIES)
      : undefined;
    return { transactionId: ticketNumber, status: mapKushkiStatus(nativeStatus), nativeStatus, ...(declineReason ? { declineReason } : {}) };
  }

  /**
   * El cobro que el banco rechazó: el `400` no trae `ticketNumber` (llega vacío en `details`), así
   * que la transacción es `details.transactionId`, o `transactionReference` si no viene.
   */
  private declinedCharge(charge: Record<string, any>): PaymentSnapshot {
    const transactionId = String(charge.details?.transactionId || charge.transactionReference || "");
    if (!transactionId) throw new PaymentTechnicalError("Kushki rechazó el cobro sin identificarlo");
    const declineReason = declineReasonOf(String(charge.details.responseCode), KUSHKI_DECLINE_CATEGORIES);
    return { transactionId, status: "DECLINED", nativeStatus: DECLINED_CHARGE, ...(declineReason ? { declineReason } : {}) };
  }

  /**
   * Transfer In son dos llamadas: el token (con la URL de vuelta, que en Kushki viaja aquí) y el
   * inicio, que exige el monto otra vez. La transferencia se identifica y se consulta por el token.
   */
  private async startTransfer(request: CreatePaymentRequest): Promise<PaymentSnapshot> {
    const { method, payer } = request;
    if (method.type !== "PSE") throw new Error("Transfer In es solo para PSE");
    const amount = kushkiAmount(request.amountInPesos);
    const tokenBody = await this.callOk("/transfer/v1/tokens", "public", {
      bankId: method.bankCode,
      callbackUrl: request.returnUrl,
      userType: method.personType === "LEGAL" ? "1" : "0",
      documentType: payer.documentType,
      documentNumber: payer.documentNumber,
      email: payer.email,
      currency: "COP",
      paymentDescription: request.orderReference,
      amount,
    });
    const token = typeof tokenBody.token === "string" ? tokenBody.token : "";
    if (!token) throw new PaymentTechnicalError("Kushki no devolvió el token de la transferencia");

    const init = await this.callOk("/transfer/v1/init", "private", { token, amount });
    const redirectUrl = typeof init.redirectUrl === "string" && init.redirectUrl ? init.redirectUrl : undefined;
    if (!redirectUrl) throw new PaymentTechnicalError(`Kushki inició la transferencia ${token} sin la URL del banco`);
    const nativeStatus = typeof init.status === "string" ? init.status : INITIALIZED_TRANSFER;
    return { transactionId: token, status: mapKushkiStatus(nativeStatus), nativeStatus, redirectUrl };
  }

  /**
   * `GET /transfer/v1/status/{token}`. Kushki no publica una consulta de los cobros con tarjeta
   * de Colombia (son síncronos), y esa ruta responde 400 a un id que no es de una transferencia.
   */
  async getPaymentStatus(transactionId: string): Promise<PaymentSnapshot> {
    const { response, body } = await this.call(`/transfer/v1/status/${encodeURIComponent(transactionId)}`, "private");
    const payload = body as Record<string, any>;
    if (response.status === 400) {
      throw new PaymentTechnicalError(
        `Kushki no permite consultar el cobro con tarjeta ${transactionId}: su estado llegó al crearlo, y los cambios llegan por webhook`,
      );
    }
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    const nativeStatus = String(payload.status ?? "");
    const declineReason = isDeclinedStatus(nativeStatus)
      ? declineReasonOf(payload.responseCode, KUSHKI_DECLINE_CATEGORIES)
      : undefined;
    return { transactionId, status: mapKushkiStatus(nativeStatus), nativeStatus, ...(declineReason ? { declineReason } : {}) };
  }

  /**
   * Verifica `x-kushki-signature`, el HMAC-SHA256 en hexadecimal de `<cuerpo>.<x-kushki-id>` con
   * el secreto de webhooks. La firma cubre el cuerpo, así que su estado vale: la tarjeta lo trae
   * en `transaction_status` con el `ticket_number`, y la transferencia en `status` con el `token`.
   */
  async verifyWebhook(webhook: IncomingWebhook): Promise<WebhookNotification | null> {
    if (!this.config.webhookSecret || !webhook.rawBody.trim()) return null;
    const signature = headerValue(webhook.headers, "x-kushki-signature");
    const kushkiId = headerValue(webhook.headers, "x-kushki-id");
    if (!signature || !kushkiId) return null;
    const expected = createHmac("sha256", this.config.webhookSecret).update(`${webhook.rawBody}.${kushkiId}`).digest("hex");
    if (!sameSignature(expected, signature)) return null;

    let body: Record<string, any>;
    try {
      body = JSON.parse(webhook.rawBody);
    } catch {
      return null;
    }
    const transactionId = String(body.ticket_number ?? body.token ?? "");
    if (!transactionId) return null;
    const nativeStatus = String(body.transaction_status ?? body.status ?? "");
    return { transactionId, status: mapKushkiStatus(nativeStatus), nativeStatus };
  }
}

export function createKushkiPayments(config: KushkiPaymentsConfig): GatewayPayments {
  return new KushkiPayments(config);
}

/** Kushki en el registro de pasarelas del prototipo D (`index.ts`). */
export const kushkiModule: GatewayModule = {
  option: { id: "kushki", name: "Kushki", cardCapture: "BROWSER_TOKEN" },
  sandboxKeys: SANDBOX_KEYS,
  baseUrlVariable: "KUSHKI_BASE_URL",
  create: (env) => {
    const { environment, simulatorUrl } = paymentsEnvironment(env);
    return createKushkiPayments({
      baseUrl: readEnv(env, "KUSHKI_BASE_URL") ?? (environment === "sandbox" ? KUSHKI_UAT_URL : `${simulatorUrl}/v1/sim/kushki`),
      publicMerchantId: readEnv(env, "KUSHKI_PUBLIC_MERCHANT_ID") ?? SIMULATOR_PUBLIC_MERCHANT_ID,
      privateMerchantId: readEnv(env, "KUSHKI_PRIVATE_MERCHANT_ID") ?? SIMULATOR_PRIVATE_MERCHANT_ID,
      webhookSecret: readEnv(env, "KUSHKI_WEBHOOK_SECRET") ?? "",
    });
  },
};
