import { getEventListeners } from "events";
import { withRequestTimeout } from "./request-timeout";

/** Una operación que nunca termina y no mira la señal: el `fetch` que no la respeta. */
const neverSettles = () => new Promise<never>(() => undefined);

describe("withRequestTimeout", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects with a TimeoutError within the limit when the operation ignores the signal", async () => {
    const started = Date.now();
    const error = await withRequestTimeout(50, neverSettles).catch((e: unknown) => e);
    const elapsed = Date.now() - started;

    expect((error as { name?: unknown }).name).toBe("TimeoutError");
    expect((error as Error).message).toContain("50 ms");
    // Los temporizadores de Node pueden disparar hasta 1 ms antes por redondeo.
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(1000);
  });

  it("aborts the signal handed to the operation when the limit expires", async () => {
    let received: AbortSignal | undefined;

    await withRequestTimeout(20, (signal) => {
      received = signal;
      return neverSettles();
    }).catch(() => undefined);

    expect(received?.aborted).toBe(true);
    expect((received?.reason as { name?: unknown }).name).toBe("TimeoutError");
  });

  it("rejects with what onTimeout returns", async () => {
    const translated = new Error("translated");
    const onTimeout = jest.fn(() => translated);

    await expect(withRequestTimeout(20, neverSettles, onTimeout)).rejects.toBe(translated);
    expect((onTimeout.mock.calls[0] as unknown[])[0]).toMatchObject({ name: "TimeoutError" });
  });

  it("rejects with the error onTimeout throws instead of leaving the request pending", async () => {
    const broken = new TypeError("translator failed");

    await expect(
      withRequestTimeout(20, neverSettles, () => {
        throw broken;
      }),
    ).rejects.toBe(broken);
  });

  it("resolves with the operation result and leaves no listener or timer behind", async () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    let received: AbortSignal | undefined;

    const result = await withRequestTimeout(5_000, async (signal) => {
      received = signal;
      return "ok";
    });

    expect(result).toBe("ok");
    expect(received?.aborted).toBe(false);
    expect(getEventListeners(received as AbortSignal, "abort")).toHaveLength(0);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
    const timer = setTimeoutSpy.mock.results[0].value;
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
  });

  it("propagates the operation error and cleans up as well", async () => {
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    const failure = new Error("network down");
    let received: AbortSignal | undefined;

    await expect(
      withRequestTimeout(5_000, async (signal) => {
        received = signal;
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(getEventListeners(received as AbortSignal, "abort")).toHaveLength(0);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it("does not keep the Node process alive while the request is pending", async () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");

    const pending = withRequestTimeout(5_000, neverSettles).catch(() => undefined);
    const timer = setTimeoutSpy.mock.results[0].value as NodeJS.Timeout;

    expect(timer.hasRef()).toBe(false);
    clearTimeout(timer);
    void pending;
  });
});
