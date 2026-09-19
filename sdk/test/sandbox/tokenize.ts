import { Credentials } from "../../src/domain/value-objects/Credentials";
import { SANDBOX_BASE_URL } from "./sandbox-env";
import { Gateway } from "../../src/domain/value-objects/Gateway";

/**
 * Tokenización de tarjetas contra cada sandbox, para poder probar el cobro.
 *
 * **Esto no es parte del SDK, y es a propósito.** Tokenizar es lo único de un cobro con
 * tarjeta que tiene que pasar por el frontend: el SDK corre en el servidor del comercio, y si
 * recibiera el número de la tarjeta lo metería dentro del alcance de PCI DSS. Así que el SDK
 * acepta un token opaco y nada más.
 *
 * Que estas funciones vivan acá tiene entonces un doble propósito: le dan a las pruebas un
 * token real, y son el ejemplo ejecutable de lo que el frontend del comercio tiene que hacer
 * antes de llamar al SDK, que es la pregunta que cualquiera se hace al ver que
 * `PaymentMethod.card()` pide un token y no una tarjeta.
 *
 * Los números son las tarjetas de prueba documentadas en `docs/testing-data/`.
 */

/** Los tokens son de un solo uso en las tres pasarelas, así que se pide uno por cobro. */
export interface CardToken {
  readonly token: string;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

function fail(gateway: Gateway, status: number, json: unknown): never {
  throw new Error(
    `No se pudo tokenizar en ${gateway}: HTTP ${status} ${JSON.stringify(json).slice(0, 300)}`,
  );
}

/**
 * Wompi: `POST /v1/tokens/cards`, autenticado con la **llave pública**.
 *
 * Es la única de las tres que tokeniza con un Bearer, y que la llave sea la pública es lo que
 * hace que esta llamada pueda salir del navegador del pagador.
 */
export async function tokenizeWompiCard(
  credentials: Credentials,
): Promise<CardToken> {
  const { status, json } = await postJson(
    `${SANDBOX_BASE_URL[Gateway.WOMPI]}/tokens/cards`,
    { Authorization: `Bearer ${credentials.publicKey}` },
    {
      number: "4242424242424242",
      cvc: "123",
      exp_month: "11",
      exp_year: "30",
      card_holder: "Jaime Pavlich",
    },
  );

  const data = json.data as { id?: string } | undefined;
  if (!data?.id) {
    fail(Gateway.WOMPI, status, json);
  }
  return { token: data.id };
}

/**
 * Mercado Pago: `POST /v1/card_tokens`, con la llave pública **en la query**.
 *
 * El nombre del titular no es decorativo: `APRO` fuerza la aprobación y otros valores fuerzan
 * cada rechazo, así que es el campo con el que se elige el desenlace.
 */
export async function tokenizeMercadoPagoCard(
  credentials: Credentials,
): Promise<CardToken> {
  const { status, json } = await postJson(
    `${SANDBOX_BASE_URL[Gateway.MERCADOPAGO]}/card_tokens?public_key=${credentials.publicKey}`,
    {},
    {
      card_number: "4013540682746260",
      expiration_month: 11,
      expiration_year: 2030,
      security_code: "123",
      cardholder: {
        name: "APRO",
        identification: { type: "CC", number: "19119119100" },
      },
    },
  );

  if (!json.id) {
    fail(Gateway.MERCADOPAGO, status, json);
  }
  return { token: json.id as string };
}

/**
 * Kushki: `POST /card/v1/tokens`, con el **merchant id público** en un header propio.
 *
 * Pide el monto al tokenizar, que las otras dos no: el token queda atado al valor del cobro,
 * así que no sirve para cobrar otra cosa.
 *
 * **La tarjeta no es la que la documentación de Kushki lista como aprobada.** Esa,
 * `5451 9515 7492 5480`, no tokeniza en esta cuenta UAT: responde
 * `400 K006 "DFR029 - Bin de tarjeta inválido"`, o sea que el BIN no está habilitado para el
 * comercio. Las tarjetas de rechazo de la misma tabla sí tokenizan, así que la tabla no está
 * mal entera, solo esa fila para esta cuenta. Se usa una Visa de prueba genérica, que
 * tokeniza y aprueba.
 */
export async function tokenizeKushkiCard(
  credentials: Credentials,
  totalAmount: number,
): Promise<CardToken> {
  const { status, json } = await postJson(
    `${SANDBOX_BASE_URL[Gateway.KUSHKI]}/card/v1/tokens`,
    { "Public-Merchant-Id": credentials.publicKey },
    {
      card: {
        name: "Jaime Pavlich",
        number: "4242424242424242",
        cvv: "123",
        expiryMonth: "11",
        expiryYear: "30",
      },
      totalAmount,
      currency: "COP",
    },
  );

  if (!json.token) {
    fail(Gateway.KUSHKI, status, json);
  }
  return { token: json.token as string };
}
