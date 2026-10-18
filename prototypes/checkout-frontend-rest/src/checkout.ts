import type {
  CreatePaymentBody,
  KitPagosApi,
  Payer,
  PaymentMethodBody,
  TransactionView,
} from "./api";
import type { CardInput, CardTokenizer } from "./tokenizer";

/**
 * El flujo del checkout, igual para las cuatro pasarelas: el valor de `gateway` viaja hasta la
 * API y aquí no se lee. Lo que difiere entre pasarelas —cuántas llamadas, si hay redirección,
 * qué banco— lo resuelve la API o llega en la respuesta (`test/no-gateway-names.test.ts`).
 */

export interface Order {
  gateway: string;
  amount: string;
  currency: string;
  orderReference: string;
  payer: Payer;
  returnUrl: string;
}

/**
 * Lo que hay que recordar mientras el pago no tenga estado final: el pagador está en el banco o
 * en el checkout alojado, o ya volvió y el pago sigue pendiente.
 */
export interface PendingPayment {
  gateway: string;
  gatewayTransactionId: string;
  orderReference: string;
  method: PaymentMethodBody["type"];
}

export type CheckoutStep =
  | { kind: "redirect"; redirectUrl: string; pending: PendingPayment }
  | { kind: "final"; transaction: TransactionView }
  | { kind: "pending"; transaction: TransactionView; pending: PendingPayment };

export interface PollOptions {
  maxAttempts: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
  /** Antes de cada consulta, para que la página muestre el avance de la espera. */
  onAttempt?: (attempt: number, maxAttempts: number) => void;
}

