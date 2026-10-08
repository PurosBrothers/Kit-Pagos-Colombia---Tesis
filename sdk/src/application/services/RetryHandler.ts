import { isRetriable } from "./ErrorHandler";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

export interface RetryOptions {
  /** Número máximo de reintentos tras el fallo inicial. Por defecto: 3 (SAD 2.13) */
  maxRetries?: number;
  /** Tiempo base en milisegundos. Por defecto: 1000ms (1 segundo) */
  baseDelayMs?: number;
  /** Tiempo máximo tope en milisegundos. Por defecto: 4000ms (4 segundos) */
  maxDelayMs?: number;
  /** Amplitud máxima de variación aleatoria (jitter). Por defecto: 200ms */
  jitterMs?: number;
  /** Función para pausar la ejecución (inyectable para pruebas instantáneas) */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Servicio de aplicación que implementa una política de reintentos
 * con retroceso exponencial (exponential backoff) y variación aleatoria (jitter).
 *
 * Cumple con la Arquitectura Hexagonal:
 * - Vive en la capa de aplicación porque es una política transversal neutral,
 *   independiente de pasarelas de pago tecnológicas específicas.
 * - Solo reintenta operaciones cuyo fallo sea clasificado como transitorio (RETRIABLE)
 *   por ErrorHandler.
 */
export class RetryHandler {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options?: RetryOptions) {
    this.maxRetries = options?.maxRetries ?? 3;
    this.baseDelayMs = options?.baseDelayMs ?? 1000;
    this.maxDelayMs = options?.maxDelayMs ?? 4000;
    this.jitterMs = options?.jitterMs ?? 200;
    this.sleep =
      options?.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Determina si un error es transitorio delegando en la clasificación de ErrorHandler.
   */
  isTransient(error: unknown): boolean {
    return isRetriable(error);
  }

  /**
   * Calcula el tiempo de espera con retroceso exponencial y jitter.
   * Fórmula: min(maxDelay, baseDelay * 2^attempt) + random(0, jitterMs)
   */
  calculateDelay(attempt: number): number {
    const exponential = this.baseDelayMs * Math.pow(2, attempt);
    const capped = Math.min(exponential, this.maxDelayMs);
    const jitter = Math.random() * this.jitterMs;
    return capped + jitter;
  }

  /**
   * Ejecuta una operación asíncrona. Si falla con un error RETRIABLE,
   * reintenta hasta agotar maxRetries con retroceso exponencial.
   *
   * Un error no transitorio se relanza tal cual en el primer intento. Si se agotan los
   * reintentos, se lanza `MAX_RETRIES_EXCEEDED` con el último error como `cause`
   * (ver `retriesExhausted`).
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isTransient(error)) {
          throw error;
        }
        if (attempt >= this.maxRetries) {
          throw retriesExhausted(error, attempt + 1);
        }

        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);

        attempt++;
      }
    }
  }
}

/**
 * El error que se lanza cuando un fallo transitorio persiste en todos los intentos.
 *
 * Se envuelve en vez de relanzar el último error porque, sin esto, el comercio no podía
 * distinguir «falló una vez» de «falló cuatro veces seguidas»: los dos llegaban como el
 * mismo `GATEWAY_TIMEOUT`, y `MAX_RETRIES_EXCEEDED` existía en el enum sin que nada lo
 * lanzara (issue #122). El último error viaja en `cause` y su `originalPayload` se
 * conserva, así que no se pierde lo que respondió la pasarela.
 *
 * Dos casos se relanzan sin envolver:
 * - `maxRetries: 0` (un solo intento): el comercio desactivó los reintentos, y decirle que
 *   se excedieron sería falso y le escondería el código que sí explica el fallo.
 * - Un error que no es `KitPagosError`: `KitPagosError` exige la pasarela y aquí no hay de
 *   dónde sacarla. No ocurre desde la fachada, porque los adaptadores traducen todo fallo
 *   con `ErrorHandler` antes de que llegue aquí.
 */
function retriesExhausted(lastError: unknown, attempts: number): unknown {
  if (attempts === 1 || !(lastError instanceof KitPagosError)) {
    return lastError;
  }
  return new KitPagosError(
    KitPagosErrorCode.MAX_RETRIES_EXCEEDED,
    lastError.gateway,
    lastError.originalPayload,
    `Gave up after ${attempts} attempts (1 initial + ${attempts - 1} retries); ` +
      `last error ${lastError.code}: ${lastError.message}`,
    { cause: lastError },
  );
}
