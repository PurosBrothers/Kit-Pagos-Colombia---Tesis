import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import {
  BrowserEnvironment,
  CardData,
  CardTokenResult,
  TokenizeCardParams,
} from "../types";
import { resolveCatalogUrl } from "./base-url-catalog";
import { sendCardTokenRequest } from "./card-token-request";

/**
 * Catálogo cerrado de URLs base de Kushki, las mismas del SDK de servidor (`gateway-urls.ts`).
 * Es el único lugar de donde sale el host al que viaja la tarjeta: el comercio elige el
 * ambiente y no puede escribir una URL.
 */
const KUSHKI_BASE_URLS: Readonly<Record<BrowserEnvironment, string>> = {
  sandbox: "https://api-uat.kushkipagos.com",
  production: "https://api.kushkipagos.com",
  simulator: "http://localhost:3000/v1/sim/kushki",
};

/** Un monto como el de `/v1/api` y `CreatePaymentRequest.amount`: pesos, con hasta dos decimales. */
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const EXP_MONTH_PATTERN = /^\d{1,2}$/;
const EXP_YEAR_PATTERN = /^\d{2}(\d{2})?$/;

/** Kushki responde `K004` a un `Public-Merchant-Id` que no existe, con status 400 (medido). */
const INVALID_MERCHANT_CODE = "K004";

interface KushkiErrorBody {
  code?: string;
  message?: string;
}

interface KushkiCardTokenBody {
  card: {
    name: string;
    number: string;
    cvv: string;
    expiryMonth: string;
    expiryYear: string;
  };
  totalAmount: number;
  currency: string;
}

function invalidRequest(message: string): KitPagosError {
  return new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.KUSHKI, null, message);
}

function validateCardData(card: CardData): void {
  if (!card || !card.number || !card.cvc || !card.expMonth || !card.expYear || !card.cardHolder) {
    throw invalidRequest(
      "Los campos number, cvc, expMonth, expYear y cardHolder son obligatorios para tokenizar en Kushki.",
    );
  }
  const month = card.expMonth.trim();
  if (!EXP_MONTH_PATTERN.test(month) || Number(month) < 1 || Number(month) > 12) {
    throw invalidRequest("El mes de expiración debe ser un número válido entre 1 y 12.");
  }
  if (!EXP_YEAR_PATTERN.test(card.expYear.trim())) {
    throw invalidRequest("El año de expiración debe tener 2 o 4 dígitos.");
  }
}

/**
 * Kushki ata el token al monto del cobro: tokenizar por un valor y cobrar otro responde `400`
 * (medido el 17 de octubre de 2026). Por eso el monto es obligatorio aquí y no en las otras dos.
 */
function parseAmount(amount: string | undefined): number {
  const value = (amount ?? "").trim();
  if (!AMOUNT_PATTERN.test(value) || Number(value) <= 0) {
    throw invalidRequest(
      "Kushki exige el monto del cobro para tokenizar, con el mismo formato que el pago (por ejemplo '48000.00'), mayor que cero.",
    );
  }
  return Number(value);
}

function buildRequestBody(card: CardData, totalAmount: number, currency: string): KushkiCardTokenBody {
  const expYear = card.expYear.trim();
  return {
    card: {
      name: card.cardHolder.trim(),
      number: card.number.replace(/\s+/g, ""),
      cvv: card.cvc.trim(),
      expiryMonth: card.expMonth.trim().padStart(2, "0"),
      expiryYear: expYear.length === 4 ? expYear.slice(-2) : expYear,
    },
    totalAmount,
    currency,
  };
}

function mapHttpStatus(status: number, error: KushkiErrorBody): KitPagosErrorCode {
  if (error.code === INVALID_MERCHANT_CODE) return KitPagosErrorCode.INVALID_CREDENTIALS;
  if (status === 401 || status === 403) return KitPagosErrorCode.INVALID_CREDENTIALS;
  if (status === 404) return KitPagosErrorCode.RESOURCE_NOT_FOUND;
  if (status === 408) return KitPagosErrorCode.GATEWAY_TIMEOUT;
  if (status === 429) return KitPagosErrorCode.RATE_LIMIT_EXCEEDED;
  if (status >= 500 && status <= 599) return KitPagosErrorCode.GATEWAY_SERVER_ERROR;
  return KitPagosErrorCode.INVALID_REQUEST;
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function processResponse(response: Response, text: string): CardTokenResult {
  const json = parseJson(text);

  if (response.ok) {
    if (typeof json.token !== "string" || !json.token) {
      throw new KitPagosError(
        KitPagosErrorCode.MALFORMED_RESPONSE,
        Gateway.KUSHKI,
        json,
        `Kushki respondió ${response.status} sin token: no hay token que devolver.`,
      );
    }
    return { token: json.token, gateway: Gateway.KUSHKI, rawResponse: json };
  }

  const error = json as KushkiErrorBody;
  const detail = error.message
    ? `${error.message}${error.code ? ` (${error.code})` : ""}`
    : `estado HTTP ${response.status}`;
  throw new KitPagosError(
    mapHttpStatus(response.status, error),
    Gateway.KUSHKI,
    json,
    `Kushki rechazó la tokenización: ${detail}.`,
  );
}

/**
 * Tokenizador de tarjeta para Kushki mediante REST directo con el merchant id público.
 *
 * Usa solo `fetch` nativo, sin dependencias de Node.js. CORS fue medido el 17 de octubre de
 * 2026 contra UAT: el preflight de `/card/v1/tokens` responde 200 con
 * `access-control-allow-origin: *` y admite la cabecera `Public-Merchant-Id`, y el `POST`
 * desde otro origen devuelve el token. Los errores también traen el origen abierto, salvo el
 * `401` de una petición sin `Public-Merchant-Id`, que por eso se rechaza antes de enviarla.
 *
 * Kushki también ofrece campos alojados en iframes; este tokenizador no los usa: la tarjeta
 * viaja en el cuerpo JSON sobre HTTPS, como en Wompi (punto 106 del `architecture-log.md`).
 */
export class KushkiTokenizer {
  /** Resuelve la URL base de Kushki desde el catálogo cerrado. */
  static resolveBaseUrl(environment: BrowserEnvironment = "sandbox"): string {
    return resolveCatalogUrl(KUSHKI_BASE_URLS, environment, Gateway.KUSHKI);
  }

  /**
   * Tokeniza una tarjeta directamente contra Kushki, por el monto del cobro.
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
        Gateway.KUSHKI,
        null,
        "El merchant id público de Kushki es requerido.",
      );
    }

    validateCardData(card);
    const totalAmount = parseAmount(params.amount);
    const currency = (params.currency ?? "COP").trim() || "COP";

    const { response, text } = await sendCardTokenRequest(
      `${this.resolveBaseUrl(environment)}/card/v1/tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Public-Merchant-Id": publicKey.trim(),
        },
        body: JSON.stringify(buildRequestBody(card, totalAmount, currency)),
      },
      fetchFn,
      params.timeoutMs,
      Gateway.KUSHKI,
    );

    return processResponse(response, text);
  }
}
