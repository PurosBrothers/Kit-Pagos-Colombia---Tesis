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

  it("POST /api/payments maneja rechazo con KitPagosError sin pasar ni registrar el cuerpo de la pasarela", async () => {
    const gatewayBody = { error: { reason: "rechazada" }, customer_email: "test@mate.com" };
    mockPayments.createPayment.mockRejectedValueOnce(
      new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.WOMPI, gatewayBody, "Tarjeta rechazada"),
    );
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const payload = {
      gateway: "WOMPI",
      items: [{ productId: "mate-tradicional", quantity: 1 }],
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
    expect(res.body).not.toContain("test@mate.com");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("test@mate.com");
    logged.mockRestore();
  });

  it("POST /api/payments cobra con los precios del catálogo e ignora el precio y el monto del navegador", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/payments",
      payload: {
        gateway: "WOMPI",
        items: [
          { productId: "set-imperial", productName: "Gratis", quantity: 2, unitPrice: 1, subtotal: 2 },
          { productId: "no-existe", quantity: 1, unitPrice: 1 },
        ],
        amountInPesos: 2,
        payer: { fullName: "Test User", email: "test@mate.com", phone: "300", documentType: "CC", documentNumber: "123" },
        method: { type: "CARD", cardToken: "tok_test_123" },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mockPayments.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amountInPesos: 250000 }));
    const saved = orders.get(JSON.parse(res.body).orderId);
    expect(saved?.amountInPesos).toBe(250000);
    expect(saved?.items).toEqual([
      { productId: "set-imperial", productName: "Set Mate Imperial + Bombilla Alpaca", quantity: 2, unitPrice: 125000, subtotal: 250000 },
    ]);
  });

  it("POST /api/payments responde 400 a un carrito sin productos del catálogo, sin crear la orden ni cobrar", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/payments",
      payload: {
        gateway: "WOMPI",
        items: [{ productId: "no-existe", quantity: 1 }],
        amountInPesos: 28000,
        payer: { fullName: "Test User", email: "test@mate.com", phone: "300", documentType: "CC", documentNumber: "123" },
        method: { type: "CARD", cardToken: "tok_test_123" },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("El carrito no tiene productos del catálogo");
    expect(mockPayments.createPayment).not.toHaveBeenCalled();
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

  const payerBase = { fullName: "Prueba", email: "p@p.com", documentType: "CC", documentNumber: "123", phone: "300" };

  function orderWith(transactionId: string, gateway = "WOMPI") {
    const order = orders.create({ gateway, items: [], amountInPesos: 30000, payer: payerBase, method: "CARD" });
    orders.record(order, { source: "creation", status: "PENDING", nativeStatus: "PENDING" }, { transactionId });
    return order;
  }

  function webhook(gateway: string, payload: string, query = "") {
    return app.inject({
      method: "POST",
      url: `/webhooks/${gateway}${query}`,
      headers: { "content-type": "application/json", "x-signature": "firma" },
      payload,
    });
  }

  it("POST /webhooks/:gateway procesa el webhook y actualiza la orden", async () => {
    const order = orderWith("tx-mock-999");

    const res = await webhook("WOMPI", JSON.stringify({ event: "transaction.updated", data: { id: "tx-mock-999" } }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: true, matched: true });
    expect(orders.get(order.id)?.status).toBe("APPROVED");
  });

  it("POST /webhooks/:gateway responde 401 si la firma es inválida", async () => {
    mockPayments.validateWebhook.mockImplementationOnce(() => {
      throw new Error("Firma inválida");
    });

    const res = await webhook("WOMPI", JSON.stringify({ data: "bad" }));

    expect(res.statusCode).toBe(401);
  });

  // Kushki y Rapyd firman los bytes que mandan: el JSON vuelto a serializar no es el mismo texto.
  it("verifica el webhook sobre el cuerpo crudo, con sus espacios", async () => {
    const raw = '{ "ticket_number" :  "tx-mock-999",\n  "transaction_status": "APPROVAL" }';

    await webhook("KUSHKI", raw, "?x=1");

    expect(mockPayments.validateWebhook).toHaveBeenCalledWith("KUSHKI", raw, expect.any(Object), { x: "1" });
  });

  it("guarda el estado nativo firmado, no la traducción del SDK (punto 118)", async () => {
    const order = orderWith("tx-k-1", "KUSHKI");
    mockPayments.validateWebhook.mockReturnValueOnce({
      gatewayTransactionId: "tx-k-1",
      newStatus: "APPROVED",
      rawStatus: "APPROVAL",
      eventType: "charge",
    });

    await webhook("KUSHKI", "{}");

    expect(orders.get(order.id)?.history.slice(-1)[0]?.nativeStatus).toBe("APPROVAL");
  });

  it("encuentra la orden de la tarjeta de Rapyd por su referencia, cuando el aviso trae el id del pago", async () => {
    const order = orderWith("checkout_abc", "RAPYD");
    mockPayments.validateWebhook.mockReturnValueOnce({
      gatewayTransactionId: "payment_xyz",
      newStatus: "APPROVED",
      rawStatus: "CLO",
      orderReference: order.id,
      eventType: "PAYMENT_COMPLETED",
    });

    const res = await webhook("RAPYD", "{}");

    expect(JSON.parse(res.body).matched).toBe(true);
    expect(orders.get(order.id)?.status).toBe("APPROVED");
  });

  it("no deshace el desenlace con un PENDING que llega tarde", async () => {
    const order = orderWith("checkout_abc", "RAPYD");
    orders.record(order, { source: "webhook", status: "APPROVED", nativeStatus: "CLO" });
    mockPayments.validateWebhook.mockReturnValueOnce({
      gatewayTransactionId: "checkout_abc",
      newStatus: "PENDING",
      rawStatus: "ACT",
      eventType: "PAYMENT_UPDATED",
    });
    mockPayments.getPaymentStatus.mockResolvedValueOnce({
      transactionId: "checkout_abc",
      status: "PENDING",
      nativeStatus: "ACT",
      isApproved: false,
      isPending: true,
      isFinal: false,
    });

    await webhook("RAPYD", "{}");

    expect(orders.get(order.id)?.status).toBe("APPROVED");
    expect(orders.get(order.id)?.history.slice(-1)[0]?.nativeStatus).toBe("ACT");
  });

  it("consulta el pago ante un aviso pendiente: Mercado Pago avisa sin el estado (punto 118)", async () => {
    const order = orderWith("ORDTST01", "MERCADOPAGO");
    mockPayments.validateWebhook.mockReturnValueOnce({ gatewayTransactionId: "ORDTST01", newStatus: "PENDING", eventType: "order.processed" });
    mockPayments.getPaymentStatus.mockResolvedValueOnce({
      transactionId: "ORDTST01",
      status: "APPROVED",
      nativeStatus: "processed",
      isApproved: true,
      isPending: false,
      isFinal: true,
    });

    await webhook("MERCADOPAGO", "{}", "?data.id=ORDTST01&type=order");

    expect(mockPayments.getPaymentStatus).toHaveBeenCalledWith("MERCADOPAGO", "ORDTST01");
    expect(orders.get(order.id)?.status).toBe("APPROVED");
    expect(orders.get(order.id)?.history.slice(-1)[0]?.nativeStatus).toBe("processed");
  });

  it("deja el aviso pendiente como llegó si la pasarela no tiene consulta", async () => {
    const order = orderWith("ticket-1", "KUSHKI");
    mockPayments.validateWebhook.mockReturnValueOnce({ gatewayTransactionId: "ticket-1", newStatus: "PENDING", rawStatus: "INITIALIZED", eventType: "x" });
    mockPayments.getPaymentStatus.mockRejectedValueOnce(new Error("UNSUPPORTED_OPERATION"));

    await webhook("KUSHKI", "{}");

    expect(orders.get(order.id)?.status).toBe("PENDING");
    expect(orders.get(order.id)?.history.slice(-1)[0]?.nativeStatus).toBe("INITIALIZED");
  });

  it("toma un vencimiento como rechazo, y no como pendiente", async () => {
    const order = orderWith("tx-mp-1", "MERCADOPAGO");
    mockPayments.validateWebhook.mockReturnValueOnce({
      gatewayTransactionId: "tx-mp-1",
      newStatus: "EXPIRED",
      rawStatus: "expired",
      eventType: "order.expired",
    });

    await webhook("MERCADOPAGO", "{}");

    expect(orders.get(order.id)?.status).toBe("DECLINED");
  });

  it("responde 200 sin cambiar nada a un aviso de una orden que no conoce", async () => {
    mockPayments.validateWebhook.mockReturnValueOnce({ gatewayTransactionId: "otro", newStatus: "APPROVED", eventType: "x" });

    const res = await webhook("WOMPI", "{}");

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: true, matched: false });
  });

  it("responde 404 a una pasarela con la que no cobra", async () => {
    mockPayments.parseGateway.mockImplementationOnce(() => {
      throw new Error("Pasarela no soportada: 'STRIPE'.");
    });

    const res = await webhook("STRIPE", "{}");

    expect(res.statusCode).toBe(404);
  });

  it("ya no recibe webhooks en /api/webhooks: la ruta es la de A y B", async () => {
    const res = await app.inject({ method: "POST", url: "/api/webhooks/WOMPI", headers: { "content-type": "application/json" }, payload: "{}" });

    expect(res.statusCode).toBe(404);
  });

  it("guarda el motivo del rechazo que trae la creación", async () => {
    mockPayments.createPayment.mockResolvedValueOnce({
      outcome: "DECLINED",
      transactionId: "tx-k-2",
      status: "DECLINED",
      nativeStatus: "DECLINED",
      isApproved: false,
      isPending: false,
      rejectionReason: { rejectionCode: "021", rejectionCategory: "INSUFFICIENT_FUNDS" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/payments",
      payload: {
        gateway: "KUSHKI",
        items: [{ productId: "mate-tradicional", quantity: 1 }],
        payer: payerBase,
        method: { type: "CARD", cardToken: "t" },
      },
    });

    const order = orders.get(JSON.parse(res.body).orderId);
    expect(order?.rejectionReason).toEqual({ rejectionCode: "021", rejectionCategory: "INSUFFICIENT_FUNDS" });
    expect(order?.history.slice(-1)[0]?.rejectionReason?.rejectionCode).toBe("021");
  });

  it("guarda la consulta con su motivo, y no repite una que no cambió nada", async () => {
    const order = orderWith("tx-pse-1", "KUSHKI");
    mockPayments.getPaymentStatus.mockResolvedValue({
      transactionId: "tx-pse-1",
      status: "DECLINED",
      nativeStatus: "declinedTransaction",
      isApproved: false,
      isPending: false,
      isFinal: true,
      rejectionReason: { rejectionCode: "00011", rejectionCategory: "INSUFFICIENT_FUNDS" },
    });

    await app.inject({ method: "GET", url: "/api/payments/KUSHKI/tx-pse-1" });
    await app.inject({ method: "GET", url: "/api/payments/KUSHKI/tx-pse-1" });

    const saved = orders.get(order.id);
    expect(saved?.status).toBe("DECLINED");
    expect(saved?.rejectionReason?.rejectionCode).toBe("00011");
    expect(saved?.history.filter((entry) => entry.source === "query")).toHaveLength(1);
  });
});
