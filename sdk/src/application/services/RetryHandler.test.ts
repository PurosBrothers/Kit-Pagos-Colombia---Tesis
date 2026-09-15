import { RetryHandler } from "./RetryHandler";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Gateway } from "../../domain/value-objects/Gateway";

describe("RetryHandler", () => {
  describe("isTransient()", () => {
    const handler = new RetryHandler();

    it("clasifica como transitorios los códigos de red y servidor de KitPagosError", () => {
      const transientCodes = [
        KitPagosErrorCode.CONNECTION_FAILED,
        KitPagosErrorCode.GATEWAY_TIMEOUT,
        KitPagosErrorCode.GATEWAY_SERVER_ERROR,
        KitPagosErrorCode.RATE_LIMIT_EXCEEDED,
      ];

      for (const code of transientCodes) {
        const error = new KitPagosError(code, Gateway.WOMPI, null, "Transient error");
        expect(handler.isTransient(error)).toBe(true);
      }
    });

    it("clasifica como no transitorios los errores de negocio y credenciales", () => {
      const nonTransientCodes = [
        KitPagosErrorCode.INVALID_CREDENTIALS,
        KitPagosErrorCode.INVALID_REQUEST,
        KitPagosErrorCode.RESOURCE_NOT_FOUND,
        KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID,
      ];

      for (const code of nonTransientCodes) {
        const error = new KitPagosError(code, Gateway.WOMPI, null, "Business/client error");
        expect(handler.isTransient(error)).toBe(false);
      }
    });

    it("clasifica errores nativos de conexión y timeout como transitorios", () => {
      const connError = new Error("connect ECONNREFUSED 127.0.0.1:3000");
      (connError as unknown as { code: string }).code = "ECONNREFUSED";
      expect(handler.isTransient(connError)).toBe(true);

      const timeoutError = new Error("The operation timed out");
      (timeoutError as unknown as { code: string }).code = "ETIMEDOUT";
      expect(handler.isTransient(timeoutError)).toBe(true);

      const fetchFailedError = new Error("TypeError: fetch failed");
      expect(handler.isTransient(fetchFailedError)).toBe(true);
    });

    it("clasifica errores nativos genéricos como no transitorios", () => {
      expect(handler.isTransient(new Error("ValidationError: invalid payload"))).toBe(false);
      expect(handler.isTransient("error string")).toBe(false);
      expect(handler.isTransient(null)).toBe(false);
    });
  });

  describe("calculateDelay()", () => {
    it("calcula progresión exponencial base * 2^attempt", () => {
      // Sin jitter para probar la progresión exacta
      const handler = new RetryHandler({
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        jitterMs: 0,
      });

      expect(handler.calculateDelay(0)).toBe(1000); // 1000 * 2^0 = 1000
      expect(handler.calculateDelay(1)).toBe(2000); // 1000 * 2^1 = 2000
      expect(handler.calculateDelay(2)).toBe(4000); // 1000 * 2^2 = 4000
      expect(handler.calculateDelay(3)).toBe(4000); // Capped en maxDelayMs (4000)
      expect(handler.calculateDelay(5)).toBe(4000); // Capped en maxDelayMs (4000)
    });

    it("agrega jitter acotado dentro del rango [capped, capped + jitterMs]", () => {
      const handler = new RetryHandler({
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        jitterMs: 200,
      });

      for (let i = 0; i < 20; i++) {
        const delay0 = handler.calculateDelay(0);
        expect(delay0).toBeGreaterThanOrEqual(1000);
        expect(delay0).toBeLessThan(1200);

        const delay1 = handler.calculateDelay(1);
        expect(delay1).toBeGreaterThanOrEqual(2000);
        expect(delay1).toBeLessThan(2200);

        const delay2 = handler.calculateDelay(2);
        expect(delay2).toBeGreaterThanOrEqual(4000);
        expect(delay2).toBeLessThan(4200);
      }
    });

    it("produce retardos con variación aleatoria (jitter) entre llamadas consecutivas", () => {
      const handler = new RetryHandler({
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        jitterMs: 200,
      });

      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(handler.calculateDelay(0));
      }

      // Con Math.random() y jitterMs=200, es estadísticamente imposible obtener 10 valores idénticos
      expect(delays.size).toBeGreaterThan(1);
    });

    it("respeta parámetros de configuración personalizados", () => {
      const custom = new RetryHandler({
        baseDelayMs: 500,
        maxDelayMs: 1500,
        jitterMs: 50,
      });

      expect(custom.calculateDelay(0)).toBeGreaterThanOrEqual(500);
      expect(custom.calculateDelay(0)).toBeLessThan(550);

      expect(custom.calculateDelay(1)).toBeGreaterThanOrEqual(1000);
      expect(custom.calculateDelay(1)).toBeLessThan(1050);

      // attempt 2: 500 * 4 = 2000 > maxDelayMs (1500) -> capped en 1500
      expect(custom.calculateDelay(2)).toBeGreaterThanOrEqual(1500);
      expect(custom.calculateDelay(2)).toBeLessThan(1550);
    });
  });

  describe("execute()", () => {
    it("retorna el resultado inmediatamente si el primer intento es exitoso sin llamar a sleep", async () => {
      const sleepMock = jest.fn().mockResolvedValue(undefined);
      const handler = new RetryHandler({ sleep: sleepMock });

      const operation = jest.fn().mockResolvedValue("SUCCESS_PAYMENT");
      const result = await handler.execute(operation);

      expect(result).toBe("SUCCESS_PAYMENT");
      expect(operation).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it("reintenta y se recupera tras un fallo transitorio", async () => {
      const sleepDelays: number[] = [];
      const sleepMock = jest.fn().mockImplementation(async (ms: number) => {
        sleepDelays.push(ms);
      });

      const handler = new RetryHandler({
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        jitterMs: 0,
        sleep: sleepMock,
      });

      const transientError = new KitPagosError(
        KitPagosErrorCode.CONNECTION_FAILED,
        Gateway.WOMPI,
        null,
        "Network connection lost",
      );

      let attempts = 0;
      const operation = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw transientError;
        }
        return { id: "trans_123", status: "APPROVED" };
      });

      const result = await handler.execute(operation);

      expect(result).toEqual({ id: "trans_123", status: "APPROVED" });
      expect(operation).toHaveBeenCalledTimes(2);
      expect(sleepMock).toHaveBeenCalledTimes(1);
      expect(sleepDelays[0]).toBe(1000); // 1000 * 2^0
    });

    it("reintenta hasta el límite configurado antes de tener éxito en el último intento", async () => {
      const sleepDelays: number[] = [];
      const sleepMock = jest.fn().mockImplementation(async (ms: number) => {
        sleepDelays.push(ms);
      });

      const handler = new RetryHandler({
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        jitterMs: 0,
        sleep: sleepMock,
      });

      const timeoutError = new KitPagosError(
        KitPagosErrorCode.GATEWAY_TIMEOUT,
        Gateway.RAPYD,
        null,
        "Gateway timed out",
      );

      let attempts = 0;
      const operation = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts <= 3) {
          throw timeoutError;
        }
        return "SUCCESS_ON_4TH_TRY";
      });

      const result = await handler.execute(operation);

      expect(result).toBe("SUCCESS_ON_4TH_TRY");
      expect(operation).toHaveBeenCalledTimes(4); // 1 inicial + 3 reintentos
      expect(sleepMock).toHaveBeenCalledTimes(3);
      expect(sleepDelays).toEqual([1000, 2000, 4000]); // 1s, 2s, 4s
    });

    it("relanza inmediatamente los errores no transitorios sin reintentar ni pausar", async () => {
      const sleepMock = jest.fn().mockResolvedValue(undefined);
      const handler = new RetryHandler({ sleep: sleepMock });

      const businessError = new KitPagosError(
        KitPagosErrorCode.INVALID_CREDENTIALS,
        Gateway.MERCADOPAGO,
        null,
        "Unauthorized: invalid privateKey",
      );

      const operation = jest.fn().mockRejectedValue(businessError);

      await expect(handler.execute(operation)).rejects.toThrow(businessError);

      expect(operation).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it("agota los reintentos y relanza el error si todos los intentos fallan", async () => {
      const sleepDelays: number[] = [];
      const sleepMock = jest.fn().mockImplementation(async (ms: number) => {
        sleepDelays.push(ms);
      });

      const handler = new RetryHandler({
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        jitterMs: 0,
        sleep: sleepMock,
      });

      const rateLimitError = new KitPagosError(
        KitPagosErrorCode.RATE_LIMIT_EXCEEDED,
        Gateway.KUSHKI,
        null,
        "HTTP 429 Too Many Requests",
      );

      const operation = jest.fn().mockRejectedValue(rateLimitError);

      await expect(handler.execute(operation)).rejects.toThrow(rateLimitError);

      // Intento inicial (0) + 3 reintentos (1, 2, 3) = 4 ejecuciones totales
      expect(operation).toHaveBeenCalledTimes(4);
      expect(sleepMock).toHaveBeenCalledTimes(3);
      expect(sleepDelays).toEqual([1000, 2000, 4000]);
    });

    it("si maxRetries es 0, no ejecuta ningún reintento y falla de inmediato tras el primer error", async () => {
      const sleepMock = jest.fn().mockResolvedValue(undefined);
      const handler = new RetryHandler({
        maxRetries: 0,
        sleep: sleepMock,
      });

      const connError = new KitPagosError(
        KitPagosErrorCode.CONNECTION_FAILED,
        Gateway.WOMPI,
        null,
        "Connection refused",
      );

      const operation = jest.fn().mockRejectedValue(connError);

      await expect(handler.execute(operation)).rejects.toThrow(connError);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it("utiliza setTimeout nativo si no se suministra función sleep", async () => {
      jest.useFakeTimers();
      const handler = new RetryHandler({
        maxRetries: 1,
        baseDelayMs: 500,
        jitterMs: 0,
      });

      const error = new KitPagosError(
        KitPagosErrorCode.CONNECTION_FAILED,
        Gateway.WOMPI,
        null,
        "Network drop",
      );

      let attempts = 0;
      const promise = handler.execute(async () => {
        attempts++;
        if (attempts === 1) throw error;
        return "RECOVERED";
      });

      // Avanzar temporizador simulado
      await Promise.resolve(); // Permite que el primer catch se ejecute
      jest.advanceTimersByTime(500);

      const result = await promise;
      expect(result).toBe("RECOVERED");
      expect(attempts).toBe(2);

      jest.useRealTimers();
    });
  });
});
