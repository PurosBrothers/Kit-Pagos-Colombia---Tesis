import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

/**
 * Familias de error para la política de reintentos (RetryHandler).
 * - RETRIABLE: fallos transitorios de red, socket timeout, HTTP 408, 429 o HTTP 5xx.
 * - FINAL: errores definitivos que no deben reintentarse (HTTP 4xx, credenciales inválidas, rechazos de negocio).
 */
export enum ErrorFamily {
  RETRIABLE = "RETRIABLE",
  FINAL = "FINAL",
}

/**
 * Función auxiliar para clasificar un KitPagosError o KitPagosErrorCode en RETRIABLE o FINAL.
 */
export function classifyError(error: unknown): ErrorFamily {
  let code: KitPagosErrorCode | undefined;

  if (error instanceof KitPagosError) {
    code = error.code;
  } else if (
    typeof error === "string" &&
    Object.values(KitPagosErrorCode).includes(error as KitPagosErrorCode)
  ) {
    code = error as KitPagosErrorCode;
  }

  if (code) {
    switch (code) {
      case KitPagosErrorCode.CONNECTION_FAILED:
      case KitPagosErrorCode.GATEWAY_TIMEOUT:
      case KitPagosErrorCode.GATEWAY_SERVER_ERROR:
      case KitPagosErrorCode.RATE_LIMIT_EXCEEDED:
        return ErrorFamily.RETRIABLE;
      default:
        return ErrorFamily.FINAL;
    }
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    const errCode = (error as { code?: string }).code?.toUpperCase() ?? "";
    if (
      errCode === "ECONNREFUSED" ||
      errCode === "ECONNRESET" ||
      errCode === "ETIMEDOUT" ||
      errCode === "ENOTFOUND" ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("enotfound") ||
      msg.includes("network") ||
      msg.includes("fetch failed") ||
      msg.includes("connect") ||
      msg.includes("timeout") ||
      msg.includes("aborted")
    ) {
      return ErrorFamily.RETRIABLE;
    }
  }

  return ErrorFamily.FINAL;
}

/**
 * Función auxiliar que determina si un fallo es transitorio y apto para ser reintentado.
 */
export function isRetriable(error: unknown): boolean {
  return classifyError(error) === ErrorFamily.RETRIABLE;
}

/**
 * Servicio de aplicación que centraliza la traducción de cualquier fallo técnico
 * o HTTP originado por las pasarelas a excepciones tipadas KitPagosError.
 *
 * Conforme al Diagrama de Clases de la Arquitectura Hexagonal del SAD, su única
 * operación pública de instancia es:
 *   handle(rawError: unknown, gateway: Gateway): KitPagosError
 */
