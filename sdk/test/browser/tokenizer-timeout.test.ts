import { getEventListeners } from "events";
import { WompiTokenizer } from "../../src-browser/tokenizers/WompiTokenizer";
import { MercadoPagoTokenizer } from "../../src-browser/tokenizers/MercadoPagoTokenizer";
import { KitPagosBrowser } from "../../src-browser/KitPagosBrowser";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import type { TokenizeCardParams } from "../../src-browser/types";

const card = {
  number: "4242424242424242",
  cvc: "123",
  expMonth: "12",
  expYear: "30",
  cardHolder: "Prueba Kit",
  docType: "CC",
  docNumber: "1099888777",
};

/** Una pasarela que acepta la conexión y no responde hasta que la señal aborta. */
function silentGateway(): jest.Mock {
  return jest.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
}

function okReply(body: unknown) {
  return jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }));
}

const tokenizers = [
  {
    name: "Wompi",
    gateway: Gateway.WOMPI,
    tokenize: (params: Partial<TokenizeCardParams>, fetchFn: unknown) =>
      WompiTokenizer.tokenize(
        { gateway: Gateway.WOMPI, publicKey: "pub_test_123", card, environment: "sandbox", ...params },
        fetchFn as typeof fetch,
      ),
    success: { data: { id: "tok_test_1" } },
  },
  {
    name: "Mercado Pago",
    gateway: Gateway.MERCADOPAGO,
    tokenize: (params: Partial<TokenizeCardParams>, fetchFn: unknown) =>
      MercadoPagoTokenizer.tokenize(
        { gateway: Gateway.MERCADOPAGO, publicKey: "TEST-pub-123", card, environment: "sandbox", ...params },
        fetchFn as typeof fetch,
      ),
    success: { id: "mp_tok_1" },
  },
];

describe.each(tokenizers)("$name tokenizer timeout", ({ gateway, tokenize, success }) => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should fail with GATEWAY_TIMEOUT when the gateway does not answer in time", async () => {
    const fetchFn = silentGateway();

    await expect(tokenize({ timeoutMs: 20 }, fetchFn)).rejects.toMatchObject({
      code: KitPagosErrorCode.GATEWAY_TIMEOUT,
      gateway,
      message: expect.stringContaining("20 ms"),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("should fail with GATEWAY_TIMEOUT within the limit when fetch ignores the signal", async () => {
    const fetchFn = jest.fn(() => new Promise<never>(() => undefined));

    const started = Date.now();
    await expect(tokenize({ timeoutMs: 50 }, fetchFn)).rejects.toMatchObject({
      code: KitPagosErrorCode.GATEWAY_TIMEOUT,
      gateway,
      message: expect.stringContaining("50 ms"),
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("should fail with GATEWAY_TIMEOUT within the limit when the body never arrives", async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: () => new Promise<never>(() => undefined),
    }));

    const started = Date.now();
    await expect(tokenize({ timeoutMs: 50 }, fetchFn)).rejects.toMatchObject({
      code: KitPagosErrorCode.GATEWAY_TIMEOUT,
      gateway,
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("should leave no abort listener or timer behind when the gateway answers in time", async () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    const fetchFn = okReply(success);

    await tokenize({ timeoutMs: 4321 }, fetchFn);

    const init = (fetchFn.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(getEventListeners(init.signal as AbortSignal, "abort")).toHaveLength(0);
    const requestTimer = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 4321);
    expect(requestTimer).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[requestTimer].value);
  });

  it("should apply 30000 ms when timeoutMs is not given", async () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");

    await tokenize({}, okReply(success));

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it("should pass the timeout signal to fetch", async () => {
    const fetchFn = okReply(success);

    await tokenize({ timeoutMs: 5000 }, fetchFn);

    const init = (fetchFn.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("should fail with GATEWAY_TIMEOUT when the body is cut by the timeout", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw timeout;
      },
    }));

    await expect(tokenize({ timeoutMs: 5000 }, fetchFn)).rejects.toMatchObject({
      code: KitPagosErrorCode.GATEWAY_TIMEOUT,
      originalPayload: timeout,
    });
  });

  it.each([0, -1, 1.5, 2_147_483_648, Number.NaN])(
    "should reject timeoutMs %p before sending the card",
    async (timeoutMs) => {
      const fetchFn = okReply(success);

      await expect(tokenize({ timeoutMs }, fetchFn)).rejects.toMatchObject({
        code: KitPagosErrorCode.INVALID_REQUEST,
        gateway,
      });
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it("should keep CONNECTION_FAILED for a network error", async () => {
    const fetchFn = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(tokenize({}, fetchFn)).rejects.toMatchObject({
      code: KitPagosErrorCode.CONNECTION_FAILED,
    });
  });
});

describe("KitPagosBrowser.tokenizeCard() timeoutMs", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should forward timeoutMs to the tokenizer", async () => {
    globalThis.fetch = silentGateway() as unknown as typeof fetch;

    await expect(
      KitPagosBrowser.tokenizeCard({
        gateway: Gateway.WOMPI,
        publicKey: "pub_test_123",
        card,
        environment: "sandbox",
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: KitPagosErrorCode.GATEWAY_TIMEOUT });
  });
});
