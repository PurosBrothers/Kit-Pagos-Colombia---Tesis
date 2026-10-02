import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import {
  BrowserEnvironment,
  CardData,
  CardTokenResult,
  TokenizeCardParams,
} from "../types";

/** Catálogo cerrado de URLs base oficiales de Wompi. */
const WOMPI_BASE_URLS: Record<BrowserEnvironment, string> = {
  sandbox: "https://sandbox.wompi.co/v1",
  production: "https://production.wompi.co/v1",
  simulator: "http://localhost:3000/v1/sim/wompi",
};

/**
 * Tokenizador de tarjeta para Wompi mediante REST directo con llave pública.
 *
 * Utiliza exclusivamente `globalThis.fetch` nativo del navegador, sin dependencias de Node.js.
 * CORS fue medido y verificado: Wompi admite preflight OPTIONS y llamadas directas desde
 * el navegador del pagador hacia `/v1/tokens/cards`.
 */
export class WompiTokenizer {
  /**
   * Resuelve la URL base de Wompi según el ambiente configurado o una URL explícita.
   */
  static resolveBaseUrl(
    environment: BrowserEnvironment = "sandbox",
    customBaseUrl?: string,
  ): string {
    if (customBaseUrl) {
      return customBaseUrl.replace(/\/+$/, "");
    }
    return WOMPI_BASE_URLS[environment] ?? WOMPI_BASE_URLS.sandbox;
  }

  /**
   * Tokeniza una tarjeta directamente contra Wompi.
   */
  static async tokenize(
    params: TokenizeCardParams,
    fetchFn: typeof fetch = globalThis.fetch,
  ): Promise<CardTokenResult> {
    const { card, publicKey, environment = "sandbox", baseUrl: customBaseUrl } = params;

    if (!publicKey || !publicKey.trim()) {
      throw new KitPagosError(
        KitPagosErrorCode.INVALID_CREDENTIALS,
        Gateway.WOMPI,
        null,
        "La clave pública de Wompi es requerida.",
      );
    }

    this.validateCardData(card);

    const baseUrl = this.resolveBaseUrl(environment, customBaseUrl);
    const url = `${baseUrl}/tokens/cards`;

    const expMonth = card.expMonth.trim().padStart(2, "0");
    const expYear =
      card.expYear.trim().length === 4
        ? card.expYear.trim().slice(-2)
        : card.expYear.trim();

    const requestBody = {
      number: card.number.replace(/\s+/g, ""),
      cvc: card.cvc.trim(),
      exp_month: expMonth,
      exp_year: expYear,
      card_holder: card.cardHolder.trim(),
    };

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publicKey.trim()}`,
        },
        body: JSON.stringify(requestBody),
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
      const data = json.data as
        | { id?: string; last_four?: string; brand?: string }
        | undefined;
      if (data?.id) {
        return {
          token: data.id,
          gateway: Gateway.WOMPI,
          lastFour: data.last_four,
          brand: data.brand,
          rawResponse: json,
        };
      }
    }

    if (response.status === 401) {
      throw new KitPagosError(
        KitPagosErrorCode.INVALID_CREDENTIALS,
        Gateway.WOMPI,
        json,
        "Clave pública de Wompi no autorizada o inválida.",
      );
    }

    const errorObj = json.error as { reason?: string; type?: string } | undefined;
    const message =
      errorObj?.reason ??
      errorObj?.type ??
      `Wompi rechazó la tokenización con estado HTTP ${response.status}.`;

    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.WOMPI,
      json,
      message,
    );
  }
}
