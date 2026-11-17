import { FastifyBaseLogger } from "fastify";
import { Gateway } from "kit-pagos-colombia";
import { KushkiChargeResponse, KushkiTransferStatusResponse } from "../gateways/kushki/types";
import { MercadoPagoOrderResponse, MercadoPagoPaymentResponse } from "../gateways/mercadopago/types";
import { RapydCheckout, RapydPayment } from "../gateways/rapyd/types";
import { WompiTransaction } from "../gateways/wompi/types";
import { onStatusChange, StatusChange } from "../state/StateMachine";
import { OutgoingWebhook, SignatureGenerator, WebhookSubject, WebhookUnavailableError } from "./SignatureGenerator";
import { WebhookDispatcher } from "./webhookDispatch";

/** Cada máquina, con la pasarela y el recurso que mueve. */
function subjectOf({ machine, record }: StatusChange): WebhookSubject | undefined {
  switch (machine) {
    case "wompi.transaction":
      return { gateway: Gateway.WOMPI, kind: "transaction", record: record as WompiTransaction };
    case "mercadopago.payment":
      return { gateway: Gateway.MERCADOPAGO, kind: "payment", record: record as MercadoPagoPaymentResponse };
    case "mercadopago.order":
      return { gateway: Gateway.MERCADOPAGO, kind: "order", record: record as MercadoPagoOrderResponse };
    case "kushki.charge":
      return { gateway: Gateway.KUSHKI, kind: "charge", record: record as KushkiChargeResponse };
    case "kushki.transfer":
      return { gateway: Gateway.KUSHKI, kind: "transfer", record: record as KushkiTransferStatusResponse };
    case "rapyd.checkout":
      return { gateway: Gateway.RAPYD, kind: "checkout", record: record as RapydCheckout };
    case "rapyd.payment":
      return { gateway: Gateway.RAPYD, kind: "payment", record: record as RapydPayment };
    default:
      return undefined;
  }
}

/**
 * Entrega los avisos de un cambio uno detrás de otro, en el orden en que la pasarela los manda.
 * Una falla se registra y no detiene los siguientes.
 */
async function deliverInOrder(
  webhooks: OutgoingWebhook[],
  dispatcher: WebhookDispatcher,
  log: FastifyBaseLogger,
  context: Record<string, string>,
): Promise<void> {
  for (const webhook of webhooks) {
    try {
      const { receiverStatus } = await dispatcher.deliver(webhook);
      log.info({ ...context, receiverStatus }, "Auto webhook delivered");
    } catch (error) {
      log.warn({ ...context, reason: (error as Error).name }, "Auto webhook delivery failed");
    }
  }
}

/**
 * Emisión automática de webhooks (issue #130, bloque 1). Apagada por omisión: se enciende solo
 * con `SIMULATOR_WEBHOOK_AUTO=true` **y** un destino configurado.
 *
 * Revisa la decisión DA-03, que eligió el disparo manual; el porqué está en el
 * `architecture-log.md`. Lo que no cambia de DA-03 es que la respuesta de la pasarela no
 * depende del webhook: el envío sale sin esperar y su falla solo se registra.
 *
 * @returns La función que deja de escuchar, para el `onClose` de la app.
 */
export function startAutoEmission(
  generator: SignatureGenerator,
  dispatcher: WebhookDispatcher,
  log: FastifyBaseLogger,
): () => void {
  if (!dispatcher.autoEnabled) {
    if (dispatcher.autoRequested) {
      log.warn("SIMULATOR_WEBHOOK_AUTO is true but SIMULATOR_WEBHOOK_TARGET_URL is not set; auto emission stays off");
    }
    return () => undefined;
  }

  return onStatusChange((change) => {
    const subject = subjectOf(change);
    if (subject === undefined) {
      return;
    }
    const context = { machine: change.machine, from: change.from, to: change.to };
    try {
      void deliverInOrder(generator.generateSequence(subject), dispatcher, log, context);
    } catch (error) {
      const code = error instanceof WebhookUnavailableError ? error.code : (error as Error).name;
      log.warn({ ...context, code }, "Auto webhook skipped");
    }
  });
}
