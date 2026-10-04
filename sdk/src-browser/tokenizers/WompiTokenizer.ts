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

/**
 * Catálogo cerrado de URLs base de Wompi. Es el único lugar de donde sale el host al
 * que viaja la tarjeta: el comercio elige el ambiente y no puede escribir una URL.
 */
const WOMPI_BASE_URLS: Readonly<Record<BrowserEnvironment, string>> = {
  sandbox: "https://sandbox.wompi.co/v1",
  production: "https://production.wompi.co/v1",
  simulator: "http://localhost:3000/v1/sim/wompi",
};

/** Cuerpo de error de Wompi, con la forma medida el 3 de octubre de 2026. */
interface WompiErrorBody {
  type?: string;
  reason?: string;
  code?: string;
  messages?: Record<string, string[]>;
}

/**
 * Traduce el status HTTP al mismo código que usa el SDK de servidor (`ErrorHandler`),
 * para que el comercio distinga «tus datos están mal» de «la pasarela está caída».
 */
function mapHttpStatus(status: number): KitPagosErrorCode {
  if (status === 401 || status === 403) return KitPagosErrorCode.INVALID_CREDENTIALS;
  if (status === 404) return KitPagosErrorCode.RESOURCE_NOT_FOUND;
  if (status === 408) return KitPagosErrorCode.GATEWAY_TIMEOUT;
  if (status === 429) return KitPagosErrorCode.RATE_LIMIT_EXCEEDED;
  if (status === 400 || status === 422) return KitPagosErrorCode.INVALID_REQUEST;
  if (status >= 500 && status <= 599) return KitPagosErrorCode.GATEWAY_SERVER_ERROR;
  return KitPagosErrorCode.UNKNOWN_ERROR;
}

/**
 * Elige el código del error. Una llave pública inexistente Wompi la responde con
 * `404 NOT_FOUND` y `code: "MERCHANT_NOT_FOUND"` (medido), no con 401: por el status
 * sería RESOURCE_NOT_FOUND, pero para el comercio es una credencial mala.
 */
function errorCodeFor(status: number, error: WompiErrorBody | undefined): KitPagosErrorCode {
  if (error?.code === "MERCHANT_NOT_FOUND") return KitPagosErrorCode.INVALID_CREDENTIALS;
  return mapHttpStatus(status);
}

/**
 * Arma el mensaje. Ante un número inválido Wompi responde `422` con
 * `messages: { number: [...] }` y **sin** `reason` (medido), así que el campo que falló
 * solo está en `messages`: se nombra para no perderlo.
 */
function errorMessageFor(status: number, error: WompiErrorBody | undefined): string {
  if (error?.reason) return error.reason;
  if (error?.messages) {
    const fields = Object.entries(error.messages)
      .map(([field, problems]) => `${field}: ${problems.join(", ")}`)
      .join("; ");
    return `Wompi rechazó la tokenización (${error.type ?? status}): ${fields}`;
  }
  return `Wompi rechazó la tokenización con estado HTTP ${status}${error?.type ? ` (${error.type})` : ""}.`;
}

/**
 * Tokenizador de tarjeta para Wompi mediante REST directo con llave pública.
 *
 * Usa solo `fetch` nativo, sin dependencias de Node.js. CORS fue medido: Wompi admite
 * el preflight y la llamada directa desde el navegador del pagador a `/v1/tokens/cards`.
 */
export class WompiTokenizer {
  /** Resuelve la URL base de Wompi desde el catálogo cerrado. */
  static resolveBaseUrl(environment: BrowserEnvironment = "sandbox"): string {
    return resolveCatalogUrl(WOMPI_BASE_URLS, environment, Gateway.WOMPI);
  }

  /**
   * Tokeniza una tarjeta directamente contra Wompi.
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
        Gateway.WOMPI,
        null,
        "La clave pública de Wompi es requerida.",
      );
    }

    this.validateCardData(card);

    const url = `${this.resolveBaseUrl(environment)}/tokens/cards`;

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publicKey.trim()}`,
        },
        body: JSON.stringify(this.buildRequestBody(card)),
      });
    } catch (error) {
      throw new KitPagosError(
        KitPagosErrorCode.CONNECTION_FAILED,
        Gateway.WOMPI,
        error,
        `Error de conexión al tokenizar tarjeta en Wompi: ${(error as Error).message}`,
      );
    }

    return this.handleResponse(response);
  }

  private static buildRequestBody(card: CardData): Record<string, string> {
    const expYear = card.expYear.trim();
    return {
      number: card.number.replace(/\s+/g, ""),
      cvc: card.cvc.trim(),
      exp_month: card.expMonth.trim().padStart(2, "0"),
      exp_year: expYear.length === 4 ? expYear.slice(-2) : expYear,
      card_holder: card.cardHolder.trim(),
    };
  }

  private static validateCardData(card: CardData): void {
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
        Gateway.WOMPI,
        null,
        "Los campos number, cvc, expMonth, expYear y cardHolder son obligatorios para tokenizar en Wompi.",
      );
    }
  }

  private static async handleResponse(response: Response): Promise<CardTokenResult> {
    const text = await response.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { raw: text };
    }

    if (response.ok) {
      const data = json.data as { id?: string; last_four?: string; brand?: string } | undefined;
      if (!data?.id) {
        throw new KitPagosError(
          KitPagosErrorCode.MALFORMED_RESPONSE,
          Gateway.WOMPI,
          json,
          `Wompi respondió ${response.status} sin data.id: no hay token que devolver.`,
        );
      }
      return {
        token: data.id,
        gateway: Gateway.WOMPI,
        lastFour: data.last_four,
        brand: data.brand,
        rawResponse: json,
      };
    }

    const error = json.error as WompiErrorBody | undefined;
    throw new KitPagosError(
      errorCodeFor(response.status, error),
      Gateway.WOMPI,
      json,
      errorMessageFor(response.status, error),
    );
  }
}
