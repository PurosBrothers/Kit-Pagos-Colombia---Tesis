// La parte del módulo de pagos que corre en el navegador del pagador. El esqueleto la sirve
// en /payments/client.js y la llama al pagar con tarjeta: el número de la tarjeta va del
// navegador a la pasarela y nunca pasa por el servidor del comercio.
//
// Documentación oficial de Wompi:
// https://docs.wompi.co/docs/colombia/tokens/
// https://docs.wompi.co/docs/colombia/transacciones/#tokenizacion-de-tarjeta

/**
 * Tokeniza la tarjeta directamente contra Wompi en el navegador y devuelve el id del token.
 *
 * @param {{ number: string, cvc: string, expMonth: string, expYear: string, cardHolder: string }} card
 * @param {Record<string, string>} config lo que devuelve `publicConfig()` del módulo de pagos
 * @returns {Promise<string>}
 */
export async function tokenizeCard(card, config) {
  if (!config || !config.publicKey) {
    throw new Error("Configuración pública incompleta: falta publicKey");
  }

  const cleanNumber = String(card?.number || "").replace(/\s+/g, "");
  const expMonth = String(card?.expMonth || "").trim().padStart(2, "0");
  let expYear = String(card?.expYear || "").trim();
  if (expYear.length === 4) {
    expYear = expYear.slice(-2);
  }

  const baseUrl = (config.baseUrl || "http://localhost:3000/v1/sim/wompi").replace(/\/+$/, "");
  const url = `${baseUrl}/tokens/cards`;

  // POST /v1/tokens/cards autenticado con la llave pública en cabecera Bearer
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.publicKey.trim()}`,
    },
    body: JSON.stringify({
      number: cleanNumber,
      cvc: String(card?.cvc || "").trim(),
      exp_month: expMonth,
      exp_year: expYear,
      card_holder: String(card?.cardHolder || "").trim(),
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (body.error?.reason) {
      throw new Error(body.error.reason);
    }
    if (body.error?.messages) {
      const details = Object.entries(body.error.messages)
        .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(", ") : errors}`)
        .join("; ");
      throw new Error(`Wompi rechazó la tokenización: ${details}`);
    }
    throw new Error(body.error?.type || `Wompi rechazó la tokenización con estado HTTP ${response.status}`);
  }

  if (!body.data?.id) {
    throw new Error("Respuesta inválida de Wompi al tokenizar la tarjeta: falta data.id");
  }

  return body.data.id;
}
