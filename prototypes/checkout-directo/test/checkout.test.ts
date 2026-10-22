import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { PRODUCTS } from "../src/catalog";
import { PaymentTechnicalError, PaymentsPort } from "../src/checkout/PaymentsPort";
import { OrderStore } from "../src/orders/OrderStore";
import { disableTrace, enableTrace } from "../src/trace";
import { FAKE_GATEWAYS, fakePayments } from "./helpers/fakePayments";

const BASE_URL = "http://checkout.test";

const payer = {
  fullName: "Pedro Pérez",
  email: "pedro@example.com",
  documentType: "CC",
  documentNumber: "1020304050",
  phone: "3001234567",
  address: { streetName: "Calle 10", streetNumber: "5-20", neighborhood: "La Candelaria", city: "Bogotá", zipCode: "111711" },
};

const card = { type: "CARD", cardToken: "tok_fake", installments: 1 };
const pse = { type: "PSE", bankCode: "1007", personType: "NATURAL" };

const [batman, superman, spiderman] = PRODUCTS;
const oneComic = [{ productId: batman.id, quantity: 1 }];

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

  const createOrder = (method: object, items: object[] = oneComic, gateway = "token-pay") =>
    app.inject({ method: "POST", url: "/api/orders", payload: { gateway, payer, method, items } });

  describe("pages", () => {
    it("should show the three comics, the cart and the card and PSE forms", async () => {
      const res = await app.inject({ method: "GET", url: "/" });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      for (const product of PRODUCTS) {
        expect(res.body).toContain(product.title);
        expect(res.body).toContain(`data-product-id="${product.id}"`);
        expect(res.body).toContain(`href="#${product.art}"`);
      }
      expect(res.body).toContain('id="cart-lines"');
      expect(res.body).toContain('id="card-fields"');
      expect(res.body).toContain('id="pse-fields"');
      expect(res.body).toContain('src="/assets/checkout.js"');
    });

    it("should offer the gateways of the payments module, with their names and how they take the card", async () => {
      const res = await app.inject({ method: "GET", url: "/" });

      expect(res.body).toContain('<option value="token-pay" data-card-capture="BROWSER_TOKEN">Token Pay</option>');
      expect(res.body).toContain('<option value="hosted-pay" data-card-capture="HOSTED_PAGE">Hosted Pay</option>');
      expect(res.body).toContain('id="hosted-card"');
      for (const field of ["streetName", "streetNumber", "neighborhood", "city", "zipCode"]) {
        expect(res.body).toContain(`id="${field}"`);
      }
    });

    it("should explain under the title that this is prototype A, which integrates without the SDK", async () => {
      const res = await app.inject({ method: "GET", url: "/" });

      const afterTitle = res.body.slice(res.body.indexOf('id="catalog-title"'));
      expect(afterTitle.indexOf("Este prototipo es")).toBeLessThan(afterTitle.indexOf('class="products"'));
      expect(res.body).toContain("prototipo A de Kit Pagos Colombia");
      expect(res.body).toContain("sin el SDK");
    });

    it("should say in the ribbon that it charges in the gateway's official sandbox by default", async () => {
      const res = await app.inject({ method: "GET", url: "/" });

      expect(res.body).toContain("cobra en el sandbox oficial de cada pasarela");
    });

    it("should say in the ribbon that it charges in the simulator when the environment says so", async () => {
      process.env.CHECKOUT_ENVIRONMENT = "simulator";
      const simulated = buildApp({ payments, publicBaseUrl: BASE_URL, orders });
      try {
        const res = await simulated.inject({ method: "GET", url: "/" });

        expect(res.body).toContain("cobra en la API de Simulación");
      } finally {
        delete process.env.CHECKOUT_ENVIRONMENT;
        await simulated.close();
      }
    });

    it("should hand the script the catalog prices without letting a < close the tag", async () => {
      const res = await app.inject({ method: "GET", url: "/" });

      const json = res.body.match(/<script type="application\/json" id="catalog-data">(.*?)<\/script>/s)?.[1];
      expect(JSON.parse(json ?? "[]")).toEqual(
        PRODUCTS.map(({ id, title, priceInPesos }) => ({ id, title, priceInPesos })),
      );
      expect(json).not.toContain("<");
    });

    it("should show an approved order with its comics and, folded, its native status history", async () => {
      const created = (await createOrder(card)).json().order;

      const res = await app.inject({ method: "GET", url: `/orders/${created.id}` });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(created.id);
      expect(res.body).toContain("¡Gracias! Tu pago fue aprobado");
      expect(res.body).toContain(batman.title);
      expect(res.body).toContain('data-status="APPROVED"');
      expect(res.body).toContain("Aprobado");
      expect(res.body).toContain("tx-card-1");
    });

    it.each([
      ["DECLINED", "Tu pago fue rechazado"],
      ["PENDING", "Tu pago está en proceso"],
    ])("should tell the buyer a %s order in store words", async (status, title) => {
      payments.createPayment.mockResolvedValueOnce({ transactionId: "tx-3", status: status as "DECLINED", nativeStatus: status });
      const created = (await createOrder(card)).json().order;

      const res = await app.inject({ method: "GET", url: `/orders/${created.id}` });

      expect(res.body).toContain(title);
      expect(res.body).toContain(`data-status="${status}"`);
    });

    it("should tell the buyer that a technical failure left the payment undecided", async () => {
      payments.createPayment.mockRejectedValueOnce(new PaymentTechnicalError("La pasarela no respondió"));
      const created = (await createOrder(card)).json().order;

      const res = await app.inject({ method: "GET", url: `/orders/${created.id}` });

      expect(res.body).toContain("No pudimos procesar el pago");
      expect(res.body).toContain("sin crear");
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

  describe("the store's trace", () => {
    afterEach(() => disableTrace());

    it("should tell what the order is, what reaches the payments module and how the order changed", async () => {
      const lines: string[] = [];
      enableTrace((line) => lines.push(line));

      const { order } = (await createOrder(card)).json();
      await app.inject({ method: "GET", url: `/api/orders/${order.id}` });

      expect(lines).toEqual([
        `[checkout]   orden ${order.id}: La Candelaria Cómics · 1 cómic por $68.000 COP, con tarjeta (llega solo el token), con Token Pay → módulo de pagos`,
        `[checkout]   orden ${order.id} ← creación: APPROVED (nativo APPROVED), transacción tx-card-1`,
        `[checkout]   orden ${order.id} ← consulta: APPROVED (nativo APPROVED) (sin cambios)`,
      ]);
    });

    it("should name the bank of a PSE payment and never the payer's data", async () => {
      const lines: string[] = [];
      enableTrace((line) => lines.push(line));

      await createOrder(pse);

      expect(lines[0]).toContain("por PSE (banco 1007)");
      expect(lines.join("\n")).not.toMatch(/pedro@example\.com|1020304050|3001234567/);
    });
  });

  describe("POST /api/orders", () => {
    it("should charge the cart at catalog prices in whole pesos, with the order as reference and its page as return URL", async () => {
      const res = await createOrder(card, [
        { productId: batman.id, quantity: 2 },
        { productId: superman.id, quantity: 1 },
      ]);

      expect(res.statusCode).toBe(201);
      const { order } = res.json();
      expect(payments.createPayment).toHaveBeenCalledWith({
        gateway: "token-pay",
        orderReference: order.id,
        amountInPesos: 2 * batman.priceInPesos + superman.priceInPesos,
        description: "La Candelaria Cómics · 3 cómics",
        payer,
        method: card,
        returnUrl: `${BASE_URL}/orders/${order.id}`,
        payerIp: "127.0.0.1",
      });
      expect(order.gateway).toBe("token-pay");
      expect(order.lines).toEqual([
        { productId: batman.id, title: batman.title, quantity: 2, unitPriceInPesos: batman.priceInPesos },
        { productId: superman.id, title: superman.title, quantity: 1, unitPriceInPesos: superman.priceInPesos },
      ]);
    });

    it("should take the payer's IP from X-Forwarded-For, as it arrives through a tunnel", async () => {
      await app.inject({
        method: "POST",
        url: "/api/orders",
        headers: { "x-forwarded-for": "190.24.1.10" },
        payload: { gateway: "token-pay", payer, method: pse, items: oneComic },
      });

      expect(payments.createPayment).toHaveBeenCalledWith(expect.objectContaining({ payerIp: "190.24.1.10" }));
    });

    it("should create a card payment without a token on a gateway that takes the card in its own page", async () => {
      const res = await createOrder({ type: "CARD", installments: 1 }, oneComic, "hosted-pay");

      expect(res.statusCode).toBe(201);
      expect(res.json().redirectUrl).toBe("https://pay.example/checkout");
      expect(payments.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ gateway: "hosted-pay", method: { type: "CARD", installments: 1 } }),
      );
    });

    it("should refuse a card without a token on a gateway that tokenizes in the browser", async () => {
      const res = await createOrder({ type: "CARD", installments: 1 });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Token Pay cobra la tarjeta con un token del navegador");
      expect(payments.createPayment).not.toHaveBeenCalled();
    });

    it("should ignore any price the browser sends and join repeated lines", async () => {
      const res = await createOrder(card, [
        { productId: spiderman.id, quantity: 1, priceInPesos: 1 },
        { productId: spiderman.id, quantity: 2 },
      ]);

      expect(res.statusCode).toBe(201);
      expect(res.json().order.amountInPesos).toBe(3 * spiderman.priceInPesos);
      expect(payments.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amountInPesos: 3 * spiderman.priceInPesos }),
      );
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

    const gateway = "token-pay";
    const { address: _address, ...payerWithoutAddress } = payer;
    it.each([
      ["an order without gateway", { payer, method: card, items: oneComic }],
      ["a gateway the payments module does not offer", { gateway: "stripe", payer, method: card, items: oneComic }],
      ["a payer without email", { gateway, payer: { ...payer, email: "" }, method: card, items: oneComic }],
      ["a payer without address", { gateway, payer: payerWithoutAddress, method: card, items: oneComic }],
      ["an unknown method", { gateway, payer, method: { type: "CASH" }, items: oneComic }],
      ["a card without token", { gateway, payer, method: { type: "CARD", installments: 1 }, items: oneComic }],
      ["a PSE payment without bank", { gateway, payer, method: { type: "PSE", personType: "NATURAL" }, items: oneComic }],
      ["an order without comics", { gateway, payer, method: card }],
      ["an empty cart", { gateway, payer, method: card, items: [] }],
      ["a comic that is not in the catalog", { gateway, payer, method: card, items: [{ productId: "watchmen", quantity: 1 }] }],
      ["more copies than allowed", { gateway, payer, method: card, items: [{ productId: batman.id, quantity: 10 }] }],
      ["zero copies", { gateway, payer, method: card, items: [{ productId: batman.id, quantity: 0 }] }],
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
      expect(payments.getPaymentStatus).toHaveBeenCalledWith("token-pay", "tx-pse-1");
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
      const res = await app.inject({ method: "GET", url: "/api/pse-banks?gateway=token-pay" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ banks: [{ code: "1007", name: "Bancolombia" }] });
    });

    it("should answer 502 when the bank list fails technically", async () => {
      payments.listPseBanks.mockRejectedValueOnce(new PaymentTechnicalError("caída"));

      const res = await app.inject({ method: "GET", url: "/api/pse-banks?gateway=token-pay" });

      expect(res.statusCode).toBe(502);
    });

    it("should answer 500 when the bank list fails for another reason", async () => {
      payments.listPseBanks.mockRejectedValueOnce(new Error("defecto"));

      const res = await app.inject({ method: "GET", url: "/api/pse-banks?gateway=token-pay" });

      expect(res.statusCode).toBe(500);
    });

    it("should ask the payments module for the banks of the chosen gateway", async () => {
      await app.inject({ method: "GET", url: "/api/pse-banks?gateway=hosted-pay" });

      expect(payments.listPseBanks).toHaveBeenCalledWith("hosted-pay");
    });

    it("should give the browser the public configuration of the chosen gateway", async () => {
      const res = await app.inject({ method: "GET", url: "/api/payments/config?gateway=token-pay" });

      expect(res.json()).toEqual({ gateway: "token-pay", publicKey: "pub_fake" });
    });

    it.each(["/api/pse-banks", "/api/payments/config", "/api/pse-banks?gateway=stripe", "/api/payments/config?gateway=stripe"])(
      "should answer 400 to %s without a gateway the module offers",
      async (url) => {
        const res = await app.inject({ method: "GET", url });

        expect(res.statusCode).toBe(400);
        expect(payments.listPseBanks).not.toHaveBeenCalled();
        expect(payments.publicConfig).not.toHaveBeenCalled();
      },
    );

    it("should list the gateways of the payments module for the page", async () => {
      const res = await app.inject({ method: "GET", url: "/api/gateways" });

      expect(res.json()).toEqual({ gateways: FAKE_GATEWAYS });
    });
  });

  describe("POST /webhooks/:gateway", () => {
    const rawBody = '{"event":"transaction.updated",  "data": {"id":"tx-card-1"}}';

    it("should hand the module the gateway of the route, the body byte for byte, the headers and the query", async () => {
      await app.inject({
        method: "POST",
        url: "/webhooks/token-pay?data.id=tx-card-1&type=payment",
        headers: { "content-type": "application/json", "x-signature": "ts=1,v1=abc" },
        payload: rawBody,
      });

      const [gateway, webhook] = payments.verifyWebhook.mock.calls[0];
      expect(gateway).toBe("token-pay");
      expect(webhook.rawBody).toBe(rawBody);
      expect(webhook.headers["x-signature"]).toBe("ts=1,v1=abc");
      expect(webhook.query).toEqual({ "data.id": "tx-card-1", type: "payment" });
    });

    it("should update the order of a verified webhook", async () => {
      payments.createPayment.mockResolvedValueOnce({ transactionId: "tx-card-1", status: "PENDING", nativeStatus: "PENDING" });
      const { order } = (await createOrder(card)).json();

      const res = await app.inject({ method: "POST", url: "/webhooks/token-pay", payload: rawBody, headers: { "content-type": "application/json" } });

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

      const res = await app.inject({ method: "POST", url: "/webhooks/token-pay", payload: rawBody, headers: { "content-type": "application/json" } });

      expect(res.statusCode).toBe(401);
      expect(orders.get(order.id)?.status).toBe("PENDING");
    });

    it("should acknowledge a verified webhook of an unknown transaction", async () => {
      const res = await app.inject({ method: "POST", url: "/webhooks/token-pay", payload: rawBody, headers: { "content-type": "text/plain" } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true, matched: false });
    });

    it("should answer 502 so the gateway retries when the module fails technically", async () => {
      payments.verifyWebhook.mockRejectedValueOnce(new PaymentTechnicalError("segunda petición caída"));

      const res = await app.inject({ method: "POST", url: "/webhooks/token-pay", payload: rawBody, headers: { "content-type": "application/json" } });

      expect(res.statusCode).toBe(502);
    });

    it("should answer 500 when the module fails for another reason", async () => {
      payments.verifyWebhook.mockRejectedValueOnce(new Error("defecto"));

      const res = await app.inject({ method: "POST", url: "/webhooks/token-pay", payload: rawBody, headers: { "content-type": "application/json" } });

      expect(res.statusCode).toBe(500);
    });

    it("should pass an empty body when the webhook has none", async () => {
      await app.inject({ method: "POST", url: "/webhooks/token-pay" });

      expect(payments.verifyWebhook.mock.calls[0][1].rawBody).toBe("");
    });

    it("should answer 404 to a gateway the payments module does not offer, without verifying", async () => {
      const res = await app.inject({ method: "POST", url: "/webhooks/stripe", payload: rawBody });

      expect(res.statusCode).toBe(404);
      expect(payments.verifyWebhook).not.toHaveBeenCalled();
    });

    it("should only update an order of the same gateway as the webhook", async () => {
      payments.createPayment.mockResolvedValueOnce({ transactionId: "tx-card-1", status: "PENDING", nativeStatus: "PENDING" });
      const { order } = (await createOrder(card)).json();

      const res = await app.inject({ method: "POST", url: "/webhooks/hosted-pay", payload: rawBody });

      expect(res.json()).toEqual({ received: true, matched: false });
      expect(orders.get(order.id)?.status).toBe("PENDING");
    });

    it("should find the order by its reference when the webhook reports another transaction id", async () => {
      payments.createPayment.mockResolvedValueOnce({ transactionId: "checkout-1", status: "PENDING", nativeStatus: "NEW" });
      const { order } = (await createOrder(card)).json();
      payments.verifyWebhook.mockResolvedValueOnce({
        transactionId: "payment-1",
        status: "APPROVED",
        nativeStatus: "CLO",
        orderReference: order.id,
      });

      const res = await app.inject({ method: "POST", url: "/webhooks/token-pay", payload: rawBody, headers: { "content-type": "application/json" } });

      expect(res.json()).toEqual({ received: true, matched: true });
      const updated = orders.get(order.id);
      expect(updated?.status).toBe("APPROVED");
      expect(updated?.history.slice(-1)[0]).toMatchObject({ source: "webhook", nativeStatus: "CLO" });
      expect(updated?.transactionId).toBe("checkout-1");
    });

    it("should not take the order of another gateway by its reference", async () => {
      payments.createPayment.mockResolvedValueOnce({ transactionId: "checkout-1", status: "PENDING", nativeStatus: "NEW" });
      const { order } = (await createOrder(card)).json();
      payments.verifyWebhook.mockResolvedValueOnce({
        transactionId: "payment-1",
        status: "APPROVED",
        nativeStatus: "CLO",
        orderReference: order.id,
      });

      const res = await app.inject({ method: "POST", url: "/webhooks/hosted-pay", payload: rawBody });

      expect(res.json()).toEqual({ received: true, matched: false });
      expect(orders.get(order.id)?.status).toBe("PENDING");
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

// La migración del #133 tiene que tocar solo src/payments/: si la tienda nombrara la pasarela,
// el commit de la migración tendría que cambiar también sus páginas (punto 111).
describe("the storefront does not name a gateway", () => {
  const root = path.resolve(__dirname, "..");
  const files = [
    ...readdirSync(path.join(root, "src/views")).map((name) => `src/views/${name}`),
    "src/public/checkout.js",
    "src/catalog.ts",
    "src/routes/api.ts",
    "src/routes/pages.ts",
    "src/orders/OrderStore.ts",
  ];

  it.each(files)("%s", (file) => {
    expect(readFileSync(path.join(root, file), "utf8")).not.toMatch(/wompi|mercado\s*pago|kushki|rapyd/i);
  });
});
