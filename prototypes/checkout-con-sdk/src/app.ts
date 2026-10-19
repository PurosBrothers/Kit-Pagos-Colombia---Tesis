import Fastify, { FastifyError, FastifyInstance } from "fastify";
import { PaymentsPort } from "./checkout/PaymentsPort";
import { OrderStore } from "./orders/OrderStore";
import { apiRoutes } from "./routes/api";
import { assetRoutes } from "./routes/assets";
import { pageRoutes } from "./routes/pages";
import { webhookRoutes } from "./routes/webhooks";

export interface AppOptions {
  payments: PaymentsPort;
  /** El origen público del checkout, para la URL de retorno del banco. */
  publicBaseUrl: string;
  orders?: OrderStore;
}

/** El servidor del checkout. Es del esqueleto común: idéntico en los dos prototipos. */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const context = { ...options, orders: options.orders ?? new OrderStore() };

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: `Petición inválida: ${error.message}` });
    }
    return reply.code(500).send({ error: error.message });
  });

  app.register(pageRoutes, context);
  app.register(apiRoutes, context);
  app.register(webhookRoutes, context);
  app.register(assetRoutes);
  return app;
}
