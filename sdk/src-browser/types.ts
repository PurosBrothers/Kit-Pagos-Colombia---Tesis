import { Gateway } from "../src/domain/value-objects/Gateway";

/**
 * Datos de la tarjeta ingresados en el formulario del navegador.
 *
 * La forma está pensada para las dos pasarelas soportadas, no solo para Wompi:
 * - Wompi requiere: number, cvc, expMonth, expYear, cardHolder.
 * - Mercado Pago (issue #127) además exige el documento del titular.
 *
 * `docType` y `docNumber` son opcionales en el tipo porque Wompi no los pide, y
 * exigirlos ahí obligaría a un comercio que solo cobra por Wompi a pedirle al
 * pagador un dato que la pasarela no usa. El tokenizador de Mercado Pago es el que
 * los valida. Así el mismo formulario sirve para las dos (punto 77 del log).
 *
 * PCI DSS: estos datos solo viajan desde el navegador hacia el host de la pasarela,
 * que sale de un catálogo cerrado. Nunca al backend del comercio ni a `/v1/api`.
 */
export interface CardData {
  /** Número de tarjeta (13 a 19 dígitos). */
  number: string;
  /** Código de seguridad (3 o 4 dígitos). */
  cvc: string;
  /** Mes de expiración ('01' a '12'). */
  expMonth: string;
  /** Año de expiración a 2 o 4 dígitos (p. ej. '26' o '2026'). */
  expYear: string;
  /** Nombre del titular tal como figura en el plástico. */
  cardHolder: string;
  /** Tipo de documento del titular (opcional en Wompi, requerido en Mercado Pago). */
  docType?: string;
  /** Número de documento del titular (opcional en Wompi, requerido en Mercado Pago). */
  docNumber?: string;
}

/** Pasarelas soportadas para tokenización en el navegador. */
export type BrowserSupportedGateway = Gateway.WOMPI | Gateway.MERCADOPAGO;

/**
 * Ambientes disponibles. Cada uno resuelve a una URL de un catálogo cerrado dentro
 * del tokenizador: el comercio elige el ambiente, nunca escribe la URL.
 */
export type BrowserEnvironment = "sandbox" | "production" | "simulator";

/** Token efímero de tarjeta emitido por la pasarela. */
export interface CardToken {
  readonly token: string;
}

/** Resultado normalizado de la tokenización en navegador. */
export interface CardTokenResult extends CardToken {
  readonly token: string;
  readonly gateway: Gateway;
  readonly lastFour?: string;
  readonly brand?: string;
  readonly rawResponse?: unknown;
}

/** Parámetros para la operación de tokenización de tarjeta. */
export interface TokenizeCardParams {
  /** Pasarela contra la que se tokeniza la tarjeta. */
  gateway: BrowserSupportedGateway;
  /** Clave pública de la pasarela correspondiente. */
  publicKey: string;
  /** Datos de la tarjeta capturados en el frontend. */
  card: CardData;
  /** Ambiente de ejecución. Por defecto: "sandbox". */
  environment?: BrowserEnvironment;
}

/** Opciones de configuración inicial para la fachada KitPagosBrowser. */
export interface KitPagosBrowserOptions {
  /** Ambiente por defecto si no se especifica en la llamada. */
  environment?: BrowserEnvironment;
}