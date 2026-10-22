// La parte del módulo de pagos que corre en el navegador del pagador. El esqueleto la sirve
// en /payments/client.js y la llama al pagar con tarjeta: el número de la tarjeta va del
// navegador a la pasarela y nunca pasa por el servidor del comercio.
//
// El prototipo B delega la tokenización en el SDK de navegador (`kit-pagos-colombia/browser`),
// que el esqueleto sirve en /vendor/kit-pagos-colombia/browser.js. Es la misma unificación
// que hace el módulo del servidor, del otro lado del formulario.

import { KitPagosBrowser } from "/vendor/kit-pagos-colombia/browser.js";

/**
 * Tokeniza la tarjeta contra la pasarela y devuelve el token.
 *
 * @param {{ number: string, cvc: string, expMonth: string, expYear: string, cardHolder: string, docType?: string, docNumber?: string }} card
 * @param {Record<string, string>} config lo que devuelve `publicConfig()` del módulo de pagos, más
 *   `amountInPesos`: hay pasarelas que atan el token al monto del cobro
 * @returns {Promise<string>}
 */
export async function tokenizeCard(card, config) {
  const result = await KitPagosBrowser.tokenizeCard({
    gateway: config.gateway,
    publicKey: config.publicKey,
    card,
    environment: config.environment,
    amount: config.amountInPesos,
    currency: "COP",
  });
  return result.token;
}
