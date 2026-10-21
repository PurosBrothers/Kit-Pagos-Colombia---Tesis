import { randomUUID } from "node:crypto";

export type OrderStatus = "APPROVED" | "DECLINED" | "PENDING" | "ERROR";
export type StatusSource = "creation" | "query" | "webhook";

export interface StatusRecord {
  at: string;
  source: StatusSource;
  status: OrderStatus;
  nativeStatus?: string;
  detail?: string;
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

  findByTransactionId(transactionId: string): Order | undefined {
    return [...this.orders.values()].find((order) => order.transactionId === transactionId);
  }

  record(
    order: Order,
    entry: Omit<StatusRecord, "at">,
    extra?: { transactionId?: string; redirectUrl?: string },
  ): void {
    if (extra?.transactionId) order.transactionId = extra.transactionId;
    if (extra?.redirectUrl) order.redirectUrl = extra.redirectUrl;

    order.status = entry.status;
    order.history.push({
      at: this.now().toISOString(),
      ...entry,
    });
  }

  all(): Order[] {
    return [...this.orders.values()];
  }
}
