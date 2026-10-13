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

/** Lo que hay que recordar mientras el pagador está en el banco o en el checkout alojado. */
export interface PendingPayment {
  gateway: string;
  gatewayTransactionId: string;
  orderReference: string;
}

export type CheckoutStep =
  | { kind: "redirect"; redirectUrl: string; pending: PendingPayment }
  | { kind: "final"; transaction: TransactionView }
  | { kind: "pending"; transaction: TransactionView };

export interface PollOptions {
  maxAttempts: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
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
  let transaction = await api.getPaymentStatus(pending.gateway, pending.gatewayTransactionId);
  for (let attempt = 1; !transaction.isFinal && attempt < options.maxAttempts; attempt += 1) {
    await options.sleep(options.intervalMs);
    transaction = await api.getPaymentStatus(pending.gateway, pending.gatewayTransactionId);
  }
  return transaction.isFinal ? { kind: "final", transaction } : { kind: "pending", transaction };
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
  tokenizationEnvironment: string;
}

/**
 * Tokeniza en el navegador y cobra con el token. La tarjeta solo entra en `tokenizeCard()`,
 * que la manda a la ruta de tokenización de la pasarela; a `/v1/api` llega el token.
 *
 * Qué pasarelas tokenizan en el navegador lo decide `KitPagosBrowser`: con las demás lanza
 * `UNSUPPORTED_OPERATION` antes de enviar nada, y el error sube tal cual.
 */
export async function payWithCard(
  deps: CardDependencies,
  order: Order,
  card: CardInput,
  poll: PollOptions = DEFAULT_POLL,
): Promise<CheckoutStep> {
  const tokenizer = await deps.loadTokenizer();
  const { token } = await tokenizer.tokenizeCard({
    gateway: order.gateway,
    publicKey: deps.publicKeys[order.gateway] ?? "",
    environment: deps.tokenizationEnvironment,
    card,
  });
  return startPayment(deps.api, order, { type: "CARD", token, installments: 1 }, poll);
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

/** Lee y borra el pago pendiente: una recarga de la página de retorno no lo vuelve a consultar. */
export function takePending(storage: KeyValueStorage): PendingPayment | undefined {
  const raw = storage.getItem(PENDING_STORAGE_KEY);
  storage.removeItem(PENDING_STORAGE_KEY);
  return parsePending(raw);
}

function parsePending(raw: string | null): PendingPayment | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingPayment>;
    if (parsed.gateway && parsed.gatewayTransactionId && parsed.orderReference) {
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
  const reason = rejectionReason?.message ? ` Motivo: ${rejectionReason.message}.` : "";
  if (step.kind === "pending") {
    return `El pago sigue pendiente (${status}, nativo ${rawStatus}). Consulte de nuevo más tarde.`;
  }
  return `Estado final: ${status} (nativo ${rawStatus}).${reason}`;
}
