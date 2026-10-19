import { createHash } from "node:crypto";
import {
  CreatePaymentRequest,
  IncomingWebhook,
  MerchantPaymentStatus,
  PaymentSnapshot,
  PaymentsPort,
  PaymentTechnicalError,
  PseBankOption,
  WebhookNotification,
} from "../checkout/PaymentsPort";

/**
 * Configuración de integración directa con Wompi (Prototipo A - Control).
 * Se lee del entorno por omisión, sin valores de producción en el repositorio.
 */
export interface WompiPaymentsConfig {
  baseUrl: string;
  publicKey: string;
  privateKey: string;
  integritySecret: string;
  eventsSecret: string;
  maxRetries?: number;
  retryDelayMs?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_WOMPI_BASE_URL = "http://localhost:3000/v1/sim/wompi";
const DEFAULT_INTEGRITY_SECRET = "test_integrity_kit_pagos_simulator";

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Traduce el estado nativo de Wompi al vocabulario del comercio (función 2).
 * Wompi maneja APPROVED, DECLINED, VOIDED, PENDING y ERROR.
 */
function mapWompiStatus(rawStatus: string): MerchantPaymentStatus {
  switch (rawStatus.toUpperCase().trim()) {
    case "APPROVED":
      return "APPROVED";
    case "PENDING":
      return "PENDING";
    case "DECLINED":
    case "VOIDED":
    case "ERROR":
    default:
      return "DECLINED";
  }
}

/**
 * Módulo de pagos del Prototipo A (control): integración directa con `fetch`
 * contra la API nativa de Wompi, siguiendo su documentación oficial.
 */
class WompiPaymentsAdapter implements PaymentsPort {
  private readonly baseUrl: string;
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly integritySecret: string;
  private readonly eventsSecret: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config?: Partial<WompiPaymentsConfig>) {
    this.baseUrl = (config?.baseUrl ?? process.env.WOMPI_BASE_URL ?? DEFAULT_WOMPI_BASE_URL).replace(/\/+$/, "");
    this.publicKey = (config?.publicKey ?? process.env.WOMPI_PUBLIC_KEY ?? "pub_test_simulator").trim();
    this.privateKey = (config?.privateKey ?? process.env.WOMPI_PRIVATE_KEY ?? "prv_test_simulator").trim();
    this.integritySecret = (config?.integritySecret ?? process.env.WOMPI_INTEGRITY_SECRET ?? DEFAULT_INTEGRITY_SECRET).trim();
    this.eventsSecret = (config?.eventsSecret ?? process.env.WOMPI_EVENTS_SECRET ?? "").trim();
    this.maxRetries = config?.maxRetries ?? 2;
    this.retryDelayMs = config?.retryDelayMs ?? 100;
    this.pollIntervalMs = config?.pollIntervalMs ?? 200;
    this.pollTimeoutMs = config?.pollTimeoutMs ?? 5000;
    this.sleep = config?.sleep ?? defaultSleep;
  }

  /**
   * Valores públicos requeridos por `tokenizeCard()` en el navegador.
   * Documentación: https://docs.wompi.co/docs/colombia/tokens/
   */
  publicConfig(): Record<string, string> {
    return {
      publicKey: this.publicKey,
      baseUrl: this.baseUrl,
    };
  }

