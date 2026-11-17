import Fastify from "fastify";
import { describeUrl, disableTrace, enableTrace, trace, traceIncomingRequests, traceOutgoingCalls } from "../src/trace";

describe("trace: what happens underneath the checkout, without keys or bodies", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    enableTrace((line) => lines.push(line));
  });

  afterEach(() => {
    disableTrace();
  });

  it("should stay silent until server.ts turns it on", () => {
    disableTrace();
    trace("nada");

    expect(lines).toEqual([]);
  });

  it("should show the host and path, without the query and with every key covered", () => {
    expect(describeUrl("https://sandbox.example/v1/merchants/pub_test_AbC123xyz?public_key=pub_test_AbC123xyz")).toBe(
      "sandbox.example/v1/merchants/pub_test_…",
    );
    expect(describeUrl("https://api.example/v1/card_tokens/APP_USR-1234-5678-abcd")).toBe("api.example/v1/card_tokens/APP_USR-…");
    expect(describeUrl("https://api.example/v1/keys/prv_prod_Zz9")).toBe("api.example/v1/keys/prv_prod_…");
  });

  describe("outgoing calls", () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    it("should write one line per call, with the status code, the native status and the time", async () => {
      globalThis.fetch = jest.fn(async () =>
        new Response(JSON.stringify({ data: { id: "tx-1", status: "PENDING" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
      const restore = traceOutgoingCalls();

      const response = await fetch("https://sandbox.example/v1/transactions?secret=1", {
        method: "POST",
        headers: { Authorization: "Bearer prv_test_NoSeVe" },
        body: '{"card":"4242"}',
      });
      restore();

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ data: { id: "tx-1", status: "PENDING" } });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[checkout\] {3}tienda → pasarela {2}POST sandbox\.example\/v1\/transactions → 201 · estado PENDING · \d+ ms$/);
      expect(lines[0]).not.toMatch(/NoSeVe|4242|secret/);
    });

    it("should say when the call got no answer, and still fail", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("ECONNREFUSED");
      });
      const restore = traceOutgoingCalls();

      await expect(fetch("https://sandbox.example/v1/transactions")).rejects.toThrow("ECONNREFUSED");
      restore();

      expect(lines[0]).toContain("GET sandbox.example/v1/transactions → sin respuesta: ECONNREFUSED");
    });
  });

  it("should trace the page's API and the webhooks, but not the static files", async () => {
    const app = Fastify({ logger: false });
    traceIncomingRequests(app);
    app.post("/api/orders", async (_request, reply) => reply.code(201).send({}));
    app.post("/webhooks", async () => ({ received: true }));
    app.get("/assets/checkout.js", async () => "");

    await app.inject({ method: "POST", url: "/api/orders?x=1" });
    await app.inject({ method: "POST", url: "/webhooks" });
    await app.inject({ method: "GET", url: "/assets/checkout.js" });
    await app.close();

    expect(lines[0]).toBe("[checkout] navegador → tienda  POST /api/orders");
    expect(lines[1]).toMatch(/^\[checkout\] navegador ← tienda {2}POST \/api\/orders → 201 · \d+ ms$/);
    expect(lines[2]).toBe("[checkout] pasarela → tienda   POST /webhooks");
    expect(lines[3]).toMatch(/^\[checkout\] pasarela ← tienda {3}POST \/webhooks → 200 · \d+ ms$/);
    expect(lines).toHaveLength(4);
  });
});
