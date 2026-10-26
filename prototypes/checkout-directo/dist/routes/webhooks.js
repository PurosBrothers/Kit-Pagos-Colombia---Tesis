"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookRoutes = webhookRoutes;
const PaymentsPort_1 = require("../checkout/PaymentsPort");
/**
 * `POST /webhooks`: la notificación asíncrona de la pasarela (función 4).
 *
 * El cuerpo llega como texto, sin parsear: si Fastify lo convirtiera a JSON y el módulo lo
 * volviera a serializar, cualquier diferencia de espacios u orden rompería la firma (la misma
 * lección del punto 104 en `simulator-api`). Por eso el parser vive solo en este plugin.
 */
async function webhookRoutes(app, context) {
    app.removeAllContentTypeParsers();
    app.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => done(null, body));
    app.post("/webhooks", async (request, reply) => {
        let notification;
        try {
            notification = await context.payments.verifyWebhook({
                rawBody: typeof request.body === "string" ? request.body : "",
                headers: request.headers,
                query: request.query,
            });
        }
        catch (error) {
            if (!(error instanceof PaymentsPort_1.PaymentTechnicalError))
                throw error;
            // Un 5xx le pide a la pasarela que vuelva a intentar más tarde.
            return reply.code(502).send({ error: error.message });
        }
        if (!notification)
            return reply.code(401).send({ error: "Firma del webhook inválida" });
        const order = context.orders.findByTransactionId(notification.transactionId);
        if (!order)
            return reply.code(200).send({ received: true, matched: false });
        context.orders.record(order, {
            source: "webhook",
            status: notification.status,
            nativeStatus: notification.nativeStatus,
        });
        return reply.code(200).send({ received: true, matched: true });
    });
}
