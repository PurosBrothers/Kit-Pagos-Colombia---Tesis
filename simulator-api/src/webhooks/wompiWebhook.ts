import { Gateway } from "kit-pagos-colombia";
import { wompiEventChecksum } from "./signatures";
import { JSON_HEADERS, OutgoingWebhook, WebhookContext, WebhookSubject } from "./webhookTypes";

/** Las propiedades que el simulador firma en Wompi; el SDK exige las dos primeras. */
const WOMPI_SIGNED_PROPERTIES = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];

/**
 * Nivel 2 — https://docs.wompi.co/docs/colombia/eventos/: `event`, `data.transaction`,
 * `environment`, `signature { properties, checksum }`, `timestamp` en segundos y `sent_at`.
 * El checksum es SHA256 de los valores de `properties`, el `timestamp` y el secreto de
 * eventos; el ejemplo publicado no se reproduce con su propio secreto (ver
 * `test/webhook-signatures.test.ts`), así que la fórmula se valida contra el SDK.
 */
export function wompiWebhook(
  subject: Extract<WebhookSubject, { gateway: Gateway.WOMPI }>,
  context: WebhookContext,
): OutgoingWebhook {
  const transaction = subject.record;
  const { webhookSecret } = context.secret(Gateway.WOMPI);
  const now = context.now();
  const timestamp = Math.floor(now / 1000);
  const checksum = wompiEventChecksum(
    [transaction.id, transaction.status, transaction.amount_in_cents],
    timestamp,
    webhookSecret,
  );
  const body = JSON.stringify({
    event: "transaction.updated",
    data: { transaction },
    environment: "test",
    signature: { properties: WOMPI_SIGNED_PROPERTIES, checksum },
    timestamp,
    sent_at: new Date(now).toISOString(),
  });
  return { gateway: Gateway.WOMPI, query: null, headers: { ...JSON_HEADERS, "x-event-checksum": checksum }, body };
}