export class ErrorHandler {
  /**
   * Sanitiza un mensaje de texto para asegurar que ninguna credencial, token Bearer
   * o llave secreta se filtre en el mensaje público del error (RF-08).
   */
  private sanitize(message: string): string {
    if (!message) return "";

    return message
      // Ocultar cabeceras Authorization con Bearer o tokens
      .replace(/Authorization:\s*Bearer\s*[^\s,;]+/gi, "Authorization: Bearer [REDACTED]")
      .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, "Bearer [REDACTED]")
      // Ocultar llaves privadas y públicas típicas de pasarelas (Wompi, Kushki, etc.)
      .replace(/prv_[a-zA-Z0-9_-]+/gi, "[REDACTED_PRIVATE_KEY]")
      .replace(/pub_[a-zA-Z0-9_-]+/gi, "[REDACTED_PUBLIC_KEY]")
      // Ocultar patrones comunes de API Keys o Secrets en JSON o strings
      .replace(
        /(?:privateKey|secretKey|publicKey|apiKey|access_key|secret_key)\s*[:=]\s*["']?[^"'\s,;]+["']?/gi,
        (match) => {
          const parts = match.split(/[:=]/);
          return `${parts[0]}: "[REDACTED]"`;
        }
      );
  }

  private formatGatewayName(gateway: Gateway): string {
    switch (gateway) {
      case Gateway.WOMPI:
        return "Wompi";
      case Gateway.RAPYD:
        return "Rapyd";
      case Gateway.MERCADOPAGO:
        return "Mercado Pago";
      case Gateway.KUSHKI:
        return "Kushki";
      default:
        return gateway;
    }
  }

  /**
   * Traduce cualquier fallo de pasarela (error de red, respuesta HTTP no exitosa,
   * error de parseo o fallo del sistema) a una excepción tipada KitPagosError normalizada y sanitizada.
   */
  handle(rawError: unknown, gateway: Gateway): KitPagosError {
    if (rawError instanceof KitPagosError) {
      return rawError;
    }

    const gatewayName = this.formatGatewayName(gateway);
    let code: KitPagosErrorCode = KitPagosErrorCode.UNKNOWN_ERROR;
    let originalPayload: unknown = rawError;
    let message: string | undefined;

    // Caso A: Error con status HTTP (objeto { status: number, body?: unknown })
    if (typeof rawError === "object" && rawError !== null && "status" in rawError) {
      const httpStatus = Number((rawError as { status: unknown }).status);
      originalPayload =
        (rawError as { body?: unknown; data?: unknown }).body ??
        (rawError as { body?: unknown; data?: unknown }).data ??
        rawError;

      switch (httpStatus) {
        case 401:
        case 403:
          code = KitPagosErrorCode.INVALID_CREDENTIALS;
          break;
        case 404:
          code = KitPagosErrorCode.RESOURCE_NOT_FOUND;
          break;
        case 408:
          code = KitPagosErrorCode.GATEWAY_TIMEOUT;
          break;
        case 429:
          code = KitPagosErrorCode.RATE_LIMIT_EXCEEDED;
          break;
        case 400:
        case 422:
          code = KitPagosErrorCode.INVALID_REQUEST;
          break;
        default:
          if (httpStatus >= 500 && httpStatus <= 599) {
            code = KitPagosErrorCode.GATEWAY_SERVER_ERROR;
          } else {
            code = KitPagosErrorCode.UNKNOWN_ERROR;
          }
          break;
      }

      message = `${gatewayName} gateway returned an HTTP error status ${httpStatus}`;
    }
    // Caso B: Instancia de Error estándar de Node.js / JavaScript
    else if (rawError instanceof Error) {
      const msg = rawError.message.toLowerCase();
      const errCode = (rawError as { code?: string }).code?.toUpperCase() ?? "";

      if (
        errCode === "ECONNREFUSED" ||
        errCode === "ECONNRESET" ||
        errCode === "ENOTFOUND" ||
        msg.includes("econnrefused") ||
        msg.includes("econnreset") ||
        msg.includes("enotfound") ||
        msg.includes("fetch failed") ||
        msg.includes("connect")
      ) {
        code = KitPagosErrorCode.CONNECTION_FAILED;
        message = `Failed to connect to ${gatewayName} gateway: ${rawError.message}`;
      } else if (
        errCode === "ETIMEDOUT" ||
        msg.includes("timeout") ||
        msg.includes("aborted")
      ) {
        code = KitPagosErrorCode.GATEWAY_TIMEOUT;
        message = `Gateway request timed out for ${gatewayName}: ${rawError.message}`;
      } else if (rawError instanceof SyntaxError || msg.includes("json")) {
        code = KitPagosErrorCode.MALFORMED_RESPONSE;
        message = `Failed to parse JSON response from ${gatewayName} gateway`;
      } else if (msg.includes("not supported") || msg.includes("unsupported")) {
        code = KitPagosErrorCode.UNSUPPORTED_OPERATION;
        originalPayload = null;
        message = rawError.message;
      } else {
        message = rawError.message;
      }
    }
    // Caso C: String o primitivo
    else if (typeof rawError === "string") {
      message = rawError;
    }

    const sanitizedMessage = this.sanitize(message ?? code);

    return new KitPagosError(code, gateway, originalPayload, sanitizedMessage);
  }
}