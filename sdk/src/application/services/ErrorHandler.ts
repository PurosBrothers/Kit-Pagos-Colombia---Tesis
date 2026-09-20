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

/** Códigos de `KitPagosError` que describen un fallo transitorio. */
const RETRIABLE_CODES: readonly KitPagosErrorCode[] = [
  KitPagosErrorCode.CONNECTION_FAILED,
  KitPagosErrorCode.GATEWAY_TIMEOUT,
  KitPagosErrorCode.GATEWAY_SERVER_ERROR,
  KitPagosErrorCode.RATE_LIMIT_EXCEEDED,
];

/**
 * Detecta las señales de que un `Error` nativo es un fallo de conexión.
 *
 * Se inspeccionan tanto `error.code` como el mensaje porque no todas las capas
 * propagan el código: `fetch` envuelve el fallo de socket en un mensaje genérico
 * ("fetch failed") y pierde el `ECONNREFUSED` original.
 */
function hasConnectionSignal(errCode: string, msg: string): boolean {
  return (
    errCode === "ECONNREFUSED" ||
    errCode === "ECONNRESET" ||
    errCode === "ENOTFOUND" ||
    errCode === "ENETUNREACH" ||
    errCode === "ENETDOWN" ||
    errCode === "EAI_AGAIN" ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("connect")
  );
}

/** Detecta las señales de que un `Error` nativo es un timeout. */
function hasTimeoutSignal(errCode: string, msg: string): boolean {
  return (
    errCode === "ETIMEDOUT" ||
    msg.includes("timeout") ||
    msg.includes("aborted")
  );
}

/** Normaliza el `code` de un `Error` nativo a mayúsculas, o cadena vacía. */
function nativeErrorCode(error: Error): string {
  return (error as { code?: string }).code?.toUpperCase() ?? "";
}

/**
 * Función auxiliar para clasificar un KitPagosError, KitPagosErrorCode o Error en RETRIABLE o FINAL.
 *
 * Utiliza las señales de conexión (hasConnectionSignal) y timeout (hasTimeoutSignal),
 * garantizando simetría total con ErrorHandler.handle().
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
    return RETRIABLE_CODES.includes(code)
      ? ErrorFamily.RETRIABLE
      : ErrorFamily.FINAL;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    const errCode = nativeErrorCode(error);
    if (
      hasConnectionSignal(errCode, msg) ||
      hasTimeoutSignal(errCode, msg)
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
 * Sanitiza un mensaje de texto para asegurar que ninguna credencial, token Bearer
 * o llave secreta se filtre en el mensaje público del error (RF-08).
 */
function sanitize(message: string): string {
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
      // La lista es por nombre, así que **un campo nuevo en `Credentials` tiene que
      // agregarse acá o se filtra**. `webhookSecret` entró por eso, con el campo.
      /(?:privateKey|secretKey|publicKey|apiKey|access_key|secret_key|integritySecret|webhookSecret|acceptance_token)\s*[:=]\s*["']?[^"'\s,;]+["']?/gi,
      (match) => {
        const parts = match.split(/[:=]/);
        return `${parts[0]}: "[REDACTED]"`;
      }
    );
}

