import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  CreatePaymentRequest,
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
  defaultSleep,
  fetchWithRetry,
  readBody,
  readEnv,
  splitName,
} from "./gateway";

/**
 * Integración directa con Mercado Pago (prototipo A): `fetch` contra su API, siguiendo la
 * documentación oficial de Colombia. Tarjeta y PSE van por la Orders API.
 *
 * - Crear una orden: https://www.mercadopago.com.co/developers/es/reference/online-payments/checkout-api/create-order/post
 * - Tarjetas: https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/integration-test/cards
 * - PSE: https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/payment-integration/websites/pse
 * - Estados de la orden: https://www.mercadopago.com.co/developers/en/docs/checkout-api-orders/payment-management/status/order-status
 * - Notificaciones de órdenes: https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/notifications
 * - Firma de los webhooks: https://www.mercadopago.com.co/developers/es/docs/your-integrations/notifications/webhooks
 */
export interface MercadoPagoPaymentsConfig {
  /** La raíz de la API, `https://api.mercadopago.com/v1` o la del simulador. */
  baseUrl: string;
  /** El access token del vendedor (`APP_USR-…`), para las llamadas del servidor. */
  accessToken: string;
  /** La llave pública, para tokenizar en el navegador y buscar la marca de la tarjeta. */
  publicKey: string;
  /** La clave secreta de los webhooks, de «Tus integraciones». Sin ella no se acepta ninguno. */
  webhookSecret: string;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Mercado Pago no tiene un host de sandbox: se prueba con las credenciales del vendedor de prueba. */
const MERCADOPAGO_API_URL = "https://api.mercadopago.com/v1";

const SANDBOX_KEYS = ["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_PUBLIC_KEY"] as const;

/** Valores para la API de Simulación, que no valida estas credenciales. No son llaves reales. */
const SIMULATOR_ACCESS_TOKEN = "TEST-simulador-kit-pagos";
const SIMULATOR_PUBLIC_KEY = "TEST-simulador-kit-pagos-publica";

/** El tipo de persona de PSE con los nombres de `payer.entity_type`. */
const ENTITY_TYPES = { NATURAL: "individual", LEGAL: "association" } as const;

/** Los identificadores de la Orders API empiezan así; los de la Payments API son números. */
const ORDER_ID_PREFIX = "ORD";

/**
 * El estado de la orden en el vocabulario del comercio (función 2). `processed` es el cobro
 * aprobado; `action_required` es el PSE que espera la transferencia; `failed`, el rechazo.
 */
function mapOrderStatus(rawStatus: string): MerchantPaymentStatus {
  switch (rawStatus.trim().toLowerCase()) {
    case "processed":
      return "APPROVED";
    case "created":
    case "processing":
    case "action_required":
      return "PENDING";
    default:
      return "DECLINED";
  }
}

/**
 * La IP del pagador como la acepta `additional_info["payer.ip_address"]`: rechaza `::1` y
 * `::ffff:127.0.0.1`, que son las formas en que Node da una IPv4 en un socket IPv6.
 */
function payerIpv4(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed === "::1") return "127.0.0.1";
  return /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed)?.[1] ?? trimmed;
}

