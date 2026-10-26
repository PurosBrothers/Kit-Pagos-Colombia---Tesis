"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageRoutes = pageRoutes;
const catalog_1 = require("../catalog");
const pages_1 = require("../views/pages");
/** Las dos páginas del checkout: el producto y la orden, adonde vuelve el pagador. */
async function pageRoutes(app, context) {
    app.get("/", async (_request, reply) => {
        return reply.type("text/html; charset=utf-8").send((0, pages_1.productPage)(catalog_1.PRODUCT));
    });
    app.get("/orders/:id", async (request, reply) => {
        const order = context.orders.get(request.params.id);
        if (!order)
            return reply.code(404).type("text/html; charset=utf-8").send((0, pages_1.notFoundPage)());
        return reply.type("text/html; charset=utf-8").send((0, pages_1.orderPage)(order));
    });
}
