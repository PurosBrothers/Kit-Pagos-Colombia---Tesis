import { randomUUID } from "node:crypto";
import { OrderLine } from "../catalog";
import { MerchantPaymentStatus, Payer, PaymentMethodRequest } from "../checkout/PaymentsPort";
import { trace } from "../trace";

/** `ERROR`: un fallo técnico que siguió después de reintentar; el pago no se decidió. */
export type OrderStatus = MerchantPaymentStatus | "ERROR";

export type StatusSource = "creation" | "query" | "webhook";

const SOURCE_WORDS: Record<StatusSource, string> = { creation: "creación", query: "consulta", webhook: "webhook" };

/** Una entrada del historial: guarda el estado nativo para auditoría (función 6). */
export interface StatusRecord {
  at: string;
  source: StatusSource;
  status: OrderStatus;
  nativeStatus?: string;
  detail?: string;
}

export interface Order {
  id: string;
  /** El `id` de la pasarela que eligió el comprador, tal como lo dio `listGateways()`. */
  gateway: string;
  lines: OrderLine[];
  amountInPesos: number;
  payer: Payer;
  method: PaymentMethodRequest["type"];
  transactionId?: string;
  status: OrderStatus;
  history: StatusRecord[];
}

export interface NewOrder {
  gateway: string;
  lines: OrderLine[];
  amountInPesos: number;
  payer: Payer;
  method: PaymentMethodRequest["type"];
}

/** Las órdenes del comercio, en memoria: el prototipo no necesita persistencia. */
export class OrderStore {
  private readonly orders = new Map<string, Order>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  create(input: NewOrder): Order {
    const order: Order = {
      ...input,
      id: `ORD-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "PENDING",
      history: [],
    };
    this.orders.set(order.id, order);
    return order;
  }

  get(id: string): Order | undefined {
    return this.orders.get(id);
  }

  /** El identificador de la transacción es de la pasarela: dos pasarelas podrían repetirlo. */
  findByTransactionId(gateway: string, transactionId: string): Order | undefined {
    return [...this.orders.values()].find(
      (order) => order.gateway === gateway && order.transactionId === transactionId,
    );
  }

  /**
   * Cambia el estado y deja la entrada en el historial. Una consulta que repite el estado y el
   * estado nativo anteriores no agrega nada, para que el historial muestre solo cambios.
   */
  record(order: Order, entry: Omit<StatusRecord, "at">, transactionId?: string): void {
    if (transactionId) order.transactionId = transactionId;
    const last = order.history[order.history.length - 1];
    const repeated =
      entry.source === "query" &&
      last !== undefined &&
      last.status === entry.status &&
      last.nativeStatus === entry.nativeStatus;
    order.status = entry.status;
    if (!repeated) order.history.push({ at: this.now().toISOString(), ...entry });
    trace(
      `  orden ${order.id} ← ${SOURCE_WORDS[entry.source]}: ${entry.status}` +
        `${entry.nativeStatus ? ` (nativo ${entry.nativeStatus})` : ""}` +
        `${transactionId ? `, transacción ${transactionId}` : ""}` +
        `${entry.detail ? ` · ${entry.detail}` : ""}${repeated ? " (sin cambios)" : ""}`,
    );
  }
}
