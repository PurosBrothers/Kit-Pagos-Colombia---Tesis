import { buildApp } from "../src/app";
import { resolveConfig } from "../src/config";
import { OrderStore } from "../src/orders/OrderStore";
import { KitPagosError, KitPagosErrorCode, Gateway } from "kit-pagos-colombia";

describe("API Routes (Fastify)", () => {
  const config = resolveConfig();
  let app: any;
  let mockPayments: any;
  let orders: OrderStore;

  beforeEach(async () => {
    orders = new OrderStore();
    mockPayments = {
      parseGateway: jest.fn((g) => g.toUpperCase()),
      listPseBanks: jest.fn().mockResolvedValue([{ code: "1022", name: "BANCO UNION" }]),
      createPayment: jest.fn().mockResolvedValue({
        outcome: "APPROVED",
        transactionId: "tx-mock-999",
        status: "APPROVED",
        nativeStatus: "APPROVED",
        isApproved: true,
        isPending: false,
      }),
      getPaymentStatus: jest.fn().mockResolvedValue({
        transactionId: "tx-mock-999",
        status: "APPROVED",
        nativeStatus: "APPROVED",
        isApproved: true,
        isPending: false,
        isFinal: true,
      }),
      validateWebhook: jest.fn().mockReturnValue({
        gatewayTransactionId: "tx-mock-999",
        newStatus: "APPROVED",
        eventType: "payment.updated",
      }),
    };

    app = buildApp({
      config,
      payments: mockPayments,
      orders,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET / sirve el HTML principal de la tienda", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("AUSTRAL MATE");
  });

  it("GET /styles.css sirve los estilos CSS", async () => {
    const res = await app.inject({ method: "GET", url: "/styles.css" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    expect(res.body).toContain("--color-primary");
  });

  it("GET /checkout.js sirve el script del cliente", async () => {
    const res = await app.inject({ method: "GET", url: "/checkout.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.body).toContain("tokenizeCardDirectly");
  });

  it("GET /api/config devuelve la configuración pública de las 4 pasarelas", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.environment).toBeDefined();
    expect(body.gateways.WOMPI).toBeDefined();
    expect(body.gateways.MERCADOPAGO).toBeDefined();
    expect(body.gateways.KUSHKI).toBeDefined();
    expect(body.gateways.RAPYD).toBeDefined();
  });

  it("GET /api/products devuelve la lista de yerbas y accesorios", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.products).toHaveLength(5);
    expect(body.products[0].name).toContain("Yerba Mate");
  });

  it("GET /api/banks devuelve los bancos PSE", async () => {
    const res = await app.inject({ method: "GET", url: "/api/banks?gateway=WOMPI" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.banks).toHaveLength(1);
    expect(body.banks[0].code).toBe("1022");
  });

  it("GET /api/banks maneja errores de la pasarela", async () => {
    mockPayments.listPseBanks.mockRejectedValueOnce(new Error("Pasarela no disponible"));
    const res = await app.inject({ method: "GET", url: "/api/banks?gateway=WOMPI" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Pasarela no disponible");
  });

  it("POST /api/payments crea la orden y procesa el cobro", async () => {
    const payload = {
      gateway: "WOMPI",
      items: [
        {
          productId: "mate-tradicional",
          productName: "Yerba Mate",
          quantity: 2,
          unitPrice: 28000,
          subtotal: 56000,
        },
      ],
      amountInPesos: 56000,
      payer: {
        fullName: "Test User",
        email: "test@mate.com",
        phone: "3001234567",
        documentType: "CC",
        documentNumber: "123456",
      },
      method: {
        type: "CARD",
        cardToken: "tok_test_123",
      },
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/payments",
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.orderId).toBeDefined();
    expect(body.transactionId).toBe("tx-mock-999");
    expect(body.status).toBe("APPROVED");

    // Verificar que la orden existe en el OrderStore
    const saved = orders.get(body.orderId);
    expect(saved).toBeDefined();
    expect(saved?.status).toBe("APPROVED");
  });

  it("POST /api/payments maneja rechazo con KitPagosError", async () => {
    mockPayments.createPayment.mockRejectedValueOnce(
      new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.WOMPI, null, "Tarjeta rechazada"),
    );

    const payload = {
      gateway: "WOMPI",
      items: [],
      amountInPesos: 56000,
      payer: {
        fullName: "Test User",
        email: "test@mate.com",
        phone: "300",
        documentType: "CC",
        documentNumber: "123",
      },
      method: { type: "CARD", cardToken: "bad_tok" },
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/payments",
      payload,
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
  });

  it("POST /api/payments rechaza peticiones con datos incompletos", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/payments",
      payload: { gateway: "WOMPI" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/payments/:gateway/:id consulta el estado de la transacción", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/payments/WOMPI/tx-mock-999",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("APPROVED");
  });

  it("GET /api/payments/:gateway/:id responde 404 si la transacción falla", async () => {
    mockPayments.getPaymentStatus.mockRejectedValueOnce(new Error("Transacción no existe"));
    const res = await app.inject({
      method: "GET",
      url: "/api/payments/WOMPI/no-tx",
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/orders/:id devuelve la orden por su identificador", async () => {
    const order = orders.create({
      gateway: "WOMPI",
      items: [],
      amountInPesos: 30000,
      payer: {
        fullName: "Prueba",
        email: "p@p.com",
        documentType: "CC",
        documentNumber: "123",
        phone: "300",
      },
      method: "CARD",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/orders/${order.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.order.id).toBe(order.id);
  });

  it("GET /api/orders/:id responde 404 para orden inexistente", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/orders/ORD-NO-EXISTE",
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/webhooks/:gateway procesa webhook entrante", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/WOMPI",
      headers: {
        "content-type": "application/json",
        "x-signature": "test-signature",
      },
      payload: {
        event: "transaction.updated",
        data: { id: "tx-mock-999", status: "APPROVED" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(true);
  });

  it("POST /api/webhooks/:gateway responde 401 si la firma es inválida", async () => {
    mockPayments.validateWebhook.mockImplementationOnce(() => {
      throw new Error("Firma inválida");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/WOMPI",
      headers: { "content-type": "application/json" },
      payload: { data: "bad" },
    });

    expect(res.statusCode).toBe(401);
  });
});
