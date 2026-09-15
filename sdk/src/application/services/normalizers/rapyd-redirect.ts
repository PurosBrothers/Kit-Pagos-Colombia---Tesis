import { Gateway } from "../../../domain/value-objects/Gateway";
import { GatewayTransactionId } from "../../../domain/value-objects/GatewayTransactionId";
import { PendingRedirect } from "../../../domain/value-objects/PaymentResult";

/**
 * Detecta si una respuesta de creación de pago de Rapyd exige redirigir al
 * pagador, y en ese caso extrae los datos mínimos para hacerlo.
 *
 * ## Por qué está separado del normalizador
 *
 * `RapydResponseNormalizer.normalize()` produce una `Transaction`, y una
 * redirección pendiente **no es** una transacción: es la ausencia de una. Meter
 * las dos cosas en el mismo método obligaría a que devolviera una unión y a que
 * los otros tres normalizadores cargaran un concepto que no usan.
 *
 * Es una función de módulo por lo mismo que `payload-utils.ts`: no hay estado
 * entre llamadas, y así se puede probar sin montar una petición HTTP.
 *
 * ## Por qué la regla es la presencia de `redirect_url` y no `next_action`
 *
 * Rapyd expone las dos señales. Se eligió `redirect_url` porque es la que
 * describe una consecuencia y no una categoría: si Rapyd entregó una URL, el
 * pagador tiene que ir ahí, sea por 3DS, por PSE o por lo que Rapyd agregue
 * después. `next_action` es un enum cuyo catálogo completo no se pudo verificar
 * contra el sandbox, y una lista incompleta de valores fallaría en silencio hacia
 * el lado peligroso: trataría una redirección real como pago normal, que es
 * justo el defecto que el issue #64 vino a corregir.
 */
export function extractRapydRedirect(
  rawResponse: unknown,
): PendingRedirect | null {
  const payload = rawResponse as { data?: Record<string, unknown> } | null;
  const data = payload?.data;
  if (!data) {
    return null;
  }

  const redirectUrl = data.redirect_url;
  if (typeof redirectUrl !== "string" || redirectUrl.length === 0) {
    return null;
  }

  // Si Rapyd manda una URL pero no un id, redirigir sería mandar al pagador a
  // pagar algo que después no se puede consultar. Se prefiere no reportar
  // redirección y dejar que el normalizador falle con MALFORMED_RESPONSE, que
  // dice la verdad, en vez de inventar un id vacío.
  const id = data.id;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }

  return {
    redirectUrl,
    gatewayTransactionId: new GatewayTransactionId(id, Gateway.RAPYD),
    rawStatus: String(data.status ?? ""),
  };
}