  /**
   * Ejecuta peticiones HTTP con reintentos para fallos técnicos (timeout, red, 5xx).
   * Un error 4xx no se reintenta porque corresponde a errores de validación o credenciales.
   */
  private async fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const response = await fetch(url, options);
        if (response.status >= 500) {
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
          if (attempt <= this.maxRetries) {
            await this.sleep(this.retryDelayMs);
            continue;
          }
          throw new PaymentTechnicalError(
            `Fallo técnico de Wompi tras ${attempt} intentos (HTTP ${response.status})`,
            lastError,
          );
        }
        return response;
      } catch (error) {
        if (error instanceof PaymentTechnicalError) {
          throw error;
        }
        lastError = error;
        if (attempt <= this.maxRetries) {
          await this.sleep(this.retryDelayMs);
          continue;
        }
        throw new PaymentTechnicalError(
          `Fallo técnico de red o timeout al comunicar con Wompi tras ${attempt} intentos: ${(error as Error).message}`,
          error,
        );
      }
    }
    throw new PaymentTechnicalError("Fallo técnico tras reintentos", lastError);
  }

  /**
   * Consulta la lista de instituciones financieras disponibles para PSE.
   * Documentación: https://docs.wompi.co/docs/colombia/metodos-de-pago/pse/#obtener-instituciones-financieras
   * GET /pse/financial_institutions con cabecera Authorization: Bearer <publicKey>
   */
  async listPseBanks(): Promise<PseBankOption[]> {
    const response = await this.fetchWithRetry(`${this.baseUrl}/pse/financial_institutions`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.publicKey}`,
      },
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, any>;
      throw new Error(errorBody.error?.reason || `Error al consultar bancos PSE (${response.status})`);
    }

    const json = (await response.json().catch(() => ({}))) as Record<string, any>;
    const institutions = json?.data;
    if (!Array.isArray(institutions)) {
      throw new PaymentTechnicalError("Respuesta de Wompi sin lista de instituciones financieras válida");
    }

    return institutions.map((item: Record<string, unknown>) => ({
      code: String(item.financial_institution_code || ""),
      name: String(item.financial_institution_name || ""),
    }));
  }

  /**
   * Obtiene el token de aceptación de términos firmado y de un solo uso.
   * Documentación: https://docs.wompi.co/docs/colombia/transacciones/#obtener-presigned-acceptance
   * GET /merchants/{publicKey}
   */
  private async getAcceptanceToken(): Promise<string> {
    const response = await this.fetchWithRetry(`${this.baseUrl}/merchants/${encodeURIComponent(this.publicKey)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.publicKey}`,
      },
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, any>;
      throw new Error(errorBody.error?.reason || `Error al obtener token de aceptación (${response.status})`);
    }

    const json = (await response.json().catch(() => ({}))) as Record<string, any>;
    const token = json?.data?.presigned_acceptance?.acceptance_token;
    if (typeof token !== "string" || !token) {
      throw new PaymentTechnicalError("Respuesta de Wompi sin acceptance_token válido");
    }

    return token;
  }

  /**
   * Crea un pago con tarjeta o PSE contra Wompi.
   *
   * Documentación oficial:
   * - Transacciones: https://docs.wompi.co/docs/colombia/transacciones/#crear-transaccion
   * - Firma de integridad: https://docs.wompi.co/docs/colombia/transacciones/#firma-de-integridad
   *   Fórmula: SHA256(reference + amount_in_cents + currency + integritySecret)
   * - PSE: https://docs.wompi.co/docs/colombia/metodos-de-pago/pse/#crear-transaccion-con-pse
   *   La URL de redirección no viene en la creación: se sondea hasta que aparezca.
   */
  async createPayment(request: CreatePaymentRequest): Promise<PaymentSnapshot> {
    const acceptanceToken = await this.getAcceptanceToken();

    // El monto del comercio llega en pesos enteros; Wompi exige centavos enteros.
    const amountInCents = Math.round(request.amountInPesos * 100);
    const currency = "COP";

    // Firma de integridad requerida por Wompi (SHA-256 en minúsculas)
    const signature = createHash("sha256")
      .update(`${request.orderReference}${amountInCents}${currency}${this.integritySecret}`)
      .digest("hex");

    const payload: Record<string, unknown> = {
      amount_in_cents: amountInCents,
      currency,
      customer_email: request.payer.email,
      reference: request.orderReference,
      acceptance_token: acceptanceToken,
      signature,
      customer_data: {
        phone_number: request.payer.phone,
        full_name: request.payer.fullName,
        legal_id: request.payer.documentNumber,
        legal_id_type: request.payer.documentType,
      },
      redirect_url: request.returnUrl,
    };

    if (request.method.type === "CARD") {
      payload.payment_method = {
        type: "CARD",
        token: request.method.cardToken,
        installments: request.method.installments,
      };
    } else {
      payload.payment_method = {
        type: "PSE",
        user_type: request.method.personType === "NATURAL" ? 0 : 1,
        user_legal_id_type: request.payer.documentType,
        user_legal_id: request.payer.documentNumber,
        financial_institution_code: request.method.bankCode,
        payment_description: request.description || `Pago ${request.orderReference}`,
      };
    }

    const response = await this.fetchWithRetry(`${this.baseUrl}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.privateKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, any>;
      const message =
        errorBody.error?.reason ||
        (errorBody.error?.messages ? JSON.stringify(errorBody.error.messages) : `Error al crear transacción (${response.status})`);
      throw new Error(message);
    }

    const json = (await response.json().catch(() => ({}))) as Record<string, any>;
    const tx = json?.data;
    if (!tx || !tx.id) {
      throw new PaymentTechnicalError("Respuesta de Wompi sin transacción válida");
    }

    const txId = String(tx.id);
    let nativeStatus = String(tx.status || "PENDING");
    let redirectUrl = tx.payment_method?.extra?.async_payment_url;

    // Con PSE la URL del banco no llega en la respuesta de creación: se sondea hasta que aparezca
    if (request.method.type === "PSE" && !redirectUrl && nativeStatus === "PENDING") {
      const polled = await this.pollPseRedirect(txId);
      nativeStatus = polled.nativeStatus;
      redirectUrl = polled.redirectUrl;
    }

    const merchantStatus = mapWompiStatus(nativeStatus);

    return {
      transactionId: txId,
      status: merchantStatus,
      nativeStatus,
      redirectUrl: merchantStatus === "PENDING" && redirectUrl ? redirectUrl : undefined,
    };
  }

  /**
   * Sondea la transacción de PSE hasta que aparezca la URL del banco o termine.
   * Si la transacción resuelve antes de publicar la URL o junto a ella, se retorna el estado.
   */
  private async pollPseRedirect(transactionId: string): Promise<{ nativeStatus: string; redirectUrl?: string }> {
    const deadline = Date.now() + this.pollTimeoutMs;
    while (Date.now() < deadline) {
      await this.sleep(this.pollIntervalMs);
      const snapshot = await this.getPaymentStatus(transactionId);
      if (snapshot.status !== "PENDING" || snapshot.redirectUrl) {
        return {
          nativeStatus: snapshot.nativeStatus,
          redirectUrl: snapshot.redirectUrl,
        };
      }
    }
    throw new PaymentTechnicalError(
      `Wompi no publicó la URL de redirección de PSE para la transacción ${transactionId} en ${this.pollTimeoutMs} ms`,
    );
  }

  /**
   * Consulta el estado de una transacción por su identificador.
   * Documentación: https://docs.wompi.co/docs/colombia/transacciones/#consultar-transaccion
   * GET /transactions/{id}
   */
  async getPaymentStatus(transactionId: string): Promise<PaymentSnapshot> {
    const response = await this.fetchWithRetry(`${this.baseUrl}/transactions/${encodeURIComponent(transactionId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.privateKey}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Transacción no encontrada en Wompi: ${transactionId}`);
      }
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, any>;
      throw new Error(errorBody.error?.reason || `Error al consultar transacción (${response.status})`);
    }

    const json = (await response.json().catch(() => ({}))) as Record<string, any>;
    const tx = json?.data;
    if (!tx || !tx.id) {
      throw new PaymentTechnicalError("Respuesta de Wompi sin datos de transacción");
    }

    const nativeStatus = String(tx.status || "");
    const merchantStatus = mapWompiStatus(nativeStatus);
    const redirectUrl = tx.payment_method?.extra?.async_payment_url;

    return {
      transactionId: String(tx.id),
      status: merchantStatus,
      nativeStatus,
      redirectUrl: typeof redirectUrl === "string" && redirectUrl.length > 0 ? redirectUrl : undefined,
    };
  }

  /**
   * Verifica la firma del webhook y extrae los datos del evento.
   *
   * Documentación: https://docs.wompi.co/docs/colombia/eventos/
   * Wompi envía `signature { properties, checksum }`, `timestamp` y `data.transaction`.
   * El checksum es SHA256 de los valores de las propiedades en orden, más el timestamp y el secreto de eventos.
   */
  async verifyWebhook(webhook: IncomingWebhook): Promise<WebhookNotification | null> {
    if (!webhook.rawBody || !webhook.rawBody.trim()) {
      return null;
    }

    if (!this.eventsSecret) {
      return null;
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(webhook.rawBody);
    } catch {
      return null;
    }

    const { data, signature, timestamp } = payload ?? {};
    if (!data?.transaction || !signature?.properties || !signature?.checksum || timestamp === undefined) {
      return null;
    }

    const values: unknown[] = [];
    for (const prop of signature.properties) {
      const val = String(prop).split(".").reduce((acc: any, part: string) => (acc ? acc[part] : undefined), data);
      values.push(val);
    }

    const concatenated = `${values.map((v) => String(v ?? "")).join("")}${timestamp}${this.eventsSecret}`;
    const expectedChecksum = createHash("sha256").update(concatenated).digest("hex");

    if (expectedChecksum.toLowerCase() !== String(signature.checksum).toLowerCase()) {
      return null;
    }

    const tx = data.transaction;
    const nativeStatus = String(tx.status || "");
    return {
      transactionId: String(tx.id),
      status: mapWompiStatus(nativeStatus),
      nativeStatus,
    };
  }
}

/**
 * Crea la implementación de PaymentsPort para el prototipo A (integración directa con Wompi).
 */
export function createPayments(config?: Partial<WompiPaymentsConfig>): PaymentsPort {
  return new WompiPaymentsAdapter(config);
}
