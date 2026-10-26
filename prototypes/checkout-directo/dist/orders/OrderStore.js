"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderStore = void 0;
const node_crypto_1 = require("node:crypto");
/** Las órdenes del comercio, en memoria: el prototipo no necesita persistencia. */
class OrderStore {
    constructor(now = () => new Date()) {
        this.now = now;
        this.orders = new Map();
    }
    create(input) {
        const order = {
            ...input,
            id: `ORD-${(0, node_crypto_1.randomUUID)().slice(0, 8).toUpperCase()}`,
            status: "PENDING",
            history: [],
        };
        this.orders.set(order.id, order);
        return order;
    }
    get(id) {
        return this.orders.get(id);
    }
    findByTransactionId(transactionId) {
        return [...this.orders.values()].find((order) => order.transactionId === transactionId);
    }
    /**
     * Cambia el estado y deja la entrada en el historial. Una consulta que repite el estado y el
     * estado nativo anteriores no agrega nada, para que el historial muestre solo cambios.
     */
    record(order, entry, transactionId) {
        if (transactionId)
            order.transactionId = transactionId;
        const last = order.history[order.history.length - 1];
        const repeated = entry.source === "query" &&
            last !== undefined &&
            last.status === entry.status &&
            last.nativeStatus === entry.nativeStatus;
        order.status = entry.status;
        if (!repeated)
            order.history.push({ at: this.now().toISOString(), ...entry });
    }
}
exports.OrderStore = OrderStore;
