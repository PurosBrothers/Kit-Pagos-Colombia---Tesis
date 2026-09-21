import { isRetriable } from "./ErrorHandler";

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
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        // 1. Si no es un error transitorio o ya agotamos los reintentos, relanzar inmediatamente
        if (!this.isTransient(error) || attempt >= this.maxRetries) {
          throw error;
        }

        // 2. Calcular tiempo con backoff + jitter y pausar antes del siguiente intento
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);

        attempt++;
      }
    }
  }
}
