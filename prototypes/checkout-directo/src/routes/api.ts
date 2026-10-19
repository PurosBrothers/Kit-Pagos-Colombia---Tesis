import { FastifyInstance, FastifyReply } from "fastify";
import { MAX_QUANTITY, PRODUCTS, RequestedItem, linesTotal, orderDescription, orderLines } from "../catalog";
import { Payer, PaymentMethodRequest, PaymentTechnicalError } from "../checkout/PaymentsPort";
import { Order } from "../orders/OrderStore";
import { trace } from "../trace";
import { RouteContext } from "./context";

interface CreateOrderBody {
  payer: Payer;
  method: PaymentMethodRequest;
  items: RequestedItem[];
}

const nonEmpty = { type: "string", minLength: 1 } as const;

const createOrderSchema = {
  body: {
    type: "object",
    required: ["payer", "method", "items"],
    properties: {
      items: {
        type: "array",
        minItems: 1,
        maxItems: PRODUCTS.length,
        items: {
          type: "object",
          required: ["productId", "quantity"],
          properties: {
            productId: { enum: PRODUCTS.map((product) => product.id) },
            quantity: { type: "integer", minimum: 1, maximum: MAX_QUANTITY },
          },
        },
      },
      payer: {
        type: "object",
        required: ["fullName", "email", "documentType", "documentNumber", "phone"],
        properties: {
          fullName: nonEmpty,
          email: nonEmpty,
          documentType: { enum: ["CC", "CE", "NIT", "PP"] },
          documentNumber: nonEmpty,
          phone: nonEmpty,
        },
      },
      method: {
        oneOf: [
          {
            type: "object",
            required: ["type", "cardToken", "installments"],
            properties: {
              type: { const: "CARD" },
              cardToken: nonEmpty,
              installments: { type: "integer", minimum: 1 },
            },
          },
          {
            type: "object",
            required: ["type", "bankCode", "personType"],
            properties: {
              type: { const: "PSE" },
              bankCode: nonEmpty,
              personType: { enum: ["NATURAL", "LEGAL"] },
            },
          },
        ],
      },
    },
  },
} as const;

/** Un fallo técnico que el módulo no pudo resolver reintentando sale como 502; lo demás sigue al manejador. */
function technicalFailure(error: unknown, reply: FastifyReply, order: Order): FastifyReply {
  if (!(error instanceof PaymentTechnicalError)) throw error;
  return reply.code(502).send({ order, error: error.message });
}

/** La API JSON del checkout, que usa el script de las páginas. */
export async function apiRoutes(app: FastifyInstance, context: RouteContext): Promise<void> {
  const { payments, orders, publicBaseUrl } = context;

  app.get("/api/payments/config", async () => payments.publicConfig());

  app.get("/api/pse-banks", async (_request, reply) => {
    try {
      return { banks: await payments.listPseBanks() };
    } catch (error) {
      if (!(error instanceof PaymentTechnicalError)) throw error;
      return reply.code(502).send({ error: error.message });
    }
  });

  app.post<{ Body: CreateOrderBody }>("/api/orders", { schema: createOrderSchema }, async (request, reply) => {
    const { payer, method, items } = request.body;
    const lines = orderLines(items);
    const order = orders.create({
      lines,
      amountInPesos: linesTotal(lines),
      payer,
      method: method.type,
    });
    trace(
      `  orden ${order.id}: ${orderDescription(lines)} por $${order.amountInPesos.toLocaleString("es-CO")} COP, ` +
        `${method.type === "CARD" ? "con tarjeta (llega solo el token)" : `por PSE (banco ${method.bankCode})`} → módulo de pagos`,
    );
    try {
      const payment = await payments.createPayment({
        orderReference: order.id,
        amountInPesos: order.amountInPesos,
        description: orderDescription(lines),
        payer,
        method,
        returnUrl: `${publicBaseUrl}/orders/${order.id}`,
      });
      orders.record(
        order,
        { source: "creation", status: payment.status, nativeStatus: payment.nativeStatus },
        payment.transactionId,
      );
      return reply.code(201).send({ order, redirectUrl: payment.redirectUrl });
    } catch (error) {
      if (error instanceof PaymentTechnicalError) {
        orders.record(order, { source: "creation", status: "ERROR", detail: error.message });
      }
      return technicalFailure(error, reply, order);
    }
  });

  app.get<{ Params: { id: string } }>("/api/orders/:id", async (request, reply) => {
    const order = orders.get(request.params.id);
    if (!order) return reply.code(404).send({ error: `No existe la orden ${request.params.id}` });
    if (!order.transactionId) return { order };
    try {
      const payment = await payments.getPaymentStatus(order.transactionId);
      orders.record(order, { source: "query", status: payment.status, nativeStatus: payment.nativeStatus });
      return { order };
    } catch (error) {
      return technicalFailure(error, reply, order);
    }
  });
}
