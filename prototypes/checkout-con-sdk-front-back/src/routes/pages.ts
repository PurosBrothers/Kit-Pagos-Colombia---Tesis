import { FastifyInstance } from "fastify";
import { PRODUCTS } from "../catalog";
import { paymentsEnvironment } from "../checkout/environment";
import { notFoundPage, orderPage, ordersPage, storePage } from "../views/pages";
import { RouteContext } from "./context";

/** Las páginas de la tienda: la vitrina, el historial de pedidos y el detalle de cada orden. */
export async function pageRoutes(app: FastifyInstance, context: RouteContext): Promise<void> {
  const { environment } = paymentsEnvironment();
  const gateways = context.payments.listGateways();
  const gatewayName = (id: string) => gateways.find((gateway) => gateway.id === id)?.name ?? id;

  app.get("/", async (_request, reply) => {
    const count = context.orders.list().length;
    return reply.type("text/html; charset=utf-8").send(storePage(PRODUCTS, environment, gateways, count));
  });

  app.get("/orders", async (_request, reply) => {
    return reply
      .type("text/html; charset=utf-8")
      .send(ordersPage(context.orders.list(), environment, gatewayName));
  });

  app.get<{ Params: { id: string } }>("/orders/:id", async (request, reply) => {
    const count = context.orders.list().length;
    const order = context.orders.get(request.params.id);
    if (!order) return reply.code(404).type("text/html; charset=utf-8").send(notFoundPage(environment, count));
    return reply.type("text/html; charset=utf-8").send(orderPage(order, environment, gatewayName(order.gateway), count));
  });
}
