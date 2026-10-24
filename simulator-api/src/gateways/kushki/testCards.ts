/**
 * Las tarjetas de prueba de Kushki y el rechazo que da cada una (punto 122).
 *
 * Nivel 1 — medido contra `api-uat.kushkipagos.com` el 24 de octubre de 2026 con la tabla de
 * `docs/testing-data/kushki.md` §1: cada tarjeta de rechazo tokeniza, y el cobro responde `400`
 * con su código en `details.responseCode` y su motivo en `details.responseText`. La «Declinada en
 * Token» no llega a cobrarse: la tokenización responde `400 017`.
 *
 * Desde el punto 106 la tarjeta de Kushki pasa por la tokenización del simulador
 * (`KitPagosBrowser`), así que el número sí llega aquí, como en Wompi y Mercado Pago. Se usa
 * para decidir el desenlace y no se guarda: lo que queda con el token es el rechazo derivado
 * (`CardTokenOutcomes`).
 */

/** El motivo de un rechazo, con el código y el texto que manda Kushki. */
export interface KushkiCardDecline {
  responseCode: string;
  responseText: string;
}

const NOT_VALID: KushkiCardDecline = { responseCode: "017", responseText: "Tarjeta no válida" };

/** Las tarjetas que tokenizan y se rechazan al cobrar. */
const CHARGE_DECLINES: ReadonlyMap<string, KushkiCardDecline> = new Map([
  ["4349003000047015", NOT_VALID],
  ["4349008516656431", { responseCode: "019", responseText: "Tarjeta no compatible" }],
  ["4349001210846432", { responseCode: "021", responseText: "Tarjeta sin fondos" }],
  ["4349003243371321", { responseCode: "022", responseText: "Imposible verificar cvv" }],
  ["4349001386781322", { responseCode: "023", responseText: "Tarjeta bloqueada por el banco" }],
]);

/** La «Declinada en Token»: Kushki la rechaza al tokenizar. */
const TOKEN_DECLINED_CARD = "4574441215190335";

/**
 * El rechazo de un cobro que no viene de una tarjeta de la tabla, como el de la cabecera o el
 * del monto reservado: el `017` de la fila «Rechazada en Cobro», que es el rechazo genérico al
 * cobrar, como `rejected_by_issuer` en Mercado Pago.
 */
export const DEFAULT_CHARGE_DECLINE = NOT_VALID;

/** Kushki manda el mismo mensaje en todos los rechazos; el motivo va en `details`. */
export const DECLINED_MESSAGE = "Transacción declinada.";

/** El `400` de la tokenización de la «Declinada en Token». Kushki manda además `processorError`. */
export const TOKEN_DECLINE_BODY = { code: "017", message: DECLINED_MESSAGE } as const;

function digits(cardNumber: string): string {
  return cardNumber.replace(/\s+/g, "");
}

/** El rechazo que da la tarjeta al cobrar, o `undefined` si no es una tarjeta de rechazo. */
export function chargeDeclineFor(cardNumber: string): KushkiCardDecline | undefined {
  return CHARGE_DECLINES.get(digits(cardNumber));
}

/** El rechazo de un código guardado con el token; uno desconocido cae en el genérico. */
export function chargeDeclineForCode(responseCode: string | undefined): KushkiCardDecline {
  return [...CHARGE_DECLINES.values()].find((decline) => decline.responseCode === responseCode) ?? DEFAULT_CHARGE_DECLINE;
}

/** Si Kushki rechaza la tarjeta al tokenizarla. */
export function isDeclinedAtTokenization(cardNumber: string): boolean {
  return digits(cardNumber) === TOKEN_DECLINED_CARD;
}
