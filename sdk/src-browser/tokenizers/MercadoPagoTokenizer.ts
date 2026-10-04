import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import {
  BrowserEnvironment,
  CardData,
  CardTokenResult,
  TokenizeCardParams,
} from "../types";

/**
 * Catálogo cerrado de URLs base de Mercado Pago. Es el único lugar de donde sale el host al
 * que viaja la tarjeta: el comercio elige el ambiente y no puede escribir una URL.
 */
const MERCADOPAGO_BASE_URLS: Readonly<Record<BrowserEnvironment, string>> = {
  sandbox: "https://api.mercadopago.com/v1",
  production: "https://api.mercadopago.com/v1",
  simulator: "http://localhost:3000/v1/sim/mercadopago",
};

interface MercadoPagoErrorResponse {
  message?: string;
  error?: string;
  status?: number;
  cause?: Array<{ code?: string | number; description?: string }>;
}

interface MercadoPagoCardTokenBody {
  card_number: string;
  expiration_month: number;
  expiration_year: number;
  security_code: string;
  cardholder: {
    name: string;
    identification: {
      type: string;
      number: string;
    };
  };
}

/** Valida los campos de la tarjeta requeridos para tokenizar en Mercado Pago. */
function validateCardData(card: CardData): void {
  if (
    !card ||
    !card.number ||
    !card.cvc ||
    !card.expMonth ||
    !card.expYear ||
    !card.cardHolder
  ) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.MERCADOPAGO,
      null,
      "Los campos number, cvc, expMonth, expYear y cardHolder son obligatorios para tokenizar en Mercado Pago.",
    );
  }

  // La API emite el token sin identificación; exigirla es decisión del SDK (punto 78 del architecture-log.md).
  if (!card.docType || !card.docType.trim() || !card.docNumber || !card.docNumber.trim()) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.MERCADOPAGO,
      null,
      "Los campos docType y docNumber del titular son obligatorios para tokenizar en Mercado Pago.",
    );
  }

  const expMonth = parseInt(card.expMonth.trim(), 10);
  if (Number.isNaN(expMonth) || expMonth < 1 || expMonth > 12) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.MERCADOPAGO,
      null,
      "El mes de expiración debe ser un número válido entre 1 y 12.",
    );
  }

  const expYearRaw = card.expYear.trim();
  const expYear = parseInt(expYearRaw, 10);
  if (Number.isNaN(expYear) || expYear <= 0) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.MERCADOPAGO,
      null,
      "El año de expiración debe ser un número válido.",
    );
  }
}

/** Construye el cuerpo JSON para POST /v1/card_tokens. */
function buildRequestBody(card: CardData): MercadoPagoCardTokenBody {
  const expMonth = parseInt(card.expMonth.trim(), 10);
  const expYearRaw = card.expYear.trim();
  const expYear =
    expYearRaw.length === 2
      ? 2000 + parseInt(expYearRaw, 10)
      : parseInt(expYearRaw, 10);

  return {
    card_number: card.number.replace(/\s+/g, ""),
    expiration_month: expMonth,
    expiration_year: expYear,
    security_code: card.cvc.trim(),
    cardholder: {
      name: card.cardHolder.trim(),
      identification: {
        type: card.docType!.trim(),
        number: card.docNumber!.trim(),
      },
    },
  };
}

/** Mapea el código de status HTTP a KitPagosErrorCode. */
function mapHttpStatus(status: number): KitPagosErrorCode {
  if (status === 401 || status === 403) return KitPagosErrorCode.INVALID_CREDENTIALS;
  if (status === 404) return KitPagosErrorCode.RESOURCE_NOT_FOUND;
  if (status === 408) return KitPagosErrorCode.GATEWAY_TIMEOUT;
  if (status === 429) return KitPagosErrorCode.RATE_LIMIT_EXCEEDED;
  if (status >= 500 && status <= 599) return KitPagosErrorCode.GATEWAY_SERVER_ERROR;
  return KitPagosErrorCode.INVALID_REQUEST;
}