/** El primer valor de una cabecera, que Node puede entregar como arreglo. */
function headerValue(headers: IncomingWebhook["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Compara dos firmas en tiempo constante. */
function sameSignature(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** El mensaje de un error de Mercado Pago, en cualquiera de sus dos formas. */
function errorMessage(body: Record<string, any>, status: number): string {
  const first = Array.isArray(body.errors) ? body.errors[0] : undefined;
  if (first?.message) return `${first.code ?? "error"}: ${first.message}`;
  if (body.cause?.[0]?.description) return body.cause[0].description;
  return body.message || `Mercado Pago respondió HTTP ${status}`;
}

class MercadoPagoPayments implements GatewayPayments {
  private readonly baseUrl: string;
  private readonly retry: { maxRetries: number; retryDelayMs: number; sleep: (ms: number) => Promise<void> };

  constructor(private readonly config: MercadoPagoPaymentsConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.retry = {
      maxRetries: config.maxRetries ?? 2,
      retryDelayMs: config.retryDelayMs ?? 100,
      sleep: config.sleep ?? defaultSleep,
    };
  }

  /** Lo que necesita el navegador para `POST /v1/card_tokens?public_key=…`. */
  publicConfig(): Record<string, string> {
    return { publicKey: this.config.publicKey, baseUrl: this.baseUrl };
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetchWithRetry("Mercado Pago", `${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.accessToken}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    }, this.retry);
  }

  /** Un GET cuyo cuerpo se necesita entero: un 4xx es un error de los datos o de las credenciales. */
  private async getJson(path: string): Promise<Record<string, any>> {
    const response = await this.request(path);
    const body = await readBody(response);
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return body;
  }

  /**
   * Mercado Pago no tiene un endpoint de bancos: `GET /v1/payment_methods` trae los métodos de
   * pago, y los bancos de PSE vienen dentro del método `pse`, en `financial_institutions`.
   */
  async listPseBanks(): Promise<PseBankOption[]> {
    const response = await this.request("/payment_methods");
    const body = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) throw new Error(errorMessage((body ?? {}) as Record<string, any>, response.status));
    if (!Array.isArray(body)) throw new PaymentTechnicalError("Mercado Pago respondió los métodos de pago sin una lista");
    const pse = body.find((method) => method?.id === "pse");
    const institutions: Array<Record<string, unknown>> = Array.isArray(pse?.financial_institutions) ? pse.financial_institutions : [];
    return institutions.map((bank) => ({ code: String(bank.id), name: String(bank.description ?? bank.id) }));
  }

  /**
   * La Orders API exige la marca (`visa`) y el tipo (`credit_card`) de la tarjeta, que el token
   * no trae: se leen los seis primeros dígitos del token y se buscan con la llave pública.
   */
  private async cardBrand(cardToken: string): Promise<{ id: string; type: string }> {
    const token = await this.getJson(`/card_tokens/${encodeURIComponent(cardToken)}`);
    const bin = token.first_six_digits;
    if (typeof bin !== "string" || !bin) {
      throw new PaymentTechnicalError("Mercado Pago devolvió el token de la tarjeta sin first_six_digits");
    }
    const search = await this.getJson(
      `/payment_methods/search?public_key=${encodeURIComponent(this.config.publicKey)}&bins=${encodeURIComponent(bin)}`,
    );
    const method = Array.isArray(search.results) ? search.results[0] : undefined;
    if (!method?.id || !method?.payment_type_id) {
      throw new Error(`Mercado Pago no tiene un medio de pago para el BIN ${bin}`);
    }
    return { id: String(method.id), type: String(method.payment_type_id) };
  }

  /** El cuerpo de `POST /v1/orders`, con lo que cada método exige. */
  private async orderPayload(request: CreatePaymentRequest): Promise<Record<string, unknown>> {
    // `total_amount` no admite decimales: va en pesos enteros, como string.
    const total = String(Math.round(request.amountInPesos));
    const { payer, method } = request;
    const identification = { type: payer.documentType, number: payer.documentNumber };
    const common = { type: "online", processing_mode: "automatic", total_amount: total, external_reference: request.orderReference };

    if (method.type === "CARD") {
      if (!method.cardToken) throw new Error("Mercado Pago cobra la tarjeta con un token del navegador");
      const brand = await this.cardBrand(method.cardToken);
      return {
        ...common,
        payer: { email: payer.email, identification },
        transactions: {
          payments: [
            {
              amount: total,
              payment_method: { id: brand.id, type: brand.type, token: method.cardToken, installments: method.installments },
            },
          ],
        },
      };
    }

    // PSE exige el pagador completo, su IP y la URL de vuelta; sin cualquiera de ellos responde 400.
    const { firstName, lastName } = splitName(payer.fullName);
    return {
      ...common,
      payer: {
        email: payer.email,
        entity_type: ENTITY_TYPES[method.personType],
        identification,
        first_name: firstName,
        last_name: lastName,
        phone: { area_code: COLOMBIA_PHONE_CODE, number: payer.phone },
        address: {
          street_name: payer.address.streetName,
          street_number: payer.address.streetNumber,
          neighborhood: payer.address.neighborhood,
          city: payer.address.city,
          zip_code: payer.address.zipCode,
        },
      },
      transactions: {
        payments: [{ amount: total, payment_method: { id: "pse", type: "bank_transfer", financial_institution: method.bankCode } }],
      },
      // La clave lleva el punto en el nombre; no es un objeto anidado.
      additional_info: { "payer.ip_address": payerIpv4(request.payerIp) },
      // Mercado Pago rechaza una URL de vuelta en localhost: en el sandbox, PUBLIC_BASE_URL va por un túnel.
      config: { online: { callback_url: request.returnUrl } },
    };
  }

  /**
   * Crea la orden. La llave de idempotencia es una por cobro y se repite en los reintentos: con la
   * misma llave y el mismo cuerpo Mercado Pago responde la orden original, así que reintentar un
   * fallo técnico no cobra dos veces.
   */
  async createPayment(request: CreatePaymentRequest): Promise<PaymentSnapshot> {
    const payload = await this.orderPayload(request);
    const response = await this.request("/orders", {
      method: "POST",
      headers: { "X-Idempotency-Key": randomUUID() },
      body: JSON.stringify(payload),
    });
    const body = await readBody(response);

    // Un cobro rechazado llega como 402, con la orden fallida en `data`: es un rechazo, no un error.
    const order = response.status === 402 && body.data?.id ? body.data : response.ok ? body : undefined;
    if (!order) throw new Error(errorMessage(body, response.status));
    if (!order.id) throw new PaymentTechnicalError("Mercado Pago respondió la orden sin id");

    const snapshot = this.snapshotOf(order);
    const redirectUrl = order.transactions?.payments?.[0]?.payment_method?.redirect_url;
    // Una orden de PSE puede nacer `processing` sin la URL del banco; la consulta dirá cómo terminó.
    return snapshot.status === "PENDING" && typeof redirectUrl === "string" && redirectUrl ? { ...snapshot, redirectUrl } : snapshot;
  }

  private snapshotOf(order: Record<string, any>): PaymentSnapshot {
    const nativeStatus = String(order.status ?? "");
    return { transactionId: String(order.id), status: mapOrderStatus(nativeStatus), nativeStatus };
  }

  /** `GET /v1/orders/{id}`. */
  async getPaymentStatus(transactionId: string): Promise<PaymentSnapshot> {
    const order = await this.getJson(`/orders/${encodeURIComponent(transactionId)}`);
    if (!order.id) throw new PaymentTechnicalError("Mercado Pago respondió la orden sin id");
    return this.snapshotOf(order);
  }

  /**
   * Verifica `x-signature: ts=…,v1=…`, el HMAC-SHA256 en hexadecimal de
   * `id:[data.id];request-id:[x-request-id];ts:[ts];` con la clave secreta. El `data.id` es el
   * de la URL, en minúsculas; una parte que no llegó se quita del manifiesto.
   *
   * La firma no cubre el cuerpo, así que su estado no se cree: se consulta la orden.
   */
  async verifyWebhook(webhook: IncomingWebhook): Promise<WebhookNotification | null> {
    if (!this.config.webhookSecret) return null;
    const signature = headerValue(webhook.headers, "x-signature");
    if (!signature) return null;
    const parts = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=", 2)));
    if (!parts.ts || !parts.v1) return null;

    let body: Record<string, any> = {};
    try {
      body = webhook.rawBody.trim() ? JSON.parse(webhook.rawBody) : {};
    } catch {
      return null;
    }
    const queryId = webhook.query["data.id"];
    const bodyId = body.data?.id === undefined ? undefined : String(body.data.id);
    // El cuerpo no está firmado: si trae otro id que la URL, no se sabe cuál se notificó.
    if (queryId && bodyId && queryId.toLowerCase() !== bodyId.toLowerCase()) return null;
    const dataId = queryId || bodyId;

    const requestId = headerValue(webhook.headers, "x-request-id");
    const manifest = `${dataId ? `id:${dataId.toLowerCase()};` : ""}${requestId ? `request-id:${requestId};` : ""}ts:${parts.ts};`;
    const expected = createHmac("sha256", this.config.webhookSecret).update(manifest).digest("hex");
    if (!sameSignature(expected, parts.v1) || !dataId) return null;

    if (!dataId.toUpperCase().startsWith(ORDER_ID_PREFIX)) {
      // Un aviso de otro recurso (un pago de la Payments API): este checkout cobra por órdenes, así
      // que no corresponde a ninguna y el esqueleto lo da por recibido sin cambiar nada.
      return { transactionId: dataId, status: "PENDING", nativeStatus: String(body.type ?? webhook.query.type ?? "") };
    }
    const { transactionId, status, nativeStatus } = await this.getPaymentStatus(dataId);
    return { transactionId, status, nativeStatus };
  }
}

export function createMercadoPagoPayments(config: MercadoPagoPaymentsConfig): GatewayPayments {
  return new MercadoPagoPayments(config);
}

/** Mercado Pago en el registro de pasarelas del prototipo A (`index.ts`). */
export const mercadoPagoModule: GatewayModule = {
  option: { id: "mercadopago", name: "Mercado Pago", cardCapture: "BROWSER_TOKEN" },
  sandboxKeys: SANDBOX_KEYS,
  baseUrlVariable: "MERCADOPAGO_BASE_URL",
  create: (env) => {
    const { environment, simulatorUrl } = paymentsEnvironment(env);
    return createMercadoPagoPayments({
      baseUrl:
        readEnv(env, "MERCADOPAGO_BASE_URL") ??
        (environment === "sandbox" ? MERCADOPAGO_API_URL : `${simulatorUrl}/v1/sim/mercadopago`),
      accessToken: readEnv(env, "MERCADOPAGO_ACCESS_TOKEN") ?? SIMULATOR_ACCESS_TOKEN,
      publicKey: readEnv(env, "MERCADOPAGO_PUBLIC_KEY") ?? SIMULATOR_PUBLIC_KEY,
      webhookSecret: readEnv(env, "MERCADOPAGO_WEBHOOK_SECRET") ?? "",
    });
  },
};
