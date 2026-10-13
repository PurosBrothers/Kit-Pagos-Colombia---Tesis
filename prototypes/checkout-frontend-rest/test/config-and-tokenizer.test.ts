import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config";
import { KIT_PAGOS_BROWSER_URL, loadCardTokenizer, type CardTokenizer } from "../src/tokenizer";

describe("loadConfig", () => {
  it("falls back to the local simulator when the deployment serves no config", async () => {
    await expect(loadConfig(async () => new Response("", { status: 404 }))).resolves.toEqual(DEFAULT_CONFIG);
  });

  it("keeps what the deployment provides and fills the rest", async () => {
    const served = { apiBaseUrl: "https://api.example.com/v1/api", publicKeys: { someGateway: "pub" } };

    await expect(loadConfig(async () => new Response(JSON.stringify(served)))).resolves.toEqual({
      apiBaseUrl: "https://api.example.com/v1/api",
      tokenizationEnvironment: "simulator",
      publicKeys: { someGateway: "pub" },
    });
  });
});

describe("loadCardTokenizer", () => {
  it("imports KitPagosBrowser from jsDelivr with a pinned version", async () => {
    const KitPagosBrowser: CardTokenizer = { tokenizeCard: async () => ({ token: "t" }) };
    const importer = vi.fn(async () => ({ KitPagosBrowser }));

    await expect(loadCardTokenizer(importer)).resolves.toBe(KitPagosBrowser);
    expect(importer).toHaveBeenCalledWith(KIT_PAGOS_BROWSER_URL);
    expect(KIT_PAGOS_BROWSER_URL).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/kit-pagos-colombia@\d+\.\d+\.\d+\//);
  });
});
