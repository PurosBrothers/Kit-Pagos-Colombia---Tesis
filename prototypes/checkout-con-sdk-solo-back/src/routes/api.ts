import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppConfig, getPublicGatewayConfigs } from "../config";
import { Cart, PRODUCTS, cartLines, cartTotal, setQuantity } from "../catalog";
import { OrderStore } from "../orders/OrderStore";
import { PaymentService, toMerchantStatus } from "../payments/PaymentService";
import { KitPagosError } from "kit-pagos-colombia";

/** El carrito que manda el navegador, con las reglas del catálogo: productos que existen y de 1 a 9. */
function cartFrom(items: unknown): Cart {
  if (!Array.isArray(items)) return {};
  return items.reduce<Cart>(
    (cart, item) =>
      typeof item?.productId === "string" ? setQuantity(cart, item.productId, Number(item.quantity) || 0) : cart,
    {},
  );
}

export interface ApiRoutesOptions {
  config: AppConfig;
  payments: PaymentService;
  orders: OrderStore;
}

export async function apiRoutes(app: FastifyInstance, options: ApiRoutesOptions): Promise<void> {
  const { config, payments, orders } = options;

  // 1. Configuración pública para el frontend
  app.get("/api/config", async (_req, reply) => {
    return reply.send({
      environment: config.environment,
      publicBaseUrl: config.publicBaseUrl,
      gateways: getPublicGatewayConfigs(config),
    });
  });

  // 2. Catálogo de productos de Yerba Mate
  app.get("/api/products", async (_req, reply) => {
    return reply.send({
      products: PRODUCTS,
    });
  });

  // 3. Lista de bancos PSE por pasarela
  app.get("/api/banks", async (req: FastifyRequest<{ Querystring: { gateway?: string } }>, reply) => {
    const gateway = req.query.gateway || "WOMPI";
    try {
      const banks = await payments.listPseBanks(gateway);
      return reply.send({
        gateway,
        banks: banks.map((b) => ({ code: b.code, name: b.name })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error listando bancos";
      return reply.code(400).send({ error: message });
    }
  });

  // 4. Creación de pago
  app.post("/api/payments", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any;
    if (!body || !body.gateway || !body.payer || !body.method) {
      return reply.code(400).send({ error: "Faltan campos obligatorios en la orden de pago" });
    }
    // El monto lo decide el servidor con los precios del catálogo, como en A y B (punto 114):
    // del navegador solo cuentan el producto y la cantidad.
    const cart = cartFrom(body.items);
    const lines = cartLines(cart);
    if (lines.length === 0) {
      return reply.code(400).send({ error: "El carrito no tiene productos del catálogo" });
    }

    // Registramos la orden en el comercio
    const order = orders.create({
      gateway: body.gateway,
      items: lines.map((line) => ({
        productId: line.product.id,
        productName: line.product.name,
        quantity: line.quantity,
        unitPrice: line.product.price,
        subtotal: line.subtotal,
      })),
      amountInPesos: cartTotal(cart),
      payer: body.payer,
      method: body.method.type,
    });

    const returnUrl = `${config.publicBaseUrl}/?retorno=1&orderId=${order.id}`;

    try {
      const result = await payments.createPayment({
        gateway: body.gateway,
        orderReference: order.id,
        ipAddress: req.ip,
        amountInPesos: order.amountInPesos,
        returnUrl,
        payer: body.payer,
        method: body.method,
      });

      orders.record(
        order,
        {
          source: "creation",
          status: result.status,
          nativeStatus: result.nativeStatus,
          rejectionReason: result.rejectionReason?.rejectionCode
            ? { rejectionCode: result.rejectionReason.rejectionCode, rejectionCategory: result.rejectionReason.rejectionCategory ?? "UNKNOWN" }
            : undefined,
        },
        {
          transactionId: result.transactionId,
          redirectUrl: result.redirectUrl,
        },
      );

      return reply.code(201).send({
        orderId: order.id,
        transactionId: result.transactionId,
        status: result.status,
        nativeStatus: result.nativeStatus,
        redirectUrl: result.redirectUrl,
        outcome: result.outcome,
        isApproved: result.isApproved,
        isPending: result.isPending,
        rejectionReason: result.rejectionReason,
      });
    } catch (err) {
      let code = "UNKNOWN_ERROR";
      let message = "Error inesperado al crear el pago";
      if (err instanceof KitPagosError) {
        code = err.code;
        message = err.message;
      } else if (err instanceof Error) {
        message = err.message;
      }
      // Sin el cuerpo de la pasarela: puede traer datos del pagador.
      console.error(`[payments] ${body.gateway} fallo [${code}] ${message}`);

      orders.record(order, {
        source: "creation",
        status: "ERROR",
        detail: `Fallo en creación: [${code}] ${message}`,
      });

      return reply.code(422).send({
        error: message,
        code,
        orderId: order.id,
      });
    }
  });

  // 5. Consulta de estado de pago
  app.get(
    "/api/payments/:gateway/:id",
    async (req: FastifyRequest<{ Params: { gateway: string; id: string } }>, reply) => {
      const { gateway, id } = req.params;
      try {
        const result = await payments.getPaymentStatus(gateway, id);
        const order = orders.findByTransactionId(id, payments.parseGateway(gateway));
        if (order) {
          const last = order.history[order.history.length - 1];
          // Una consulta que repite el estado y el estado nativo no agrega nada al historial.
          const repeated = last?.status === result.status && last?.nativeStatus === result.nativeStatus;
          if (!repeated) {
            orders.record(order, {
              source: "query",
              status: result.status,
              nativeStatus: result.nativeStatus,
              rejectionReason: result.rejectionReason,
            });
          }
        }

        return reply.send({
          ...result,
          orderId: order?.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error consultando estado";
        return reply.code(404).send({ error: message });
      }
    },
  );

  // 6. Consulta de orden
  app.get("/api/orders/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const order = orders.get(req.params.id);
    if (!order) {
      return reply.code(404).send({ error: "Orden no encontrada" });
    }
    return reply.send({ order });
  });

  // 7. Webhooks entrantes, en la misma ruta que A y B: es la que se registra en cada panel.
  app.post(
    "/webhooks/:gateway",
    async (
      req: FastifyRequest<{
        Params: { gateway: string };
        Querystring: Record<string, string>;
      }>,
      reply,
    ) => {
      let gateway: string;
      try {
        gateway = payments.parseGateway(req.params.gateway);
      } catch (err) {
        return reply.code(404).send({ error: err instanceof Error ? err.message : "Pasarela no soportada" });
      }
      // La firma se calcula sobre los bytes que llegaron, no sobre el JSON vuelto a serializar.
      const rawBody = req.rawBody ?? (typeof req.body === "string" ? req.body : "");
      const headers = req.headers as Record<string, string>;

      let event;
      try {
        event = payments.validateWebhook(gateway, rawBody, headers, req.query);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Firma inválida";
        return reply.code(401).send({ error: msg });
      }

      const order =
        orders.findByTransactionId(event.gatewayTransactionId, gateway) ??
        (event.orderReference ? orders.findByReference(event.orderReference, gateway) : undefined);
      if (!order) return reply.send({ received: true, matched: false });

      let status = toMerchantStatus(event.newStatus);
      // El estado nativo firmado, no la traducción del SDK (punto 118).
      let nativeStatus = event.rawStatus ?? event.newStatus;
      let detail = `Evento ${event.eventType}`;
      // Mercado Pago avisa sin el estado, y Rapyd manda avisos todavía pendientes: ante un aviso
      // pendiente se consulta el pago, como B (punto 118).
      if (status === "PENDING" && order.transactionId) {
        try {
          const current = await payments.getPaymentStatus(gateway, order.transactionId);
          status = toMerchantStatus(current.status);
          nativeStatus = current.nativeStatus;
          detail = `${detail}; consultado el pago`;
        } catch {
          // Sin consulta (la tarjeta de Kushki no la tiene), el aviso queda como llegó.
        }
      }
      orders.record(order, { source: "webhook", status, nativeStatus, detail });
      return reply.send({ received: true, matched: true });
    },
  );
}
