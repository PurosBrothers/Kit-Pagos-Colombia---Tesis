import Fastify, { FastifyError, FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AppConfig } from "./config";
import { OrderStore } from "./orders/OrderStore";
import { PaymentService } from "./payments/PaymentService";
import { apiRoutes } from "./routes/api";

export interface AppOptions {
  config: AppConfig;
  payments?: PaymentService;
  orders?: OrderStore;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const config = options.config;
  const payments = options.payments || new PaymentService(config);
  const orders = options.orders || new OrderStore();

  // Middleware para capturar cuerpo crudo en webhooks
  app.addContentTypeParser(
    ["application/json", "text/plain"],
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // Hook para parsear JSON cuando corresponda
  app.addHook("preValidation", async (req) => {
    if (typeof req.body === "string" && req.headers["content-type"]?.includes("application/json")) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        // Dejar como string si no es JSON válido
      }
    }
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: `Petición inválida: ${error.message}` });
    }
    return reply.code(500).send({ error: error.message });
  });

  // Rutas estáticas para la página y assets
  const publicDir = existsSync(path.resolve(__dirname, "public"))
    ? path.resolve(__dirname, "public")
    : path.resolve(__dirname, "..", "src", "public");

  app.get("/", async (_request, reply) => {
    const html = readFileSync(path.join(publicDir, "index.html"), "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/styles.css", async (_request, reply) => {
    const css = readFileSync(path.join(publicDir, "styles.css"), "utf8");
    return reply.type("text/css; charset=utf-8").send(css);
  });

  app.get("/checkout.js", async (_request, reply) => {
    const js = readFileSync(path.join(publicDir, "checkout.js"), "utf8");
    return reply.type("text/javascript; charset=utf-8").send(js);
  });

  // Rutas API
  app.register(apiRoutes, { config, payments, orders });

  return app;
}
