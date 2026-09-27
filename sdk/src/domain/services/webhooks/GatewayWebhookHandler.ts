import { WebhookEvent } from "../../value-objects/WebhookEvent";

/**
 * Contrato que implementa el manejador de webhooks de cada pasarela.
 *
 * ## Por que hay una implementacion por pasarela
 *
 * Las cuatro pasarelas difieren en las dos operaciones a la vez:
 *
 * - **Firma**: Wompi usa SHA-256 sin clave sobre propiedades declaradas en el
 *   propio cuerpo; Rapyd y Mercado Pago usan HMAC-SHA256 pero sobre cadenas
 *   distintas y con codificaciones distintas (base64 vs hex); Kushki concatena
 *   el cuerpo con un identificador de cabecera.
 * - **Evento**: cada una expresa el resultado de forma diferente. Wompi manda un
 *   evento con estado variable, Rapyd manda un tipo de evento distinto por
 *   resultado, y Mercado Pago puede no mandar estado en absoluto.
 *
 * Mantener las dos operaciones en la misma clase por pasarela las deja juntas,
 * que es como se leen y se corrigen: al ajustar la firma de Rapyd no hay que
 * saltar a otro archivo para ver como interpreta sus eventos.
 *
 * Ver architecture-log.md, punto 34.
 */
export interface WebhookVerificationOptions {
  /** Tolerancia en segundos respecto a la hora actual. Por defecto: 300 (5 minutos). 0 desactiva la validación. */
  toleranceSeconds?: number;
  /** Timestamp de referencia en segundos Unix. Por defecto: reloj actual. Útil para pruebas y tolerancia a desvíos. */
  currentTimestamp?: number;
}

/** La notificación tal como llegó por HTTP. */
export interface IncomingWebhook {
  /** Cuerpo crudo, sin reserializar: reserializarlo rompe las firmas de Kushki y Rapyd. */
  payload: string;
  /** Cabeceras de la petición, en minúsculas. */
  headers: Record<string, string>;
  /** Parámetros de la URL. Mercado Pago firma el `data.id` que viaja aquí (punto 66). */
  query?: Record<string, string>;
}

/**
 * Lo que la verificación necesita además de la notificación. Sale siempre de la
 * configuración del comercio y nunca de la petición: un valor que el emisor pudiera
 * elegir dejaría de atar la firma a este comercio (punto 66).
 */
export interface WebhookSigningContext {
  /** Secreto de webhooks configurado en el panel de la pasarela. */
  secret: string;
  /** Llave pública de la pasarela. Rapyd la firma como su `access_key`. */
  publicKey?: string;
  /** URL registrada en el panel de la pasarela. Solo Rapyd la firma. */
  webhookUrl?: string;
}

export interface GatewayWebhookHandler {
  /**
   * Verifica la autenticidad del webhook contra la firma que envio la pasarela y valida
   * la frescura del timestamp contra la tolerancia configurada para prevenir ataques de replay.
   */
  verify(
    webhook: IncomingWebhook,
    context: WebhookSigningContext,
    options?: WebhookVerificationOptions,
  ): boolean;

  /** Traduce el webhook ya verificado al evento normalizado del dominio. */
  parse(webhook: IncomingWebhook): WebhookEvent;
}
