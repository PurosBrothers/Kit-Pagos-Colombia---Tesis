"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
const fastify_1 = __importDefault(require("fastify"));
const OrderStore_1 = require("./orders/OrderStore");
const api_1 = require("./routes/api");
const assets_1 = require("./routes/assets");
const pages_1 = require("./routes/pages");
const webhooks_1 = require("./routes/webhooks");
/** El servidor del checkout. Es del esqueleto común: idéntico en los dos prototipos. */
function buildApp(options) {
    const app = (0, fastify_1.default)({ logger: false });
    const context = { ...options, orders: options.orders ?? new OrderStore_1.OrderStore() };
    app.setErrorHandler((error, _request, reply) => {
        if (error.validation) {
            return reply.code(400).send({ error: `Petición inválida: ${error.message}` });
        }
        return reply.code(500).send({ error: error.message });
    });
    app.register(pages_1.pageRoutes, context);
    app.register(api_1.apiRoutes, context);
    app.register(webhooks_1.webhookRoutes, context);
    app.register(assets_1.assetRoutes);
    return app;
}
