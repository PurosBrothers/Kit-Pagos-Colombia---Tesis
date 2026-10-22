import { FastifyInstance } from "fastify";
import { PaymentTechnicalError } from "../checkout/PaymentsPort";
import { RouteContext } from "./context";

/**
 * `POST /webhooks/:gateway`: la notificación asíncrona de una pasarela (función 4). La ruta
 * dice qué pasarela la manda, porque cada una firma distinto; el `id` es el de
 * `listGateways()`, y el esqueleto no sabe de cuál se trata.
 *
 * El cuerpo llega como texto, sin parsear: si Fastify lo convirtiera a JSON y el módulo lo
 * volviera a serializar, cualquier diferencia de espacios u orden rompería la firma (la misma
 * lección del punto 104 en `simulator-api`). Por eso el parser vive solo en este plugin.
 */
export async function webhookRoutes(app: FastifyInstance, context: RouteContext): Promise<void> {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => done(null, body));

  app.post<{ Params: { gateway: string }; Querystring: Record<string, string | undefined> }>(
    "/webhooks/:gateway",
    async (request, reply) => {
      const { gateway } = request.params;
      if (!context.payments.listGateways().some((option) => option.id === gateway)) {
        return reply.code(404).send({ error: `El checkout no cobra con la pasarela «${gateway}»` });
      }
      let notification;
      try {
        notification = await context.payments.verifyWebhook(gateway, {
          rawBody: typeof request.body === "string" ? request.body : "",
          headers: request.headers,
          query: request.query,
        });
      } catch (error) {
        if (!(error instanceof PaymentTechnicalError)) throw error;
        // Un 5xx le pide a la pasarela que vuelva a intentar más tarde.
        return reply.code(502).send({ error: error.message });
      }
      if (!notification) return reply.code(401).send({ error: "Firma del webhook inválida" });

      const order = context.orders.findByTransactionId(gateway, notification.transactionId);
      if (!order) return reply.code(200).send({ received: true, matched: false });
      context.orders.record(order, {
        source: "webhook",
        status: notification.status,
        nativeStatus: notification.nativeStatus,
      });
      return reply.code(200).send({ received: true, matched: true });
    },
  );
}
