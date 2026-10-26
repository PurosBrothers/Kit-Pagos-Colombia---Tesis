"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRoutes = apiRoutes;
const catalog_1 = require("../catalog");
const PaymentsPort_1 = require("../checkout/PaymentsPort");
const nonEmpty = { type: "string", minLength: 1 };
const createOrderSchema = {
    body: {
        type: "object",
        required: ["payer", "method"],
        properties: {
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
};
/** Un fallo técnico que el módulo no pudo resolver reintentando sale como 502; lo demás sigue al manejador. */
function technicalFailure(error, reply, order) {
    if (!(error instanceof PaymentsPort_1.PaymentTechnicalError))
        throw error;
    return reply.code(502).send({ order, error: error.message });
}
/** La API JSON del checkout, que usa el script de las páginas. */
async function apiRoutes(app, context) {
    const { payments, orders, publicBaseUrl } = context;
    app.get("/api/payments/config", async () => payments.publicConfig());
    app.get("/api/pse-banks", async (_request, reply) => {
        try {
            return { banks: await payments.listPseBanks() };
        }
        catch (error) {
            if (!(error instanceof PaymentsPort_1.PaymentTechnicalError))
                throw error;
            return reply.code(502).send({ error: error.message });
        }
    });
    app.post("/api/orders", { schema: createOrderSchema }, async (request, reply) => {
        const { payer, method } = request.body;
        const order = orders.create({
            productId: catalog_1.PRODUCT.id,
            amountInPesos: catalog_1.PRODUCT.priceInPesos,
            payer,
            method: method.type,
        });
        try {
            const payment = await payments.createPayment({
                orderReference: order.id,
                amountInPesos: order.amountInPesos,
                description: catalog_1.PRODUCT.name,
                payer,
                method,
                returnUrl: `${publicBaseUrl}/orders/${order.id}`,
            });
            orders.record(order, { source: "creation", status: payment.status, nativeStatus: payment.nativeStatus }, payment.transactionId);
            return reply.code(201).send({ order, redirectUrl: payment.redirectUrl });
        }
        catch (error) {
            if (error instanceof PaymentsPort_1.PaymentTechnicalError) {
                orders.record(order, { source: "creation", status: "ERROR", detail: error.message });
            }
            return technicalFailure(error, reply, order);
        }
    });
    app.get("/api/orders/:id", async (request, reply) => {
        const order = orders.get(request.params.id);
        if (!order)
            return reply.code(404).send({ error: `No existe la orden ${request.params.id}` });
        if (!order.transactionId)
            return { order };
        try {
            const payment = await payments.getPaymentStatus(order.transactionId);
            orders.record(order, { source: "query", status: payment.status, nativeStatus: payment.nativeStatus });
            return { order };
        }
        catch (error) {
            return technicalFailure(error, reply, order);
        }
    });
}
