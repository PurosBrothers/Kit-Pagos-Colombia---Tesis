import { FastifyInstance, FastifyReply } from "fastify";
import { MAX_QUANTITY, PRODUCTS, RequestedItem, linesTotal, orderDescription, orderLines } from "../catalog";
import { GatewayOption, Payer, PaymentMethodRequest, PaymentTechnicalError } from "../checkout/PaymentsPort";
import { BackendTraceStep, captureBackendCalls, traceStep } from "../orders/backendTrace";
import { describeDecline, Order } from "../orders/OrderStore";
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
function technicalFailure(
  error: unknown,
  reply: FastifyReply,
  order: Order,
  steps: readonly BackendTraceStep[],
): FastifyReply {
  if (!(error instanceof PaymentTechnicalError)) throw error;
  return reply.code(502).send({ order, error: error.message, trace: steps });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function maskTokenPreview(token: string): string {
  return token.length > 10 ? `${token.slice(0, 8)}…` : token;
}

function methodSummary(method: PaymentMethodRequest): string {
  if (method.type === "PSE") return `PSE (banco ${method.bankCode}) → kit.createPayment()`;
  if (method.cardToken) {
    return `Token ${maskTokenPreview(method.cardToken)} (sin datos de tarjeta) → kit.createPayment()`;
  }
  return `Tarjeta en página alojada (${method.installments} cuota/s) → kit.createPayment()`;
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
    const steps: BackendTraceStep[] = [
      traceStep(
        "backend",
        "info",
        `Backend → SDK (${order.id})`,
        `$${order.amountInPesos.toLocaleString("es-CO")} COP · ${gateway.name} · ${methodSummary(method)}`,
      ),
    ];
    const started = Date.now();
    const captured = await captureBackendCalls(() =>
      payments.createPayment({
        gateway: gateway.id,
        orderReference: order.id,
        amountInPesos: order.amountInPesos,
        description: orderDescription(lines),
        payer,
        method,
        returnUrl: `${publicBaseUrl}/orders/${order.id}`,
        payerIp: request.ip,
      }),
    );
    const durationMs = Date.now() - started;
    steps.push(...captured.steps);

    if (captured.error !== undefined) {
      const errMsg = captured.error instanceof Error ? captured.error.message : String(captured.error);
      steps.push(traceStep("response", "error", "SDK → Comercio (error técnico)", errMsg, durationMs));
      if (captured.error instanceof PaymentTechnicalError) {
        orders.record(order, { source: "creation", status: "ERROR", detail: captured.error.message });
      }
      return technicalFailure(captured.error, reply, order, steps);
    }

    const payment = captured.result!;
    orders.record(
      order,
      {
        source: "creation",
        status: payment.status,
        nativeStatus: payment.nativeStatus,
        declineReason: payment.declineReason,
      },
      payment.transactionId,
    );
    const level = payment.status === "APPROVED" ? "ok" : payment.status === "PENDING" ? "warn" : "error";
    const outcomeLabel = payment.redirectUrl ? "SDK → Comercio (REDIRECT_REQUIRED)" : "SDK → Comercio (TRANSACTION)";
    const outcomeDetails = [
      `estado ${payment.status}`,
      `nativo ${payment.nativeStatus}`,
      `tx ${payment.transactionId}`,
      ...(payment.declineReason ? [`rechazo ${describeDecline(payment.declineReason)}`] : []),
      ...(payment.redirectUrl ? [`redirige a ${safeHost(payment.redirectUrl)}`] : []),
    ];
    steps.push(traceStep("response", level, outcomeLabel, outcomeDetails.join(" · "), durationMs));
    return reply.code(201).send({ order, redirectUrl: payment.redirectUrl, trace: steps });
  });

  app.get("/api/orders", async () => ({ orders: orders.list() }));

  app.get<{ Params: { id: string } }>("/api/orders/:id", async (request, reply) => {
    const order = orders.get(request.params.id);
    if (!order) return reply.code(404).send({ error: `No existe la orden ${request.params.id}` });
    if (!order.transactionId) return { order, trace: [] };
    const steps: BackendTraceStep[] = [
      traceStep("backend", "info", "Backend → SDK (getPaymentStatus)", `Orden ${order.id} · tx ${order.transactionId}`),
    ];
    const started = Date.now();
    const captured = await captureBackendCalls(() => payments.getPaymentStatus(order.gateway, order.transactionId!));
    const durationMs = Date.now() - started;
    steps.push(...captured.steps);

    if (captured.error !== undefined) {
      const errMsg = captured.error instanceof Error ? captured.error.message : String(captured.error);
      steps.push(traceStep("response", "error", "SDK → Comercio (consulta con error)", errMsg, durationMs));
      return technicalFailure(captured.error, reply, order, steps);
    }

    const payment = captured.result!;
    orders.record(order, {
      source: "query",
      status: payment.status,
      nativeStatus: payment.nativeStatus,
      declineReason: payment.declineReason,
    });
    const level = payment.status === "APPROVED" ? "ok" : payment.status === "PENDING" ? "warn" : "error";
    const details = [
      `estado ${payment.status}`,
      `nativo ${payment.nativeStatus}`,
      ...(payment.declineReason ? [`rechazo ${describeDecline(payment.declineReason)}`] : []),
    ];
    steps.push(traceStep("response", level, "SDK → Comercio (consulta)", details.join(" · "), durationMs));
    return { order, trace: steps };
  });
}
