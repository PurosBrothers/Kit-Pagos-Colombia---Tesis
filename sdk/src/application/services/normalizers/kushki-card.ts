/**
 * La respuesta real de un cobro con tarjeta de Kushki, y por qué necesita traducción.
 *
 * ## Lo que se midió (19 de septiembre de 2026, api-uat.kushkipagos.com)
 *
 * El SDK cobraba con tarjeta en `POST /charges` y esperaba una respuesta con
 * `ticketNumber`, `transaction_status`, `amount` y `contactDetails` en la raíz. Nada de
 * eso era cierto contra la API real:
 *
 * - `POST /charges` **no existe**: responde `403 Forbidden`, igual que una ruta de
 *   control inventada. La ruta real es `POST /card/v1/charges`, que responde `201`.
 * - La respuesta de ese cobro es `{ ticketNumber, transactionReference }` y nada más.
 *   Sin `amount`, el normalizador fallaba con `MALFORMED_RESPONSE: missing amount`.
 * - Con `fullResponse: true` sí viene todo, pero **anidado en `details`** y con otros
 *   nombres: `details.transactionStatus` en camelCase en vez de `transaction_status`,
 *   y los montos sueltos (`subtotalIva0`, `ivaValue`, `iceValue`, `currencyCode`) en
 *   vez de un objeto `amount`.
 *
 * ## Por qué aplanar y no agregar un segundo camino al normalizador
 *
 * Porque la suma de los cuatro componentes del monto, la elección de la referencia del
 * comercio y el mapeo de estados ya están escritos y probados una vez en
 * `KushkiResponseNormalizer`. Duplicarlos para la forma anidada sería el mismo defecto
 * que el punto 46 corrigió en los estados: dos copias de la misma traducción, que se
 * desincronizan en cuanto una cambia. Acá se traduce **solo la forma**, y el significado
 * lo sigue dando un único lugar.
 *
 * La forma plana, entonces, es la forma canónica interna. Sigue existiendo de verdad en
 * la consulta de estado del simulador, que es la única que la produce: contra la API real
 * no se encontró ninguna ruta de consulta de cobros con tarjeta (se probaron catorce
 * candidatas y todas responden como la ruta de control). Ver el punto 50 del
 * `architecture-log.md`.
 */

/** Campos del objeto `details` que el SDK lee, con los nombres que Kushki usa. */
interface KushkiChargeDetails {
  readonly transactionStatus?: unknown;
  readonly trackingCode?: unknown;
  readonly subtotalIva0?: unknown;
  readonly subtotalIva?: unknown;
  readonly ivaValue?: unknown;
  readonly iceValue?: unknown;
  readonly currencyCode?: unknown;
  readonly contactDetails?: unknown;
}

/**
 * Si la respuesta es un cobro con tarjeta pedido con `fullResponse: true`.
 *
 * Discrimina por la presencia del objeto `details`, que es el único campo que distingue
 * esta forma de las otras dos: el cobro sin `fullResponse` no lo trae, y la consulta de
 * una transferencia tampoco. No se discrimina por `ticketNumber`, porque las tres formas
 * lo traen en algún momento del ciclo de vida: ese fue justamente el error del
 * discriminador de transferencias antes de medirlo (punto 48).
 */
export function isKushkiFullResponseCharge(
  payload: Record<string, unknown>,
): boolean {
  const details = payload.details;
  return typeof details === "object" && details !== null && !Array.isArray(details);
}

/**
 * Traduce la forma anidada a la forma plana que el normalizador ya sabe leer.
 *
 * Los montos se reconstruyen en el objeto `amount` con los nombres del cobro, porque son
 * los mismos cuatro componentes con los que el SDK armó la petición: `subtotalIva0` y
 * `subtotalIva` viajan igual, y el IVA y el ICE vuelven como `ivaValue` e `iceValue`.
 */
export function flattenKushkiCharge(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const details = (payload.details ?? {}) as KushkiChargeDetails;

  return {
    ...payload,
    transaction_status: details.transactionStatus,
    trackingCode: details.trackingCode,
    contactDetails: details.contactDetails,
    amount: {
      subtotalIva0: details.subtotalIva0 ?? 0,
      subtotalIva: details.subtotalIva ?? 0,
      iva: details.ivaValue ?? 0,
      ice: details.iceValue ?? 0,
      currency: details.currencyCode ?? "COP",
    },
  };
}
