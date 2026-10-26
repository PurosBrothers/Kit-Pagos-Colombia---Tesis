import { randomUUID } from "node:crypto";

export type OrderStatus = "APPROVED" | "DECLINED" | "PENDING" | "ERROR";
export type StatusSource = "creation" | "query" | "webhook";

/** El motivo de un rechazo, con los nombres del `RejectionReason` del SDK. */
export interface RejectionInfo {
  rejectionCode: string;
  rejectionCategory: string;
}

export interface StatusRecord {
  at: string;
  source: StatusSource;
  status: OrderStatus;
  nativeStatus?: string;
  detail?: string;
  rejectionReason?: RejectionInfo;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface PayerInfo {
  fullName: string;
  email: string;
  documentType: string;
  documentNumber: string;
  phone: string;
  streetName?: string;
  streetNumber?: string;
  neighborhood?: string;
  city?: string;
  zipCode?: string;
}

export interface Order {
  id: string;
  gateway: string;
  items: OrderItem[];
  amountInPesos: number;
  payer: PayerInfo;
  method: "CARD" | "PSE";
  transactionId?: string;
  redirectUrl?: string;
  status: OrderStatus;
  /** El motivo del rechazo, mientras la orden esté rechazada y alguna respuesta lo haya traído. */
  rejectionReason?: RejectionInfo;
  history: StatusRecord[];
  createdAt: string;
}

export interface NewOrderInput {
  gateway: string;
  items: OrderItem[];
  amountInPesos: number;
  payer: PayerInfo;
  method: "CARD" | "PSE";
}

export class OrderStore {
  private readonly orders = new Map<string, Order>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  create(input: NewOrderInput): Order {
    const order: Order = {
      ...input,
      id: `MATE-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "PENDING",
      history: [
        {
          at: this.now().toISOString(),
          source: "creation",
          status: "PENDING",
          detail: "Orden creada en el comercio",
        },
      ],
      createdAt: this.now().toISOString(),
    };
    this.orders.set(order.id, order);
    return order;
  }

  get(id: string): Order | undefined {
    return this.orders.get(id);
  }

  /** El identificador de la transacción es de la pasarela: dos pasarelas podrían repetirlo. */
  findByTransactionId(transactionId: string, gateway?: string): Order | undefined {
    return [...this.orders.values()].find(
      (order) => order.transactionId === transactionId && (gateway === undefined || order.gateway === gateway),
    );
  }

  /**
   * La referencia que el comercio manda a la pasarela es el id de la orden. Sirve cuando el webhook
   * trae otro identificador: la tarjeta de Rapyd se crea como checkout y su aviso trae el del pago
   * (punto 118).
   */
  findByReference(reference: string, gateway?: string): Order | undefined {
    const order = this.orders.get(reference);
    return order && (gateway === undefined || order.gateway === gateway) ? order : undefined;
  }

  /**
   * Cambia el estado y deja la entrada en el historial.
   *
   * Un `PENDING` que llega cuando la orden ya está aprobada o rechazada queda en el historial sin
   * cambiar el estado: las pasarelas no garantizan el orden de sus avisos, y Rapyd manda dos en el
   * mismo segundo, uno todavía pendiente y otro con el desenlace. Un rechazo sin motivo, como el de
   * un webhook, no borra el que trajo la creación o la consulta.
   */
  record(
    order: Order,
    entry: Omit<StatusRecord, "at">,
    extra?: { transactionId?: string; redirectUrl?: string },
  ): void {
    if (extra?.transactionId) order.transactionId = extra.transactionId;
    if (extra?.redirectUrl) order.redirectUrl = extra.redirectUrl;

    const late = entry.status === "PENDING" && (order.status === "APPROVED" || order.status === "DECLINED");
    if (!late) {
      order.status = entry.status;
      order.rejectionReason = entry.status === "DECLINED" ? (entry.rejectionReason ?? order.rejectionReason) : undefined;
    }
    order.history.push({
      at: this.now().toISOString(),
      ...entry,
      ...(late ? { detail: `${entry.detail ?? ""} (llegó después del desenlace; la orden sigue ${order.status})`.trim() } : {}),
    });
  }

  all(): Order[] {
    return [...this.orders.values()];
  }
}
