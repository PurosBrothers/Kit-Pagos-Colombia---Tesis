import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import {
  BrowserEnvironment,
  CardData,
  CardTokenResult,
  TokenizeCardParams,
} from "../types";

/** Catálogo cerrado de URLs base oficiales de Mercado Pago. */
const MERCADOPAGO_BASE_URLS: Record<BrowserEnvironment, string> = {
  sandbox: "https://api.mercadopago.com/v1",
  production: "https://api.mercadopago.com/v1",
  simulator: "http://localhost:3000/v1/sim/mercadopago",
};

/**
 * Tokenizador de tarjeta para Mercado Pago mediante REST directo con llave pública.
 *
 * Utiliza exclusivamente `globalThis.fetch` nativo del navegador, sin dependencias de Node.js.
 * CORS fue medido y verificado (30 de septiembre de 2026): Mercado Pago responde con
 * `access-control-allow-origin: *` y status 200 al preflight OPTIONS de `/v1/card_tokens`,
 * permitiendo tokenizar directamente desde el frontend sin necesidad de scripts de terceros.
 *
 * Exige el documento de identidad del titular (`docType` y `docNumber`), obligatorio en
 * Mercado Pago para asociar el token al pagador.
 */
export class MercadoPagoTokenizer {
  /**
   * Resuelve la URL base de Mercado Pago según el ambiente configurado o una URL explícita.
   */
  static resolveBaseUrl(
    environment: BrowserEnvironment = "sandbox",
    customBaseUrl?: string,
  ): string {
    if (customBaseUrl) {
      return customBaseUrl.replace(/\/+$/, "");
    }
    return MERCADOPAGO_BASE_URLS[environment] ?? MERCADOPAGO_BASE_URLS.sandbox;
  }

  /**
   * Tokeniza una tarjeta directamente contra Mercado Pago.
   */
  static async tokenize(
    params: TokenizeCardParams,
    fetchFn: typeof fetch = globalThis.fetch,
  ): Promise<CardTokenResult> {
    const { card, publicKey, environment = "sandbox", baseUrl: customBaseUrl } = params;

    if (!publicKey || !publicKey.trim()) {
      throw new KitPagosError(
        KitPagosErrorCode.INVALID_CREDENTIALS,
        Gateway.MERCADOPAGO,
        null,
        "La clave pública de Mercado Pago es requerida.",
      );
    }

    this.validateCardData(card);

    const baseUrl = this.resolveBaseUrl(environment, customBaseUrl);
    const url = `${baseUrl}/card_tokens?public_key=${encodeURIComponent(publicKey.trim())}`;

    const expMonth = parseInt(card.expMonth.trim(), 10);
    const expYearRaw = card.expYear.trim();
    const expYear =
      expYearRaw.length === 2
        ? 2000 + parseInt(expYearRaw, 10)
        : parseInt(expYearRaw, 10);

    const requestBody = {
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

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      throw new KitPagosError(
        KitPagosErrorCode.CONNECTION_FAILED,
        Gateway.MERCADOPAGO,
        error,
        `Error de conexión al tokenizar tarjeta en Mercado Pago: ${(error as Error).message}`,
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
        Gateway.MERCADOPAGO,
        null,
        "Los campos number, cvc, expMonth, expYear y cardHolder son obligatorios para tokenizar en Mercado Pago.",
      );
    }

    // Mercado Pago exige obligatoriamente la identificación del titular
    if (!card.docType || !card.docType.trim() || !card.docNumber || !card.docNumber.trim()) {
      throw new KitPagosError(
        KitPagosErrorCode.INVALID_REQUEST,
        Gateway.MERCADOPAGO,
        null,
        "Los campos docType y docNumber del titular son obligatorios para tokenizar en Mercado Pago.",
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

    if (response.ok && json.id) {
      return {
        token: json.id as string,
        gateway: Gateway.MERCADOPAGO,
        lastFour: json.last_four_digits as string | undefined,
        rawResponse: json,
      };
    }

    if (response.status === 401 || response.status === 403) {
      throw new KitPagosError(
        KitPagosErrorCode.INVALID_CREDENTIALS,
        Gateway.MERCADOPAGO,
        json,
        "Clave pública de Mercado Pago no autorizada o inválida.",
      );
    }

    const causeList = json.cause as Array<{ description?: string }> | undefined;
    const firstCause = causeList?.[0]?.description;
    const message =
      (json.message as string | undefined) ??
      firstCause ??
      `Mercado Pago rechazó la tokenización con estado HTTP ${response.status}.`;

    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.MERCADOPAGO,
      json,
      message,
    );
  }
}
