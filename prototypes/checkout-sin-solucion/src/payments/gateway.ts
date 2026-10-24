import {
  CreatePaymentRequest,
  DeclineCategory,
  DeclineReason,
  GatewayOption,
  IncomingWebhook,
  PaymentSnapshot,
  PaymentTechnicalError,
  PseBankOption,
  WebhookNotification,
} from "../checkout/PaymentsPort";

/**
 * Lo que integra a mano cada pasarela del prototipo A: las seis funciones del plan de
 * evaluación (§2) contra su API nativa. `index.ts` las reúne en el `PaymentsPort` del
 * esqueleto y les pasa la operación según la pasarela que eligió el comprador.
 */
export interface GatewayPayments {
  /** Los valores públicos que necesita `tokenizeCard()` en el navegador para esta pasarela. */
  publicConfig(): Record<string, string>;
  listPseBanks(): Promise<PseBankOption[]>;
  createPayment(request: CreatePaymentRequest): Promise<PaymentSnapshot>;
  getPaymentStatus(transactionId: string): Promise<PaymentSnapshot>;
  verifyWebhook(webhook: IncomingWebhook): Promise<WebhookNotification | null>;
}

/** Una pasarela del prototipo A: cómo se presenta, qué llaves exige el sandbox y cómo se construye. */
export interface GatewayModule {
  option: GatewayOption;
  /** Las variables sin las que la pasarela no cobra en su sandbox oficial. */
  sandboxKeys: readonly string[];
  /** La variable que apunta la pasarela a otra URL a propósito; con ella no se exigen las llaves. */
  baseUrlVariable: string;
  /** Construye la pasarela con el entorno del checkout: el `.env` de la raíz y el ambiente. */
  create(env: NodeJS.ProcessEnv): GatewayPayments;
}

/** El valor de una variable del entorno, o `undefined` si está vacía. */
export function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Las peticiones a una pasarela, con reintentos solo ante un fallo técnico (función 3): un error
 * de red, un timeout o un 5xx. Un 4xx no se reintenta, porque es un error de los datos o de las
 * credenciales, o un rechazo.
 */
export async function fetchWithRetry(
  gatewayName: string,
  url: string,
  options: RequestInit,
  retry: { maxRetries: number; retryDelayMs: number; sleep: (ms: number) => Promise<void> },
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retry.maxRetries + 1; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      if (attempt > retry.maxRetries) {
        throw new PaymentTechnicalError(`Fallo técnico de ${gatewayName} tras ${attempt} intentos (HTTP ${response.status})`, lastError);
      }
    } catch (error) {
      if (error instanceof PaymentTechnicalError) throw error;
      lastError = error;
      if (attempt > retry.maxRetries) {
        throw new PaymentTechnicalError(
          `Fallo técnico de red o timeout al comunicar con ${gatewayName} tras ${attempt} intentos: ${(error as Error).message}`,
          error,
        );
      }
    }
    await retry.sleep(retry.retryDelayMs);
  }
  throw new PaymentTechnicalError(`Fallo técnico de ${gatewayName} tras reintentos`, lastError);
}

export const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** El cuerpo JSON de una respuesta, o `{}` si no es JSON. */
export async function readBody(response: Response): Promise<Record<string, any>> {
  return ((await response.json().catch(() => ({}))) ?? {}) as Record<string, any>;
}

/** Parte el nombre completo en nombre y apellido para las pasarelas que los piden por separado. */
export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts.shift() ?? "";
  return { firstName, lastName: parts.join(" ") || firstName };
}

/** El código de país de un celular colombiano, para las pasarelas que lo piden aparte. */
export const COLOMBIA_PHONE_CODE = "57";

/**
 * El motivo de un rechazo con la categoría que le da la tabla de su pasarela. Un código que no
 * está en la tabla queda en `UNKNOWN`; sin código no hay motivo.
 */
export function declineReasonOf(
  code: unknown,
  categories: Readonly<Record<string, DeclineCategory>>,
): DeclineReason | undefined {
  if (typeof code !== "string" || code === "") return undefined;
  return { code, category: categories[code] ?? "UNKNOWN" };
}
