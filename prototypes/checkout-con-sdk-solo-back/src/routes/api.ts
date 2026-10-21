import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppConfig, getPublicGatewayConfigs } from "../config";
import { PRODUCTS } from "../catalog";
import { OrderStore } from "../orders/OrderStore";
import { PaymentService } from "../payments/PaymentService";
import { KitPagosError } from "kit-pagos-colombia";

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
    if (!body || !body.gateway || !body.payer || !body.amountInPesos || !body.method) {
      return reply.code(400).send({ error: "Faltan campos obligatorios en la orden de pago" });
    }

    // Registramos la orden en el comercio
    const order = orders.create({
      gateway: body.gateway,
      items: body.items || [],
      amountInPesos: Number(body.amountInPesos),
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
          detail: `Pago procesado: outcome=${result.outcome}, status=${result.status}`,
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
      let detail: unknown;
      if (err instanceof KitPagosError) {
        code = err.code;
        message = err.message;
        detail = err.originalPayload ?? (err.cause as any)?.response?.data;
      } else if (err instanceof Error) {
        message = err.message;
      }
      console.error(`[payments] ${body.gateway} fallo [${code}] ${message}`, JSON.stringify(detail));

      orders.record(order, {
        source: "creation",
        status: "ERROR",
        detail: `Fallo en creación: [${code}] ${message}`,
      });

      return reply.code(422).send({
        error: message,
        code,
        detail,
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
        const order = orders.findByTransactionId(id);
        if (order) {
          orders.record(order, {
            source: "query",
            status: result.status,
            nativeStatus: result.nativeStatus,
            detail: `Consulta periódica: estado ${result.status}`,
          });
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

  // 7. Webhooks entrantes
  app.post(
    "/api/webhooks/:gateway",
    async (
      req: FastifyRequest<{
        Params: { gateway: string };
        Querystring: Record<string, string>;
      }>,
      reply,
    ) => {
      const gateway = req.params.gateway;
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      const headers = req.headers as Record<string, string>;

      try {
        const event = payments.validateWebhook(gateway, rawBody, headers, req.query);
        const transactionId = event.gatewayTransactionId;
        const order = orders.findByTransactionId(transactionId);

        if (order) {
          const isApproved = event.newStatus === "APPROVED";
          const isDeclined = event.newStatus === "DECLINED";
          const status = isApproved ? "APPROVED" : isDeclined ? "DECLINED" : "PENDING";

          orders.record(order, {
            source: "webhook",
            status,
            nativeStatus: event.newStatus,
            detail: `Webhook verificado: evento=${event.eventType}`,
          });
        }

        return reply.send({ received: true, eventType: event.eventType });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Firma inválida";
        return reply.code(401).send({ error: msg });
      }
    },
  );
}
