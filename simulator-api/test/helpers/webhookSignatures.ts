import {
  kushkiSignature,
  mercadoPagoSignature,
  rapydWebhookSignature,
  wompiEventChecksum,
} from "../../src/webhooks/signatures";

/**
 * Webhooks firmados con cuerpos fijos, para las pruebas de `POST /v1/api/webhooks/:gateway`.
 *
 * Las fórmulas viven en `src/webhooks/signatures.ts`, escritas desde la documentación oficial
 * y no desde el SDK: si coincidieran por construcción con el verificador, una prueba que valida
 * no demostraría nada. La primera versión de este archivo copió las fórmulas del SDK y pasaba
 * mientras Rapyd y Wompi rechazaban cualquier webhook real (punto 67).
 */

export interface SignedWebhook {
  payload: string;
  headers: Record<string, string>;
  /** Query string sin el `?`, para las pasarelas que firman parámetros de la URL. */
  query?: string;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Wompi: `transaction.id` y `transaction.status`, que es lo que el SDK exige que se firme. */
export function signWompi(
  secret: string,
  status = "APPROVED",
  timestamp = nowSeconds(),
): SignedWebhook {
  const transactionId = "12345-1668624561-38705";
  const checksum = wompiEventChecksum([transactionId, status], timestamp, secret);
  const payload = JSON.stringify({
    event: "transaction.updated",
    data: { transaction: { id: transactionId, status } },
    environment: "test",
    signature: { properties: ["transaction.id", "transaction.status"], checksum },
    timestamp,
  });
  return { payload, headers: { "x-event-checksum": checksum } };
}

/** Mercado Pago: la notificación trae el mismo id en la URL y en el cuerpo. */
export function signMercadoPago(
  secret: string,
  timestamp = nowSeconds(),
  dataId = "1234567890",
  bodyDataId: string | null = dataId,
): SignedWebhook {
  const requestId = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";
  const v1 = mercadoPagoSignature(dataId, requestId, String(timestamp), secret);
  const payload = JSON.stringify({
    action: "payment.updated",
    type: "payment",
    data: bodyDataId === null ? {} : { id: bodyDataId },
  });
  return {
    payload,
    headers: { "x-signature": `ts=${timestamp},v1=${v1}`, "x-request-id": requestId },
    query: `data.id=${encodeURIComponent(dataId)}&type=payment`,
  };
}

/** Kushki: sobre los bytes exactos del cuerpo. */
export function signKushki(
  secret: string,
  payload = '{"transaction_id":"TX-KUSHKI-1","transaction_status":"APPROVAL"}',
  timestamp = nowSeconds(),
): SignedWebhook {
  const kushkiId = String(timestamp);
  return {
    payload,
    headers: { "x-kushki-signature": kushkiSignature(payload, kushkiId, secret), "x-kushki-id": kushkiId },
  };
}

/** Rapyd: solo manda `salt`, `timestamp` y `signature` (docs.rapyd.net/en/webhook-format.html). */
export function signRapyd(
  secret: string,
  accessKey: string,
  webhookUrl: string,
  payload = '{"type":"PAYMENT_COMPLETED","data":{"id":"payment_rapyd_1"}}',
  timestamp = nowSeconds(),
): SignedWebhook {
  const salt = "Oac/iU3wivthSAIvTJdE/A==";
  const signature = rapydWebhookSignature({
    webhookUrl,
    salt,
    timestamp: String(timestamp),
    accessKey,
    secret,
    body: payload,
  });
  return { payload, headers: { signature, salt, timestamp: String(timestamp) } };
}