/** Nombre comercial de la pasarela, para los mensajes que ve el comercio. */
function formatGatewayName(gateway: Gateway): string {
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
 * Traduce un status HTTP al código de error tipado equivalente.
 *
 * 401 y 403 colapsan en INVALID_CREDENTIALS porque las pasarelas no son
 * consistentes en cuál devuelven ante una llave inválida, y para el comercio la
 * acción correctiva es la misma.
 */
function mapHttpStatus(httpStatus: number): KitPagosErrorCode {
  switch (httpStatus) {
    case 401:
    case 403:
      return KitPagosErrorCode.INVALID_CREDENTIALS;
    case 404:
      return KitPagosErrorCode.RESOURCE_NOT_FOUND;
    case 408:
      return KitPagosErrorCode.GATEWAY_TIMEOUT;
    case 429:
      return KitPagosErrorCode.RATE_LIMIT_EXCEEDED;
    case 400:
    case 422:
      return KitPagosErrorCode.INVALID_REQUEST;
    default:
      return httpStatus >= 500 && httpStatus <= 599
        ? KitPagosErrorCode.GATEWAY_SERVER_ERROR
        : KitPagosErrorCode.UNKNOWN_ERROR;
  }
}

/** Resultado intermedio de clasificar un fallo, antes de sanitizar el mensaje. */
interface Classified {
  code: KitPagosErrorCode;
  originalPayload: unknown;
  message?: string;
}

/**
 * Servicio de aplicación que centraliza la traducción de cualquier fallo técnico
 * o HTTP originado por las pasarelas a excepciones tipadas KitPagosError.
 *
 * Conforme al Diagrama de Clases de la Arquitectura Hexagonal del SAD, su única
 * operación pública de instancia es:
 *   handle(rawError: unknown, gateway: Gateway): KitPagosError
 *
 * ## Estructura
 *
 * A diferencia de ResponseNormalizer y WebhookVerifier, esta clase no se divide
 * por pasarela: los fallos que traduce son de red y de protocolo HTTP, iguales
 * para las cuatro. Lo que varía es la **forma** del fallo entrante (respuesta HTTP
 * con status, `Error` nativo de Node, o string suelto), y es por esa forma que se
 * reparte el trabajo. Ver architecture-log.md, punto 34.
 */
export class ErrorHandler {
  /**
   * Traduce cualquier fallo de pasarela (error de red, respuesta HTTP no exitosa,
   * error de parseo o fallo del sistema) a una excepción tipada KitPagosError normalizada y sanitizada.
   */
  handle(rawError: unknown, gateway: Gateway): KitPagosError {
    if (rawError instanceof KitPagosError) {
      return rawError;
    }

    const gatewayName = formatGatewayName(gateway);
    const classified = this.classify(rawError, gatewayName);

    return new KitPagosError(
      classified.code,
      gateway,
      classified.originalPayload,
      sanitize(classified.message ?? classified.code),
    );
  }

  /** Reparte el fallo según su forma: status HTTP, Error nativo o string. */
  private classify(rawError: unknown, gatewayName: string): Classified {
    if (isHttpErrorShape(rawError)) {
      return this.fromHttpStatus(rawError, gatewayName);
    }
    if (rawError instanceof Error) {
      return this.fromNativeError(rawError, gatewayName);
    }
    if (typeof rawError === "string") {
      return {
        code: KitPagosErrorCode.UNKNOWN_ERROR,
        originalPayload: rawError,
        message: rawError,
      };
    }
    return {
      code: KitPagosErrorCode.UNKNOWN_ERROR,
      originalPayload: rawError,
    };
  }

  /** Caso A: respuesta HTTP con status, de la forma `{ status, body? }`. */
  private fromHttpStatus(rawError: object, gatewayName: string): Classified {
    const httpStatus = Number((rawError as { status: unknown }).status);
    const withBody = rawError as { body?: unknown; data?: unknown };

    return {
      code: mapHttpStatus(httpStatus),
      originalPayload: withBody.body ?? withBody.data ?? rawError,
      message: `${gatewayName} gateway returned an HTTP error status ${httpStatus}`,
    };
  }

  /** Caso B: instancia de `Error` estándar de Node.js o JavaScript. */
  private fromNativeError(rawError: Error, gatewayName: string): Classified {
    const msg = rawError.message.toLowerCase();
    const errCode = nativeErrorCode(rawError);

    if (hasTimeoutSignal(errCode, msg)) {
      return {
        code: KitPagosErrorCode.GATEWAY_TIMEOUT,
        originalPayload: rawError,
        message: `Gateway request timed out for ${gatewayName}: ${rawError.message}`,
      };
    }
    if (hasConnectionSignal(errCode, msg)) {
      return {
        code: KitPagosErrorCode.CONNECTION_FAILED,
        originalPayload: rawError,
        message: `Failed to connect to ${gatewayName} gateway: ${rawError.message}`,
      };
    }
    if (rawError instanceof SyntaxError || msg.includes("json")) {
      return {
        code: KitPagosErrorCode.MALFORMED_RESPONSE,
        originalPayload: rawError,
        message: `Failed to parse JSON response from ${gatewayName} gateway`,
      };
    }
    if (msg.includes("not supported") || msg.includes("unsupported")) {
      // El payload se descarta a propósito: una operación no soportada es un
      // error de uso del SDK, y adjuntar el Error nativo solo añadiría un stack
      // trace interno que no ayuda al comercio.
      return {
        code: KitPagosErrorCode.UNSUPPORTED_OPERATION,
        originalPayload: null,
        message: rawError.message,
      };
    }
    return {
      code: KitPagosErrorCode.UNKNOWN_ERROR,
      originalPayload: rawError,
      message: rawError.message,
    };
  }
}

/** Distingue la respuesta HTTP con status de cualquier otro objeto. */
function isHttpErrorShape(rawError: unknown): rawError is object {
  return (
    typeof rawError === "object" && rawError !== null && "status" in rawError
  );
}