/** Extrae el mensaje de error más específico de la respuesta de Mercado Pago. */
function extractErrorMessage(status: number, json: MercadoPagoErrorResponse): string {
  if (status === 401 || status === 403) {
    return "Clave pública de Mercado Pago no autorizada o inválida.";
  }
  const firstCause = json.cause?.[0]?.description;
  if (firstCause) return firstCause;
  if (json.message) return json.message;
  return `Mercado Pago rechazó la tokenización con estado HTTP ${status}.`;
}

/** Parsea el texto de respuesta de manera segura. */
function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

/** Procesa la respuesta HTTP y la convierte en CardTokenResult o lanza KitPagosError. */
function processResponse(response: Response, text: string): CardTokenResult {
  const json = parseJson(text);

  if (response.ok) {
    if (!json.id) {
      throw new KitPagosError(
        KitPagosErrorCode.MALFORMED_RESPONSE,
        Gateway.MERCADOPAGO,
        json,
        `Mercado Pago respondió ${response.status} sin id de token: no hay token que devolver.`,
      );
    }
    return {
      token: json.id as string,
      gateway: Gateway.MERCADOPAGO,
      lastFour: json.last_four_digits as string | undefined,
      rawResponse: json,
    };
  }

  const errorCode = mapHttpStatus(response.status);
  const message = extractErrorMessage(response.status, json as MercadoPagoErrorResponse);

  throw new KitPagosError(errorCode, Gateway.MERCADOPAGO, json, message);
}

/**
 * Tokenizador de tarjeta para Mercado Pago mediante REST directo con llave pública.
 *
 * Utiliza exclusivamente `globalThis.fetch` nativo del navegador, sin dependencias de Node.js.
 * CORS fue medido y verificado (30 de septiembre de 2026): Mercado Pago responde con
 * `access-control-allow-origin: *` y status 200 al preflight OPTIONS de `/v1/card_tokens`,
 * permitiendo tokenizar directamente desde el frontend sin necesidad de scripts de terceros.
 *
 * Exige el documento de identidad del titular (`docType` y `docNumber`). Mercado Pago no lo
 * exige para emitir el token; es una decisión del SDK (ver el punto 78 del architecture-log.md).
 */
export class MercadoPagoTokenizer {
  /** Resuelve la URL base de Mercado Pago desde el catálogo cerrado. */
  static resolveBaseUrl(environment: BrowserEnvironment = "sandbox"): string {
    return MERCADOPAGO_BASE_URLS[environment] ?? MERCADOPAGO_BASE_URLS.sandbox;
  }

  /**
   * Tokeniza una tarjeta directamente contra Mercado Pago.
   *
   * `fetchFn` existe para las pruebas unitarias; no cambia el host, que sigue
   * saliendo del catálogo.
   */
  static async tokenize(
    params: TokenizeCardParams,
    fetchFn: typeof fetch = globalThis.fetch,
  ): Promise<CardTokenResult> {
    const { card, publicKey, environment = "sandbox" } = params;

    if (!publicKey || !publicKey.trim()) {
      throw new KitPagosError(
        KitPagosErrorCode.INVALID_CREDENTIALS,
        Gateway.MERCADOPAGO,
        null,
        "La clave pública de Mercado Pago es requerida.",
      );
    }

    validateCardData(card);

    const baseUrl = this.resolveBaseUrl(environment);
    const url = `${baseUrl}/card_tokens?public_key=${encodeURIComponent(publicKey.trim())}`;

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildRequestBody(card)),
      });
    } catch (error) {
      throw new KitPagosError(
        KitPagosErrorCode.CONNECTION_FAILED,
        Gateway.MERCADOPAGO,
        error,
        `Error de conexión al tokenizar tarjeta en Mercado Pago: ${(error as Error).message}`,
      );
    }

    const text = await response.text();
    return processResponse(response, text);
  }
}
