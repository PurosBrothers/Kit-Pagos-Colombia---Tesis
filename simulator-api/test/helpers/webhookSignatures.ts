import * as crypto from "crypto";

/**
 * Firmantes de prueba escritos a partir de la documentación oficial de cada pasarela,
 * por separado del SDK. Si coincidieran por construcción con el verificador, una prueba
 * que valida no demostraría nada: la primera versión de este archivo copió las fórmulas
 * del SDK y pasaba mientras Rapyd y Wompi rechazaban cualquier webhook real (punto 66).
 */

export interface SignedWebhook {
  payload: string;
  headers: Record<string, string>;
  /** Query string sin el `?`, para las pasarelas que firman parámetros de la URL. */
  query?: string;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Wompi (docs.wompi.co/docs/colombia/eventos/): SHA-256 sin clave de los valores de
 * `signature.properties`, que apuntan a campos de `data`, más el timestamp y el secreto.
 */
export function signWompi(
  secret: string,
  status = "APPROVED",
  timestamp = nowSeconds(),
): SignedWebhook {
  const transactionId = "12345-1668624561-38705";
  const checksum = crypto
    .createHash("sha256")
    .update(`${transactionId}${status}${timestamp}${secret}`)
    .digest("hex");
  const payload = JSON.stringify({
    event: "transaction.updated",
    data: { transaction: { id: transactionId, status } },
    environment: "test",
    signature: { properties: ["transaction.id", "transaction.status"], checksum },
    timestamp,
  });
  return { payload, headers: { "x-event-checksum": checksum } };
}

/**
 * Mercado Pago (developers, "Webhooks"): HMAC-SHA256 en hexadecimal del manifiesto
 * `id:[data.id_url];request-id:[x-request-id];ts:[ts];`, con el `data.id` del query
 * string en minúsculas. La notificación trae el mismo id en la URL y en el cuerpo.
 */
export function signMercadoPago(
  secret: string,
  timestamp = nowSeconds(),
  dataId = "1234567890",
  bodyDataId: string | null = dataId,
): SignedWebhook {
  const requestId = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
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

/** Kushki: HMAC-SHA256 en hexadecimal de `cuerpo + "." + x-kushki-id`, sobre los bytes exactos. */
export function signKushki(
  secret: string,
  payload = '{"transaction_id":"TX-KUSHKI-1","transaction_status":"APPROVAL"}',
  timestamp = nowSeconds(),
): SignedWebhook {
  const kushkiId = String(timestamp);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${payload}.${kushkiId}`)
    .digest("hex");
  return { payload, headers: { "x-kushki-signature": signature, "x-kushki-id": kushkiId } };
}

/**
 * Rapyd (docs.rapyd.net/en/webhook-authentication.html): base64 del texto hexadecimal de
 * HMAC-SHA256(URL del panel + salt + timestamp + access_key + secreto + cuerpo exacto).
 * Solo manda `salt`, `timestamp` y `signature` (docs.rapyd.net/en/webhook-format.html).
 */
export function signRapyd(
  secret: string,
  accessKey: string,
  webhookUrl: string,
  payload = '{"type":"PAYMENT_COMPLETED","data":{"id":"payment_rapyd_1"}}',
  timestamp = nowSeconds(),
): SignedWebhook {
  const salt = "Oac/iU3wivthSAIvTJdE/A==";
  const toSign = `${webhookUrl}${salt}${timestamp}${accessKey}${secret}${payload}`;
  const hex = crypto.createHmac("sha256", secret).update(toSign).digest("hex");
  return {
    payload,
    headers: { signature: Buffer.from(hex).toString("base64"), salt, timestamp: String(timestamp) },
  };
}
