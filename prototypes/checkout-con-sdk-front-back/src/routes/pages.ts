import { FastifyInstance } from "fastify";
import { PRODUCT } from "../catalog";
import { notFoundPage, orderPage, productPage } from "../views/pages";
import { RouteContext } from "./context";

/** Las dos páginas del checkout: el producto y la orden, adonde vuelve el pagador. */
export async function pageRoutes(app: FastifyInstance, context: RouteContext): Promise<void> {
  app.get("/", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(productPage(PRODUCT));
  });

  app.get<{ Params: { id: string } }>("/orders/:id", async (request, reply) => {
    const order = context.orders.get(request.params.id);
    if (!order) return reply.code(404).type("text/html; charset=utf-8").send(notFoundPage());
    return reply.type("text/html; charset=utf-8").send(orderPage(order));
  });
}
