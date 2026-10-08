import { getEventListeners } from "events";
import http from "http";
import { AddressInfo, Socket } from "net";
import { KitPagos } from "./KitPagos";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../config/request-timeout";

/**
 * Límite por petición contra un servidor HTTP real que acepta la conexión y nunca responde
 * (issue #122, hueco 5). No se sustituye `fetch`: lo que se prueba es que el `fetch` de Node
 * corta la espera y que el SDK traduce ese corte a `GATEWAY_TIMEOUT`.
 */
describe("KitPagos request timeout against a server that never responds", () => {
  const TIMEOUT_MS = 200;
  const credentials = { publicKey: "pub_test_timeout", privateKey: "prv_test_timeout" };

  let server: http.Server;
  let baseUrl: string;
  let requestsReceived = 0;
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    server = http.createServer(() => {
      requestsReceived++;
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    requestsReceived = 0;
  });

  it.each([Gateway.WOMPI, Gateway.MERCADOPAGO, Gateway.RAPYD, Gateway.KUSHKI])(
    "%s: getPaymentStatus() fails with GATEWAY_TIMEOUT within the configured limit",
    async (gateway) => {
      const sdk = new KitPagos({
        gateway,
        credentials: { [gateway]: credentials },
        baseUrl,
        timeoutMs: TIMEOUT_MS,
        maxRetries: 0,
      });

      const started = Date.now();
      const error = await sdk.getPaymentStatus("tx-timeout-1").catch((e: unknown) => e);
      const elapsed = Date.now() - started;

      expect(error).toBeInstanceOf(KitPagosError);
      expect((error as KitPagosError).code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
      expect((error as KitPagosError).gateway).toBe(gateway);
      // Los temporizadores de Node pueden disparar hasta 1 ms antes por redondeo.
      expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 5);
      expect(elapsed).toBeLessThan(TIMEOUT_MS + 1000);
      expect(requestsReceived).toBe(1);
    },
  );

  it("retries the timed-out query and ends in MAX_RETRIES_EXCEEDED with GATEWAY_TIMEOUT as cause", async () => {
    const sdk = new KitPagos({
      gateway: Gateway.WOMPI,
      credentials: { [Gateway.WOMPI]: credentials },
      baseUrl,
      timeoutMs: TIMEOUT_MS,
      maxRetries: 1,
    });

    const error = await sdk.getPaymentStatus("tx-timeout-2").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KitPagosError);
    const exhausted = error as KitPagosError;
    expect(exhausted.code).toBe(KitPagosErrorCode.MAX_RETRIES_EXCEEDED);
    expect(exhausted.message).toContain("2 attempts");
    expect(exhausted.cause).toBeInstanceOf(KitPagosError);
    expect((exhausted.cause as KitPagosError).code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
    expect(requestsReceived).toBe(2);
  });

  describe("value passed to the request timer", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      jest.restoreAllMocks();
    });

    it.each([
      ["the default when timeoutMs is not configured", undefined, DEFAULT_REQUEST_TIMEOUT_MS],
      ["the configured timeoutMs", 1234, 1234],
    ])("uses %s", async (_label, timeoutMs, expected) => {
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "x", status: "succeeded" }),
      }) as unknown as typeof fetch;

      const sdk = new KitPagos({
        gateway: Gateway.MERCADOPAGO,
        credentials: { [Gateway.MERCADOPAGO]: credentials },
        baseUrl,
        timeoutMs,
      });
      await sdk.getPaymentStatus("tx-timeout-3").catch(() => undefined);

      expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(30_000);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expected);
    });
  });
});

/**
 * Límite por petición cuando `fetch` ignora la señal (defecto medido el 7 de octubre de 2026:
 * con un `fetch` así, el límite no se cumplía; ver `withRequestTimeout`). Un `fetch`
 * sustituido por el comercio, o un polyfill viejo, no tiene por qué mirar `signal`; el plazo
 * no puede depender de eso.
 */
describe("KitPagos request timeout when fetch ignores the signal", () => {
  const TIMEOUT_MS = 50;
  const credentials = { publicKey: "pub_test_timeout", privateKey: "prv_test_timeout" };
  const originalFetch = global.fetch;
  const never = () => new Promise<never>(() => undefined);

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function sdkFor(gateway: Gateway, timeoutMs = TIMEOUT_MS): KitPagos {
    return new KitPagos({
      gateway,
      credentials: { [gateway]: credentials },
      baseUrl: "http://127.0.0.1:1",
      timeoutMs,
      maxRetries: 0,
    });
  }

  async function expectTimeoutWithinLimit(gateway: Gateway): Promise<void> {
    const started = Date.now();
    const error = await sdkFor(gateway).getPaymentStatus("tx-ignored-signal").catch((e: unknown) => e);
    const elapsed = Date.now() - started;

    expect(error).toBeInstanceOf(KitPagosError);
    expect((error as KitPagosError).code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
    expect((error as KitPagosError).gateway).toBe(gateway);
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 5);
    expect(elapsed).toBeLessThan(TIMEOUT_MS + 1000);
  }

  it.each([Gateway.WOMPI, Gateway.MERCADOPAGO, Gateway.RAPYD, Gateway.KUSHKI])(
    "%s: a fetch that never settles ends in GATEWAY_TIMEOUT within the limit",
    async (gateway) => {
      global.fetch = jest.fn(never) as unknown as typeof fetch;

      await expectTimeoutWithinLimit(gateway);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([Gateway.WOMPI, Gateway.MERCADOPAGO, Gateway.RAPYD, Gateway.KUSHKI])(
    "%s: a success body that never arrives ends in GATEWAY_TIMEOUT within the limit",
    async (gateway) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: never,
        text: never,
      }) as unknown as typeof fetch;

      await expectTimeoutWithinLimit(gateway);
    },
  );

  it.each([Gateway.WOMPI, Gateway.MERCADOPAGO, Gateway.RAPYD, Gateway.KUSHKI])(
    "%s: an error body that never arrives ends in GATEWAY_TIMEOUT within the limit",
    async (gateway) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: never,
        text: never,
      }) as unknown as typeof fetch;

      await expectTimeoutWithinLimit(gateway);
    },
  );

  it("leaves no abort listener or timer behind when the gateway answers in time", async () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    let signal: AbortSignal | undefined;
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 1234567890,
          status: "approved",
          transaction_amount: 50000,
          currency_id: "COP",
          external_reference: "ORDER-MP-123",
        }),
      };
    }) as unknown as typeof fetch;

    const transaction = await sdkFor(Gateway.MERCADOPAGO, 4321).getPaymentStatus("tx-in-time");

    expect(transaction.getStatus()).toBe("APPROVED");
    expect(signal?.aborted).toBe(false);
    expect(getEventListeners(signal as AbortSignal, "abort")).toHaveLength(0);
    const requestTimer = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 4321);
    expect(requestTimer).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[requestTimer].value);
  });
});
