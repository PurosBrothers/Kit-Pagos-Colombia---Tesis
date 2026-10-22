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

  /** La referencia que el checkout manda a la pasarela es el id de la orden, y la pasarela tiene que ser la suya. */
  findByReference(gateway: string, reference: string): Order | undefined {
    const order = this.orders.get(reference);
    return order?.gateway === gateway ? order : undefined;
  }

  /**
   * Cambia el estado y deja la entrada en el historial. Una consulta que repite el estado y el
   * estado nativo anteriores no agrega nada, para que el historial muestre solo cambios.
   *
   * Un `PENDING` que llega cuando la orden ya está aprobada o rechazada queda en el historial sin
   * cambiar el estado: las pasarelas no garantizan el orden de sus avisos, y hay una que manda dos
   * en el mismo segundo, uno todavía pendiente y otro con el desenlace.
   */
  record(order: Order, entry: Omit<StatusRecord, "at">, transactionId?: string): void {
    if (transactionId) order.transactionId = transactionId;
    const last = order.history[order.history.length - 1];
    const repeated =
      entry.source === "query" &&
      last !== undefined &&
      last.status === entry.status &&
      last.nativeStatus === entry.nativeStatus;
    const late = entry.status === "PENDING" && (order.status === "APPROVED" || order.status === "DECLINED");
    if (!late) order.status = entry.status;
    if (!repeated) order.history.push({ at: this.now().toISOString(), ...entry });
    trace(
      `  orden ${order.id} ← ${SOURCE_WORDS[entry.source]}: ${entry.status}` +
        `${entry.nativeStatus ? ` (nativo ${entry.nativeStatus})` : ""}` +
        `${transactionId ? `, transacción ${transactionId}` : ""}` +
        `${entry.detail ? ` · ${entry.detail}` : ""}${repeated ? " (sin cambios)" : ""}` +
        `${late ? ` (llegó después del desenlace; la orden sigue ${order.status})` : ""}`,
    );
  }
}
