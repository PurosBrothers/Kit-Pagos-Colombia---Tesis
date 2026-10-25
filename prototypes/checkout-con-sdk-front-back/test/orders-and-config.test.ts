import { loadCheckoutConfig } from "../src/config";
import { OrderStore } from "../src/orders/OrderStore";
import { formatPesos } from "../src/views/pages";

const payer = {
  fullName: "Ana Gómez",
  email: "ana@example.com",
  documentType: "CC" as const,
  documentNumber: "52000000",
  phone: "3100000000",
  address: { streetName: "Calle 10", streetNumber: "5-20", neighborhood: "La Candelaria", city: "Bogotá", zipCode: "111711" },
};

describe("OrderStore", () => {
  const fixedNow = () => new Date("2026-10-13T12:00:00.000Z");

  it("should create a pending order with a unique id and an empty history", () => {
    const store = new OrderStore(fixedNow);

    const first = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "CARD" });
    const second = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "PSE" });

    expect(first.id).toMatch(/^ORD-[0-9A-F]{8}$/);
    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe("PENDING");
    expect(first.history).toEqual([]);
  });

  it("should find an order by the transaction id recorded on it", () => {
    const store = new OrderStore(fixedNow);
    const order = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "CARD" });

    store.record(order, { source: "creation", status: "PENDING", nativeStatus: "PENDING" }, "tx-9");

    expect(store.findByTransactionId("token-pay", "tx-9")).toBe(order);
    expect(store.findByTransactionId("token-pay", "tx-other")).toBeUndefined();
    // El identificador es de la pasarela: el mismo en otra pasarela es otra transacción.
    expect(store.findByTransactionId("hosted-pay", "tx-9")).toBeUndefined();
    expect(order.history[0].at).toBe("2026-10-13T12:00:00.000Z");
  });

  it.each(["APPROVED", "DECLINED"] as const)(
    "should keep a %s order when a pending notice arrives after it, and still record the notice",
    (outcome) => {
      const store = new OrderStore(fixedNow);
      const order = store.create({ gateway: "hosted-pay", lines: [], amountInPesos: 1000, payer, method: "CARD" });
      store.record(order, { source: "webhook", status: outcome, nativeStatus: "FINAL" });

      store.record(order, { source: "webhook", status: "PENDING", nativeStatus: "ACT" });

      expect(order.status).toBe(outcome);
      expect(order.history.map((entry) => entry.nativeStatus)).toEqual(["FINAL", "ACT"]);
    },
  );

  it("should find an order by its reference only for its own gateway", () => {
    const store = new OrderStore(fixedNow);
    const order = store.create({ gateway: "hosted-pay", lines: [], amountInPesos: 1000, payer, method: "CARD" });

    expect(store.findByReference("hosted-pay", order.id)).toBe(order);
    expect(store.findByReference("token-pay", order.id)).toBeUndefined();
    expect(store.findByReference("hosted-pay", "ORD-OTRA")).toBeUndefined();
  });

  it("should record a webhook that repeats the last status, but not a query that does", () => {
    const store = new OrderStore(fixedNow);
    const order = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "CARD" });

    store.record(order, { source: "creation", status: "APPROVED", nativeStatus: "APPROVED" });
    store.record(order, { source: "query", status: "APPROVED", nativeStatus: "APPROVED" });
    store.record(order, { source: "webhook", status: "APPROVED", nativeStatus: "APPROVED" });

    expect(order.history.map((entry) => entry.source)).toEqual(["creation", "webhook"]);
  });

  it("should record a query whose native status changed even if the merchant status did not", () => {
    const store = new OrderStore(fixedNow);
    const order = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "PSE" });

    store.record(order, { source: "creation", status: "PENDING", nativeStatus: "PENDING" });
    store.record(order, { source: "query", status: "PENDING", nativeStatus: "IN_PROCESS" });

    expect(order.history).toHaveLength(2);
  });

  it("should keep the decline reason when a later decline, such as a webhook, brings none", () => {
    const store = new OrderStore(fixedNow);
    const order = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "CARD" });
    const declineReason = { code: "021", category: "INSUFFICIENT_FUNDS" } as const;

    store.record(order, { source: "creation", status: "DECLINED", nativeStatus: "DECLINED", declineReason });
    store.record(order, { source: "webhook", status: "DECLINED", nativeStatus: "DECLINED" });

    expect(order.declineReason).toEqual(declineReason);
  });

  it("should drop the decline reason when the order stops being declined", () => {
    const store = new OrderStore(fixedNow);
    const order = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "PSE" });

    store.record(order, {
      source: "query",
      status: "DECLINED",
      nativeStatus: "declinedTransaction",
      declineReason: { code: "00011", category: "INSUFFICIENT_FUNDS" },
    });
    store.record(order, { source: "webhook", status: "APPROVED", nativeStatus: "approvedTransaction" });

    expect(order.declineReason).toBeUndefined();
  });
});

describe("loadCheckoutConfig", () => {
  it("should default to port 4000 and a localtest.me public URL, which resolves to this machine", () => {
    expect(loadCheckoutConfig({})).toEqual({ port: 4000, publicBaseUrl: "http://localtest.me:4000" });
  });

  it("should keep the default public URL on the configured port", () => {
    expect(loadCheckoutConfig({ PORT: "4100" }).publicBaseUrl).toBe("http://localtest.me:4100");
  });

  it("should take PORT and PUBLIC_BASE_URL, without a trailing slash", () => {
    expect(loadCheckoutConfig({ PORT: "4100", PUBLIC_BASE_URL: "https://tienda.example/" })).toEqual({
      port: 4100,
      publicBaseUrl: "https://tienda.example",
    });
  });

  it("should ignore a PORT that is not a positive integer", () => {
    expect(loadCheckoutConfig({ PORT: "abc" }).port).toBe(4000);
  });
});

describe("formatPesos", () => {
  it("should format whole pesos for Colombia", () => {
    expect(formatPesos(50000)).toMatch(/^\$50.000 COP$/);
  });
});
