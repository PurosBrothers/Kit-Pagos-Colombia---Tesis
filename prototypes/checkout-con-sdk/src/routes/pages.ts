import { FastifyInstance } from "fastify";
import { PRODUCTS } from "../catalog";
import { paymentsEnvironment } from "../checkout/environment";
import { notFoundPage, orderPage, storePage } from "../views/pages";
import { RouteContext } from "./context";

/** Las dos páginas de la tienda: la vitrina con el carrito y la orden, adonde vuelve el pagador. */
export async function pageRoutes(app: FastifyInstance, context: RouteContext): Promise<void> {
  const { environment } = paymentsEnvironment();
  const gateways = context.payments.listGateways();
  const gatewayName = (id: string) => gateways.find((gateway) => gateway.id === id)?.name ?? id;

  app.get("/", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(storePage(PRODUCTS, environment, gateways));
  });

  app.get<{ Params: { id: string } }>("/orders/:id", async (request, reply) => {
    const order = context.orders.get(request.params.id);
    if (!order) return reply.code(404).type("text/html; charset=utf-8").send(notFoundPage(environment));
    return reply.type("text/html; charset=utf-8").send(orderPage(order, environment, gatewayName(order.gateway)));
  });
}
