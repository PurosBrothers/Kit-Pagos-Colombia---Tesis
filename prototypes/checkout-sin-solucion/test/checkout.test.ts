import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { PRODUCT } from "../src/catalog";
import { PaymentTechnicalError, PaymentsPort } from "../src/checkout/PaymentsPort";
import { OrderStore } from "../src/orders/OrderStore";
import { fakePayments } from "./helpers/fakePayments";

const BASE_URL = "http://checkout.test";

const payer = {
  fullName: "Pedro Pérez",
  email: "pedro@example.com",
  documentType: "CC",
  documentNumber: "1020304050",
  phone: "3001234567",
};

const card = { type: "CARD", cardToken: "tok_fake", installments: 1 };
const pse = { type: "PSE", bankCode: "1007", personType: "NATURAL" };

describe("checkout skeleton", () => {
  let payments: jest.Mocked<PaymentsPort>;
  let orders: OrderStore;
  let app: FastifyInstance;

  beforeEach(() => {
    payments = fakePayments();
    orders = new OrderStore();
    app = buildApp({ payments, publicBaseUrl: BASE_URL, orders });
  });

  afterEach(async () => {
    await app.close();
  });

  const createOrder = (method: object) =>
    app.inject({ method: "POST", url: "/api/orders", payload: { payer, method } });

  describe("pages", () => {
    it("should show the product with the card and PSE forms", async () => {
      const res = await app.inject({ method: "GET", url: "/" });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain(PRODUCT.name);
      expect(res.body).toContain('id="card-fields"');
      expect(res.body).toContain('id="pse-fields"');
      expect(res.body).toContain('src="/assets/checkout.js"');
    });

    it("should show an order with its native status history", async () => {
      const created = (await createOrder(card)).json().order;

      const res = await app.inject({ method: "GET", url: `/orders/${created.id}` });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(created.id);
      expect(res.body).toContain("Aprobado");
      expect(res.body).toContain("tx-card-1");
    });

    it("should escape the payer data it shows", async () => {
      payments.createPayment.mockResolvedValueOnce({
        transactionId: "<script>",
        status: "PENDING",
        nativeStatus: "<b>raw</b>",
      });
      const created = (await createOrder(card)).json().order;

      const res = await app.inject({ method: "GET", url: `/orders/${created.id}` });

      expect(res.body).not.toContain("<script>alert");
      expect(res.body).toContain("&lt;script&gt;");
      expect(res.body).toContain("&lt;b&gt;raw&lt;/b&gt;");
    });

    it("should answer 404 for an unknown order page", async () => {
      const res = await app.inject({ method: "GET", url: "/orders/ORD-NOPE" });

      expect(res.statusCode).toBe(404);
      expect(res.body).toContain("Orden no encontrada");
    });
  });

  describe("POST /api/orders", () => {
    it("should charge the catalog price in whole pesos, with the order as reference and its page as return URL", async () => {
      const res = await createOrder(card);

      expect(res.statusCode).toBe(201);
      const { order } = res.json();
      expect(payments.createPayment).toHaveBeenCalledWith({
        orderReference: order.id,
        amountInPesos: PRODUCT.priceInPesos,
        description: PRODUCT.name,
        payer,
        method: card,
        returnUrl: `${BASE_URL}/orders/${order.id}`,
      });
    });

    it("should store the merchant status, the transaction and the native status of a card payment", async () => {
      const { order } = (await createOrder(card)).json();

      expect(order.status).toBe("APPROVED");
      expect(order.transactionId).toBe("tx-card-1");
      expect(order.history).toEqual([
        expect.objectContaining({ source: "creation", status: "APPROVED", nativeStatus: "APPROVED" }),
      ]);
    });

    it("should hand the bank URL of a PSE payment back to the page", async () => {
      const res = await createOrder(pse);

      expect(res.statusCode).toBe(201);
      expect(res.json().redirectUrl).toBe("https://bank.example/pay");
      expect(res.json().order.status).toBe("PENDING");
    });

    it("should keep a business rejection as DECLINED, not as an error", async () => {
      payments.createPayment.mockResolvedValueOnce({ transactionId: "tx-2", status: "DECLINED", nativeStatus: "DECLINED" });

      const res = await createOrder(card);

      expect(res.statusCode).toBe(201);
      expect(res.json().order.status).toBe("DECLINED");
    });

    it("should mark the order ERROR and answer 502 on a technical failure that survived the retries", async () => {
      payments.createPayment.mockRejectedValueOnce(new PaymentTechnicalError("La pasarela no respondió"));

      const res = await createOrder(card);

      expect(res.statusCode).toBe(502);
      expect(res.json().order.status).toBe("ERROR");
      expect(res.json().order.history[0]).toEqual(
        expect.objectContaining({ source: "creation", status: "ERROR", detail: "La pasarela no respondió" }),
      );
    });

    it("should answer 500 for an error that is not a technical failure", async () => {
      payments.createPayment.mockRejectedValueOnce(new Error("defecto del módulo"));

      const res = await createOrder(card);

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("defecto del módulo");
    });

    it.each([
      ["a payer without email", { payer: { ...payer, email: "" }, method: card }],
      ["an unknown method", { payer, method: { type: "CASH" } }],
      ["a card without token", { payer, method: { type: "CARD", installments: 1 } }],
      ["a PSE payment without bank", { payer, method: { type: "PSE", personType: "NATURAL" } }],
    ])("should reject %s with 400 without calling the gateway", async (_case, payload) => {
      const res = await app.inject({ method: "POST", url: "/api/orders", payload });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/^Petición inválida/);
      expect(payments.createPayment).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/orders/:id", () => {
    it("should ask the gateway for the status and record the change", async () => {
      const { order } = (await createOrder(pse)).json();

      const res = await app.inject({ method: "GET", url: `/api/orders/${order.id}` });

      expect(res.statusCode).toBe(200);
      expect(payments.getPaymentStatus).toHaveBeenCalledWith("tx-pse-1");
      expect(res.json().order.status).toBe("APPROVED");
      expect(res.json().order.history.map((entry: { source: string }) => entry.source)).toEqual(["creation", "query"]);
    });

    it("should not add a history entry when a query repeats the last status", async () => {
      const { order } = (await createOrder(card)).json();

      await app.inject({ method: "GET", url: `/api/orders/${order.id}` });
      const res = await app.inject({ method: "GET", url: `/api/orders/${order.id}` });

      expect(res.json().order.history).toHaveLength(1);
    });

    it("should keep the last status and answer 502 when the query fails technically", async () => {
      const { order } = (await createOrder(pse)).json();
      payments.getPaymentStatus.mockRejectedValueOnce(new PaymentTechnicalError("timeout"));

      const res = await app.inject({ method: "GET", url: `/api/orders/${order.id}` });

      expect(res.statusCode).toBe(502);
      expect(res.json().order.status).toBe("PENDING");
    });

    it("should not query the gateway for an order whose payment was never created", async () => {
      payments.createPayment.mockRejectedValueOnce(new PaymentTechnicalError("caída"));
      const { order } = (await createOrder(card)).json();

      const res = await app.inject({ method: "GET", url: `/api/orders/${order.id}` });

      expect(res.statusCode).toBe(200);
      expect(payments.getPaymentStatus).not.toHaveBeenCalled();
    });

    it("should answer 404 for an unknown order", async () => {
      const res = await app.inject({ method: "GET", url: "/api/orders/ORD-NOPE" });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/pse-banks and /api/payments/config", () => {
    it("should list the banks of the payments module", async () => {
      const res = await app.inject({ method: "GET", url: "/api/pse-banks" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ banks: [{ code: "1007", name: "Bancolombia" }] });
    });

    it("should answer 502 when the bank list fails technically", async () => {
      payments.listPseBanks.mockRejectedValueOnce(new PaymentTechnicalError("caída"));

      const res = await app.inject({ method: "GET", url: "/api/pse-banks" });

      expect(res.statusCode).toBe(502);
    });

    it("should answer 500 when the bank list fails for another reason", async () => {
      payments.listPseBanks.mockRejectedValueOnce(new Error("defecto"));

      const res = await app.inject({ method: "GET", url: "/api/pse-banks" });

      expect(res.statusCode).toBe(500);
    });

    it("should give the browser the public configuration of the payments module", async () => {
      const res = await app.inject({ method: "GET", url: "/api/payments/config" });

      expect(res.json()).toEqual({ publicKey: "pub_fake" });
    });
  });

  describe("POST /webhooks", () => {
    const rawBody = '{"event":"transaction.updated",  "data": {"id":"tx-card-1"}}';

    it("should hand the module the body byte for byte, the headers and the query", async () => {
      await app.inject({
        method: "POST",
        url: "/webhooks?data.id=tx-card-1&type=payment",
        headers: { "content-type": "application/json", "x-signature": "ts=1,v1=abc" },
        payload: rawBody,
      });

      const [webhook] = payments.verifyWebhook.mock.calls[0];
      expect(webhook.rawBody).toBe(rawBody);
      expect(webhook.headers["x-signature"]).toBe("ts=1,v1=abc");
      expect(webhook.query).toEqual({ "data.id": "tx-card-1", type: "payment" });
    });

    it("should update the order of a verified webhook", async () => {
      payments.createPayment.mockResolvedValueOnce({ transactionId: "tx-card-1", status: "PENDING", nativeStatus: "PENDING" });
      const { order } = (await createOrder(card)).json();

      const res = await app.inject({ method: "POST", url: "/webhooks", payload: rawBody, headers: { "content-type": "application/json" } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true, matched: true });
      const updated = orders.get(order.id);
      expect(updated?.status).toBe("APPROVED");
      expect(updated?.history.map((entry) => entry.source)).toEqual(["creation", "webhook"]);
    });

    it("should answer 401 and change nothing when the signature is invalid", async () => {
      payments.createPayment.mockResolvedValueOnce({ transactionId: "tx-card-1", status: "PENDING", nativeStatus: "PENDING" });
      const { order } = (await createOrder(card)).json();
      payments.verifyWebhook.mockResolvedValueOnce(null);

      const res = await app.inject({ method: "POST", url: "/webhooks", payload: rawBody, headers: { "content-type": "application/json" } });

      expect(res.statusCode).toBe(401);
      expect(orders.get(order.id)?.status).toBe("PENDING");
    });

    it("should acknowledge a verified webhook of an unknown transaction", async () => {
      const res = await app.inject({ method: "POST", url: "/webhooks", payload: rawBody, headers: { "content-type": "text/plain" } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true, matched: false });
    });

    it("should answer 502 so the gateway retries when the module fails technically", async () => {
      payments.verifyWebhook.mockRejectedValueOnce(new PaymentTechnicalError("segunda petición caída"));

      const res = await app.inject({ method: "POST", url: "/webhooks", payload: rawBody, headers: { "content-type": "application/json" } });

      expect(res.statusCode).toBe(502);
    });

    it("should answer 500 when the module fails for another reason", async () => {
      payments.verifyWebhook.mockRejectedValueOnce(new Error("defecto"));

      const res = await app.inject({ method: "POST", url: "/webhooks", payload: rawBody, headers: { "content-type": "application/json" } });

      expect(res.statusCode).toBe(500);
    });

    it("should pass an empty body when the webhook has none", async () => {
      await app.inject({ method: "POST", url: "/webhooks" });

      expect(payments.verifyWebhook.mock.calls[0][0].rawBody).toBe("");
    });
  });

  describe("browser scripts", () => {
    it.each([
      ["/assets/checkout.js", "tokenizeCard"],
      ["/payments/client.js", "export async function tokenizeCard"],
      ["/vendor/kit-pagos-colombia/browser.js", "KitPagosBrowser"],
    ])("should serve %s as JavaScript", async (url, content) => {
      const res = await app.inject({ method: "GET", url });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/javascript");
      expect(res.body).toContain(content);
    });
  });
});
