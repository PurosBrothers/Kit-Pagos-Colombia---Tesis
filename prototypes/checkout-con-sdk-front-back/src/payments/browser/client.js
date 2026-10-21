// La parte del módulo de pagos que corre en el navegador del pagador. El esqueleto la sirve
// en /payments/client.js y la llama al pagar con tarjeta: el número de la tarjeta va del
// navegador a la pasarela y nunca pasa por el servidor del comercio.

/**
 * Tokeniza la tarjeta contra la pasarela y devuelve el token.
 *
 * @param {{ number: string, cvc: string, expMonth: string, expYear: string, cardHolder: string }} card
 * @param {Record<string, string>} config lo que devuelve `publicConfig()` del módulo de pagos
 * @returns {Promise<string>}
 */
export async function tokenizeCard(card, config) {
  void card;
  void config;
  throw new Error("El módulo de pagos de este prototipo todavía no está implementado (src/payments/browser/client.js).");
}
