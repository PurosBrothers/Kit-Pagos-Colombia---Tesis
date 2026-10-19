import { FastifyInstance, FastifyReply } from "fastify";
import { Gateway, KitPagosErrorCode } from "kit-pagos-colombia";
import { parseGateway, unsupportedGatewayBody } from "../kit-pagos-api/gateway-param";
import { kushkiChargeMachine, kushkiTransferMachine } from "../state/kushkiStateMachine";
import { mpOrderMachine, mpPaymentMachine } from "../state/mercadopagoStateMachine";
import { rapydPaymentMachine } from "../state/rapydStateMachine";
import { wompiStateMachine } from "../state/wompiStateMachine";
import {
  kushkiCharges,
  kushkiTransfers,
  mercadopagoOrders,
  mercadopagoPayments,
  rapydCheckouts,
  rapydPayments,
  wompiTransactions,
} from "../store/GatewayStores";
import { TransactionStore } from "../store/TransactionStore";
import { StateMachine } from "../state/StateMachine";
import {
  OutgoingWebhook,
  SignatureGenerator,
  WebhookSubject,
  WebhookUnavailableError,
} from "../webhooks/SignatureGenerator";
import { WebhookDispatcher } from "../webhooks/webhookDispatch";

export interface WebhookTriggerOptions {
  generator: SignatureGenerator;
  dispatcher: WebhookDispatcher;
}

/** Las únicas claves que acepta el cuerpo. Un campo de más es un 400, no un campo ignorado. */
const ALLOWED_KEYS = new Set(["gateway", "transactionId"]);

/** Los identificadores nativos de las cuatro pasarelas caben aquí; una URL no. */
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

interface TriggerRequest {
  gateway: Gateway;
  transactionId: string;
}

function invalidRequest(message: string) {
  return { code: KitPagosErrorCode.INVALID_REQUEST, message };
}

/**
 * Valida el cuerpo entero antes de buscar nada. El destino no es un campo del cuerpo: una
 * clave `url`, `targetUrl` o cualquier otra que no sea `gateway` o `transactionId` se rechaza,
 * y por eso ningún valor del cuerpo puede llegar a `fetch`.
 */
function parseTriggerBody(body: unknown): TriggerRequest | { error: ReturnType<typeof invalidRequest> } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: invalidRequest("The body must be a JSON object with gateway and transactionId.") };
  }
  const unexpected = Object.keys(body).filter((key) => !ALLOWED_KEYS.has(key));
  if (unexpected.length > 0) {
    return {
      error: invalidRequest(
        "Only gateway and transactionId are accepted. The target URL comes from SIMULATOR_WEBHOOK_TARGET_URL.",
      ),
    };
  }
  const { gateway: rawGateway, transactionId } = body as Record<string, unknown>;
  const gateway = parseGateway(rawGateway);
  if (gateway === undefined) {
    return { error: unsupportedGatewayBody() };
  }
  if (typeof transactionId !== "string" || !TRANSACTION_ID_PATTERN.test(transactionId)) {
    return { error: invalidRequest("transactionId must be the gateway's native identifier.") };
  }
  return { gateway, transactionId };
}

/**
 * Avanza el registro como lo haría una consulta y guarda el resultado, sin avisar a la
 * emisión automática: el trigger envía su propio webhook.
 */
function advance<TRecord, TStatus extends string>(
  store: TransactionStore<TRecord>,
  machine: StateMachine<TRecord, TStatus>,
  id: string,
): TRecord | undefined {
  const record = store.findById(id);
  if (record === undefined) {
    return undefined;
  }
  const moved = machine.transition(record, "query", { notify: false });
  if (moved !== record) {
    store.save(id, moved);
  }
  return moved;
}