export const DEFAULT_POLL: PollOptions = {
  maxAttempts: 10,
  intervalMs: 1000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function buildPaymentBody(order: Order, paymentMethod: PaymentMethodBody): CreatePaymentBody {
  return {
    gateway: order.gateway,
    amount: order.amount,
    currency: order.currency,
    orderReference: order.orderReference,
    payer: order.payer,
    paymentMethod,
    returnUrlConfig: { returnUrl: order.returnUrl },
  };
}

/**
 * Consulta hasta que el estado sea final. Medido en memoria el 13 de octubre de 2026, una
 * consulta alcanza en las cuatro pasarelas; el tope cubre el escenario `PENDING`, que no
 * resuelve nunca.
 */
export async function pollUntilFinal(
  api: KitPagosApi,
  pending: PendingPayment,
  options: PollOptions = DEFAULT_POLL,
): Promise<CheckoutStep> {
  options.onAttempt?.(1, options.maxAttempts);
  let transaction = await api.getPaymentStatus(pending.gateway, pending.gatewayTransactionId);
  for (let attempt = 1; !transaction.isFinal && attempt < options.maxAttempts; attempt += 1) {
    await options.sleep(options.intervalMs);
    options.onAttempt?.(attempt + 1, options.maxAttempts);
    transaction = await api.getPaymentStatus(pending.gateway, pending.gatewayTransactionId);
  }
  return transaction.isFinal ? { kind: "final", transaction } : { kind: "pending", transaction, pending };
}

export async function startPayment(
  api: KitPagosApi,
  order: Order,
  paymentMethod: PaymentMethodBody,
  poll: PollOptions = DEFAULT_POLL,
): Promise<CheckoutStep> {
  const created = await api.createPayment(buildPaymentBody(order, paymentMethod));

  if (created.outcome === "REDIRECT_REQUIRED") {
    return {
      kind: "redirect",
      redirectUrl: created.redirect.redirectUrl,
      pending: {
        gateway: order.gateway,
        gatewayTransactionId: created.redirect.gatewayTransactionId,
        orderReference: order.orderReference,
        method: paymentMethod.type,
      },
    };
  }

  if (created.transaction.isFinal) {
    return { kind: "final", transaction: created.transaction };
  }
  return pollUntilFinal(
    api,
    {
      gateway: order.gateway,
      gatewayTransactionId: created.transaction.gatewayTransactionId,
      orderReference: order.orderReference,
      method: paymentMethod.type,
    },
    poll,
  );
}

export function payWithPse(
  api: KitPagosApi,
  order: Order,
  bankCode: string,
  poll: PollOptions = DEFAULT_POLL,
): Promise<CheckoutStep> {
  return startPayment(api, order, { type: "PSE", bankCode, payerKind: "NATURAL" }, poll);
}

export interface CardDependencies {
  api: KitPagosApi;
  loadTokenizer: () => Promise<CardTokenizer>;
  publicKeys: Record<string, string>;
  /** El mismo ambiente de las llamadas a `/v1/api`: el token y el cobro tienen que coincidir. */
  environment: string;
}

/**
 * El módulo de tarjeta no se pudo importar. El navegador rechaza igual, con un `TypeError`, la
 * descarga fallida y el archivo que no coincide con el hash del import map, así que el mensaje
 * nombra las dos causas; el error original queda en `cause` para la traza.
 */
export class CardModuleError extends Error {
  readonly code = "CARD_MODULE_UNAVAILABLE";

  constructor(cause: unknown) {
    super("No se pudo cargar el módulo de tarjeta o no pasó la verificación de integridad. La tarjeta no se envió.", {
      cause,
    });
    this.name = "CardModuleError";
  }
}

/**
 * Tokeniza en el navegador y cobra con el token. La tarjeta solo entra en `tokenizeCard()`,
 * que la manda a la ruta de tokenización de la pasarela; a `/v1/api` llega el token.
 *
 * Es el camino de las pasarelas que la API marca `BROWSER_TOKEN`. El monto va siempre a la
 * tokenización, porque hay pasarelas que atan el token a él y cobrar otro se rechaza. Si
 * `KitPagosBrowser` no tokeniza con la pasarela, lanza `UNSUPPORTED_OPERATION` antes de enviar
 * nada, y el error sube tal cual.
 */
export async function payWithCard(
  deps: CardDependencies,
  order: Order,
  card: CardInput,
  poll: PollOptions = DEFAULT_POLL,
): Promise<CheckoutStep> {
  let tokenizer: CardTokenizer;
  try {
    tokenizer = await deps.loadTokenizer();
  } catch (error) {
    throw new CardModuleError(error);
  }
  const { token } = await tokenizer.tokenizeCard({
    gateway: order.gateway,
    publicKey: deps.publicKeys[order.gateway] ?? "",
    environment: deps.environment,
    card,
    amount: order.amount,
    currency: order.currency,
  });
  return startPayment(deps.api, order, { type: "CARD", token, installments: 1 }, poll);
}

/**
 * La tarjeta en la página de la pasarela, para las que la API marca `HOSTED_PAGE`: el pago se
 * crea sin token y responde `REDIRECT_REQUIRED`, como un PSE. La tarjeta no pasa por esta página.
 */
export function payOnHostedPage(api: KitPagosApi, order: Order, poll: PollOptions = DEFAULT_POLL): Promise<CheckoutStep> {
  return startPayment(api, order, { type: "CARD", installments: 1 }, poll);
}

export const PENDING_STORAGE_KEY = "kit-pagos-checkout-c:pending";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function rememberPending(storage: KeyValueStorage, pending: PendingPayment): void {
  storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
}

/**
 * Lee el pago pendiente sin borrarlo. Si el pagador vuelve del banco con «Atrás», el navegador
 * puede recargar la página en vez de restaurarla (observado el 13 de octubre de 2026), y esto es
 * lo que le permite ofrecer la vuelta de nuevo.
 */
export function peekPending(storage: KeyValueStorage): PendingPayment | undefined {
  return parsePending(storage.getItem(PENDING_STORAGE_KEY));
}

/**
 * Borra el pago pendiente si sigue siendo el mismo. Mientras se consultaba, el pagador pudo
 * empezar otro cobro desde la misma página, y ese no se borra.
 */
export function forgetPending(storage: KeyValueStorage, pending: PendingPayment): void {
  if (peekPending(storage)?.gatewayTransactionId === pending.gatewayTransactionId) {
    storage.removeItem(PENDING_STORAGE_KEY);
  }
}

/**
 * Consulta el pago pendiente y lo olvida solo con un estado final. Si sigue pendiente queda
 * guardado, y «Ya pagué: consultar el estado» lo puede volver a consultar.
 */
export async function queryPending(
  api: KitPagosApi,
  storage: KeyValueStorage,
  pending: PendingPayment,
  poll: PollOptions = DEFAULT_POLL,
): Promise<CheckoutStep> {
  const step = await pollUntilFinal(api, pending, poll);
  if (step.kind === "final") {
    forgetPending(storage, pending);
  }
  return step;
}

/** Si la página ofrece consultar el estado de nuevo: mientras el pago no tenga estado final. */
export function offersStatusQuery(step: CheckoutStep): boolean {
  return step.kind !== "final";
}

function parsePending(raw: string | null): PendingPayment | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingPayment>;
    if (
      parsed.gateway &&
      parsed.gatewayTransactionId &&
      parsed.orderReference &&
      (parsed.method === "PSE" || parsed.method === "CARD")
    ) {
      return parsed as PendingPayment;
    }
  } catch {
    // Un valor corrupto se trata como si no hubiera pago pendiente.
  }
  return undefined;
}

export function describeOutcome(step: CheckoutStep): string {
  if (step.kind === "redirect") {
    return "La pasarela pide redirigir al pagador para completar el pago.";
  }
  const { status, rawStatus, rejectionReason } = step.transaction;
  const reason = rejectionReason
    ? ` Motivo: ${rejectionReason.rejectionCode} (categoría ${rejectionReason.rejectionCategory}).`
    : "";
  if (step.kind === "pending") {
    return `El pago sigue pendiente (${status}, nativo ${rawStatus}). Consulte de nuevo más tarde.`;
  }
  return `Estado final: ${status} (nativo ${rawStatus}).${reason}`;
}
