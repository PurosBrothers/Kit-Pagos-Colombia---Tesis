// La parte del módulo de pagos que corre en el navegador del pagador. El esqueleto la sirve
// en /payments/client.js y la llama al pagar con tarjeta: el número de la tarjeta va del
// navegador a la pasarela y nunca pasa por el servidor del comercio.
//
// Hay un tokenizador por pasarela, cada uno escrito a mano contra su API (punto 117 del
// architecture-log.md). `tokenizeCard()` elige el de la pasarela que dice `config.gateway`, y va
// al final del archivo: las pruebas lo cargan como cuerpo de una función.

/**
 * Tokeniza la tarjeta directamente contra Wompi en el navegador y devuelve el id del token.
 *
 * Documentación oficial de Wompi:
 * https://docs.wompi.co/docs/colombia/tokens/
 * https://docs.wompi.co/docs/colombia/transacciones/#tokenizacion-de-tarjeta
 *
 * @param {{ number: string, cvc: string, expMonth: string, expYear: string, cardHolder: string }} card
 * @param {Record<string, string>} config lo que devuelve `publicConfig()` del módulo de pagos
 * @returns {Promise<string>}
 */
async function tokenizeWompiCard(card, config) {
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

/**
 * Tokeniza la tarjeta directamente contra Mercado Pago en el navegador y devuelve el id del token.
 *
 * La documentación oficial tokeniza con MercadoPago.js (`createCardToken`, en los métodos core);
 * aquí se llama directo a `POST /v1/card_tokens` con la llave pública, como en Wompi, porque
 * Mercado Pago responde ese endpoint con `access-control-allow-origin: *`.
 * https://www.mercadopago.com.co/developers/en/docs/checkout-api-payments/integration-configuration/card/integrate-via-core-methods
 * https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/integration-test/cards
 *
 * @param {{ number: string, cvc: string, expMonth: string, expYear: string, cardHolder: string, docType?: string, docNumber?: string }} card
 * @param {Record<string, string>} config lo que devuelve `publicConfig()` del módulo de pagos
 * @returns {Promise<string>}
 */
async function tokenizeMercadoPagoCard(card, config) {
  if (!config || !config.publicKey || !config.baseUrl) {
    throw new Error("Configuración pública incompleta: falta publicKey o baseUrl");
  }

  const expYear = String(card?.expYear || "").trim();
  const url = `${config.baseUrl.replace(/\/+$/, "")}/card_tokens?public_key=${encodeURIComponent(config.publicKey.trim())}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      card_number: String(card?.number || "").replace(/\s+/g, ""),
      expiration_month: Number(String(card?.expMonth || "").trim()),
      // Mercado Pago pide el año con cuatro cifras.
      expiration_year: Number(expYear.length === 2 ? `20${expYear}` : expYear),
      security_code: String(card?.cvc || "").trim(),
      cardholder: {
        name: String(card?.cardHolder || "").trim(),
        identification: { type: String(card?.docType || "").trim(), number: String(card?.docNumber || "").trim() },
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body.cause?.[0]?.description || body.message || `Mercado Pago rechazó la tokenización con estado HTTP ${response.status}`,
    );
  }
  if (!body.id) {
    throw new Error("Respuesta inválida de Mercado Pago al tokenizar la tarjeta: falta id");
  }
  return body.id;
}

/**
 * Tokeniza la tarjeta directamente contra Kushki en el navegador y devuelve el token.
 *
 * Kushki ata el token al monto: tokenizar por un valor y cobrar otro responde `400 K220`, así que
 * se tokeniza por el total del carrito (`config.amountInPesos`). La referencia de Colombia
 * tokeniza desde el servidor con la llave privada; aquí se usa el `Public-Merchant-Id`, como
 * Kushki.js, para que la tarjeta no pase por el servidor de la tienda (punto 106 del
 * architecture-log.md: `POST /card/v1/tokens` responde CORS abierto con la llave pública).
 * https://api-docs.kushkipagos.com/colombia/online-payments/card-payments
 *
 * @param {{ number: string, cvc: string, expMonth: string, expYear: string, cardHolder: string }} card
 * @param {Record<string, string>} config lo que devuelve `publicConfig()`, más `amountInPesos`
 * @returns {Promise<string>}
 */
async function tokenizeKushkiCard(card, config) {
  if (!config || !config.publicKey || !config.baseUrl) {
    throw new Error("Configuración pública incompleta: falta publicKey o baseUrl");
  }
  const totalAmount = Number(config.amountInPesos);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error("Kushki tokeniza por el monto del cobro, y no llegó el total del pedido");
  }

  const expYear = String(card?.expYear || "").trim();
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/card/v1/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Public-Merchant-Id": config.publicKey.trim() },
    body: JSON.stringify({
      card: {
        name: String(card?.cardHolder || "").trim(),
        number: String(card?.number || "").replace(/\s+/g, ""),
        cvv: String(card?.cvc || "").trim(),
        expiryMonth: String(card?.expMonth || "").trim().padStart(2, "0"),
        expiryYear: expYear.length === 4 ? expYear.slice(-2) : expYear,
      },
      totalAmount,
      currency: "COP",
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message ? `Kushki rechazó la tarjeta: ${body.message}` : `Kushki rechazó la tokenización con estado HTTP ${response.status}`);
  }
  if (!body.token) {
    throw new Error("Respuesta inválida de Kushki al tokenizar la tarjeta: falta token");
  }
  return body.token;
}

const TOKENIZERS = { wompi: tokenizeWompiCard, mercadopago: tokenizeMercadoPagoCard, kushki: tokenizeKushkiCard };

/**
 * Tokeniza la tarjeta contra la pasarela de `config.gateway` y devuelve el token.
 *
 * @param {{ number: string, cvc: string, expMonth: string, expYear: string, cardHolder: string, docType?: string, docNumber?: string }} card
 * @param {Record<string, string>} config lo que devuelve `publicConfig()`, más `amountInPesos`
 * @returns {Promise<string>}
 */
export async function tokenizeCard(card, config) {
  const gateway = config?.gateway || "wompi";
  const tokenize = TOKENIZERS[gateway];
  if (!tokenize) {
    throw new Error(`Esta tienda no tokeniza en el navegador las tarjetas de «${gateway}»`);
  }
  return tokenize(card, config);
}