function findSubject({ gateway, transactionId: id }: TriggerRequest): WebhookSubject | undefined {
  switch (gateway) {
    case Gateway.WOMPI: {
      const record = advance(wompiTransactions, wompiStateMachine, id);
      return record && { gateway, kind: "transaction", record };
    }
    case Gateway.MERCADOPAGO: {
      const payment = advance(mercadopagoPayments, mpPaymentMachine, id);
      if (payment) return { gateway, kind: "payment", record: payment };
      const order = advance(mercadopagoOrders, mpOrderMachine, id);
      return order && { gateway, kind: "order", record: order };
    }
    case Gateway.KUSHKI: {
      const charge = advance(kushkiCharges, kushkiChargeMachine, id);
      if (charge) return { gateway, kind: "charge", record: charge };
      const transfer = advance(kushkiTransfers, kushkiTransferMachine, id);
      return transfer && { gateway, kind: "transfer", record: transfer };
    }
    case Gateway.RAPYD: {
      const payment = advance(rapydPayments, rapydPaymentMachine, id);
      if (payment) return { gateway, kind: "payment", record: payment };
      // El checkout no avanza aquí: lo mueve la visita del pagador, no una consulta.
      const checkout = rapydCheckouts.findById(id);
      return checkout && { gateway, kind: "checkout", record: checkout };
    }
  }
}

function asReplayable(webhook: OutgoingWebhook) {
  return { method: "POST", query: webhook.query, headers: webhook.headers, body: webhook.body };
}

/**
 * POST /v1/sim/webhooks/trigger (issue #122, paso 7; issue #130, bloque 1).
 *
 * Firma el webhook de una transacción que el simulador tiene y lo envía al destino de
 * `SIMULATOR_WEBHOOK_TARGET_URL`. Una transacción pendiente avanza como en una consulta, así
 * que la tarjeta 4111 de Wompi se notifica `DECLINED` sin que nadie haga un GET.
 *
 * A diferencia del resto de `/v1/sim`, esta ruta exige `API_AUTH_TOKEN` cuando está
 * configurado (`DEFAULT_PROTECTED_PATHS` en `authHook.ts`): la respuesta trae el webhook
 * firmado con los secretos del servidor, que es lo que permite reenviarlo a mano, y abierta
 * sería un oráculo de firma. Sin token configurado queda abierta, como `/v1/api`, en modo de
 * desarrollo local. Con o sin token, quien llama no elige el destino: es configuración del
 * servidor, la redirección del receptor no se sigue y su cuerpo no se devuelve.
 *
 * Las firmas y cabeceras no se registran en el log: solo pasarela, transacción y estado HTTP.
 */
export async function webhookTriggerRoute(
  app: FastifyInstance,
  { generator, dispatcher }: WebhookTriggerOptions,
): Promise<void> {
  app.post("/v1/sim/webhooks/trigger", async (request, reply) => {
    const parsed = parseTriggerBody(request.body);
    if ("error" in parsed) {
      return reply.code(400).send(parsed.error);
    }

    const subject = findSubject(parsed);
    if (subject === undefined) {
      return reply.code(404).send({
        code: KitPagosErrorCode.RESOURCE_NOT_FOUND,
        message: "The simulator has no transaction with that identifier for that gateway.",
      });
    }

    let webhook: OutgoingWebhook;
    try {
      webhook = generator.generate(subject);
    } catch (error) {
      if (error instanceof WebhookUnavailableError) {
        return reply.code(409).send({ code: error.code, message: error.message, delivered: false });
      }
      throw error;
    }

    return send(reply, dispatcher, webhook, parsed);
  });
}

async function send(
  reply: FastifyReply,
  dispatcher: WebhookDispatcher,
  webhook: OutgoingWebhook,
  { gateway, transactionId }: TriggerRequest,
) {
  if (!dispatcher.hasTarget) {
    return reply.code(409).send({
      code: "WEBHOOK_TARGET_NOT_CONFIGURED",
      message: "SIMULATOR_WEBHOOK_TARGET_URL is not configured. The signed webhook is returned to send it by hand.",
      delivered: false,
      webhook: asReplayable(webhook),
    });
  }

  try {
    const { receiverStatus } = await dispatcher.deliver(webhook);
    reply.log.info({ gateway, transactionId, receiverStatus }, "Webhook delivered");
    return reply.code(200).send({ delivered: true, receiverStatus, webhook: asReplayable(webhook) });
  } catch (error) {
    reply.log.warn({ gateway, transactionId, reason: (error as Error).name }, "Webhook delivery failed");
    return reply.code(502).send({
      code: "WEBHOOK_DELIVERY_FAILED",
      message: "The configured target did not answer in time or refused the connection.",
      delivered: false,
      webhook: asReplayable(webhook),
    });
  }
}
