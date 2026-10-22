import { FastifyInstance, FastifyReply } from "fastify";
import { MAX_QUANTITY, PRODUCTS, RequestedItem, linesTotal, orderDescription, orderLines } from "../catalog";
import { GatewayOption, Payer, PaymentMethodRequest, PaymentTechnicalError } from "../checkout/PaymentsPort";
import { Order } from "../orders/OrderStore";
import { trace } from "../trace";
import { RouteContext } from "./context";

interface CreateOrderBody {
  gateway: string;
  payer: Payer;
  method: PaymentMethodRequest;
  items: RequestedItem[];
}

const nonEmpty = { type: "string", minLength: 1 } as const;

/** El schema de la orden: las pasarelas válidas son las que dio el módulo de pagos. */
function createOrderSchema(gateways: readonly GatewayOption[]) {
  return {
    body: {
      type: "object",
      required: ["gateway", "payer", "method", "items"],
      properties: {
        gateway: { enum: gateways.map((gateway) => gateway.id) },
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
          required: ["fullName", "email", "documentType", "documentNumber", "phone", "address"],
          properties: {
            fullName: nonEmpty,
            email: nonEmpty,
            documentType: { enum: ["CC", "CE", "NIT", "PP"] },
            documentNumber: nonEmpty,
            phone: nonEmpty,
            address: {
              type: "object",
              required: ["streetName", "streetNumber", "neighborhood", "city", "zipCode"],
              properties: {
                streetName: nonEmpty,
                streetNumber: nonEmpty,
                neighborhood: nonEmpty,
                city: nonEmpty,
                zipCode: nonEmpty,
              },
            },
          },
        },
        method: {
          oneOf: [
            {
              type: "object",
              required: ["type", "installments"],
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
}

/** Un fallo técnico que el módulo no pudo resolver reintentando sale como 502; lo demás sigue al manejador. */
function technicalFailure(error: unknown, reply: FastifyReply, order: Order): FastifyReply {
  if (!(error instanceof PaymentTechnicalError)) throw error;
  return reply.code(502).send({ order, error: error.message });
}

function methodWords(method: PaymentMethodRequest): string {
  if (method.type === "PSE") return `por PSE (banco ${method.bankCode})`;
  return method.cardToken ? "con tarjeta (llega solo el token)" : "con tarjeta en la página de la pasarela";
}

/** La API JSON del checkout, que usa el script de las páginas. */
export async function apiRoutes(app: FastifyInstance, context: RouteContext): Promise<void> {
  const { payments, orders, publicBaseUrl } = context;
  const gateways = payments.listGateways();
  const findGateway = (id: string | undefined) => gateways.find((gateway) => gateway.id === id);

  app.get("/api/gateways", async () => ({ gateways }));

  app.get<{ Querystring: { gateway?: string } }>("/api/payments/config", async (request, reply) => {
    const gateway = findGateway(request.query.gateway);
    if (!gateway) return reply.code(400).send({ error: "Falta una pasarela válida en ?gateway=" });
    return payments.publicConfig(gateway.id);
  });

  app.get<{ Querystring: { gateway?: string } }>("/api/pse-banks", async (request, reply) => {
    const gateway = findGateway(request.query.gateway);
    if (!gateway) return reply.code(400).send({ error: "Falta una pasarela válida en ?gateway=" });
    try {
      return { banks: await payments.listPseBanks(gateway.id) };
    } catch (error) {
      if (!(error instanceof PaymentTechnicalError)) throw error;
      return reply.code(502).send({ error: error.message });
    }
  });

  app.post<{ Body: CreateOrderBody }>("/api/orders", { schema: createOrderSchema(gateways) }, async (request, reply) => {
    const { gateway: gatewayId, payer, method, items } = request.body;
    const gateway = findGateway(gatewayId) as GatewayOption;
    if (method.type === "CARD" && gateway.cardCapture === "BROWSER_TOKEN" && !method.cardToken) {
      return reply.code(400).send({ error: `Petición inválida: ${gateway.name} cobra la tarjeta con un token del navegador` });
    }
    const lines = orderLines(items);
    const order = orders.create({
      gateway: gateway.id,
      lines,
      amountInPesos: linesTotal(lines),
      payer,
      method: method.type,
    });
    trace(
      `  orden ${order.id}: ${orderDescription(lines)} por $${order.amountInPesos.toLocaleString("es-CO")} COP, ` +
        `${methodWords(method)}, con ${gateway.name} → módulo de pagos`,
    );
    try {
      const payment = await payments.createPayment({
        gateway: gateway.id,
        orderReference: order.id,
        amountInPesos: order.amountInPesos,
        description: orderDescription(lines),
        payer,
        method,
        returnUrl: `${publicBaseUrl}/orders/${order.id}`,
        payerIp: request.ip,
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
      const payment = await payments.getPaymentStatus(order.gateway, order.transactionId);
      orders.record(order, { source: "query", status: payment.status, nativeStatus: payment.nativeStatus });
      return { order };
    } catch (error) {
      return technicalFailure(error, reply, order);
    }
  });
}
