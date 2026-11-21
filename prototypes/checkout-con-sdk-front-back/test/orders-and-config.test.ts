import { loadCheckoutConfig } from "../src/config";
import { captureBackendCalls } from "../src/orders/backendTrace";
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

  it("should create a pending order with a unique id, creation date and an empty history", () => {
    const store = new OrderStore(fixedNow);

    const first = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "CARD" });
    const second = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "PSE" });

    expect(first.id).toMatch(/^ORD-[0-9A-F]{8}$/);
    expect(first.createdAt).toBe("2026-10-13T12:00:00.000Z");
    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe("PENDING");
    expect(first.history).toEqual([]);
  });

  it("should list orders from newest to oldest and empty when there are none", () => {
    let seconds = 0;
    const store = new OrderStore(() => new Date(Date.UTC(2026, 9, 13, 12, 0, seconds++)));

    expect(store.list()).toEqual([]);

    const first = store.create({ gateway: "token-pay", lines: [], amountInPesos: 1000, payer, method: "CARD" });
    const second = store.create({ gateway: "hosted-pay", lines: [], amountInPesos: 2000, payer, method: "PSE" });

    expect(store.list().map((order) => order.id)).toEqual([second.id, first.id]);
    expect(second.createdAt).toBe("2026-10-13T12:00:01.000Z");
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

describe("captureBackendCalls", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should capture external gateway calls with masked keys, status and native status without disturbing outside calls", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "PENDING" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "failed" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }))
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce(new Response("outside", { status: 200 }));
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const okRun = await captureBackendCalls(async () => {
      await fetch("https://sandbox.example.co/v1/merchants/pub_test_secreto123?foo=bar");
      await fetch(new URL("https://sandbox.example.co/v1/orders"), { method: "POST" });
      await fetch(new Request("https://sandbox.example.co/health", { method: "HEAD" }));
      await fetch("https://sandbox.example.co/broken-json");
      return "done";
    });

    expect(okRun.result).toBe("done");
    expect(okRun.error).toBeUndefined();
    expect(okRun.steps).toHaveLength(4);
    expect(okRun.steps[0]).toMatchObject({
      stage: "sandbox",
      level: "ok",
      label: "GET sandbox.example.co/v1/merchants/pub_test_…",
      detail: "HTTP 201 · nativo PENDING",
    });
    expect(okRun.steps[1]).toMatchObject({
      stage: "sandbox",
      level: "warn",
      label: "POST sandbox.example.co/v1/orders",
      detail: "HTTP 422 · nativo failed",
    });
    expect(okRun.steps[2]).toMatchObject({
      stage: "sandbox",
      level: "ok",
      label: "HEAD sandbox.example.co/health",
      detail: "HTTP 200",
    });
    expect(okRun.steps[3]).toMatchObject({
      stage: "sandbox",
      level: "ok",
      label: "GET sandbox.example.co/broken-json",
      detail: "HTTP 200",
    });

    const failedRun = await captureBackendCalls(async () => {
      await fetch("https://sandbox.example.co/v1/pay", { method: "POST" });
    });

    expect(failedRun.result).toBeUndefined();
    expect((failedRun.error as Error).message).toBe("connect ECONNREFUSED");
    expect(failedRun.steps[0]).toMatchObject({
      stage: "sandbox",
      level: "error",
      label: "POST sandbox.example.co/v1/pay",
      detail: "Error de red: connect ECONNREFUSED",
    });

    // Global fetch is restored once all active captures end.
    expect(globalThis.fetch).toBe(mockFetch);
    const outsideRes = await fetch("https://sandbox.example.co/outside");
    expect(await outsideRes.text()).toBe("outside");
  });
});
