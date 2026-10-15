import { describe, expect, it, vi } from "vitest";
import { DEFAULT_API_URL, DEFAULT_CONFIG, cardTokenizationProblem, loadConfig } from "../src/config";
import { KIT_PAGOS_BROWSER_URL, loadCardTokenizer, type CardTokenizer } from "../src/tokenizer";

describe("loadConfig", () => {
  it("falls back to the deployed simulator when the deployment serves no config", async () => {
    await expect(loadConfig(async () => new Response("", { status: 404 }))).resolves.toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toEqual({ apiBaseUrl: DEFAULT_API_URL, environment: "simulator", publicKeys: {} });
  });

  it("keeps what the deployment provides and fills the rest", async () => {
    const served = { apiBaseUrl: "https://api.example.com/v1/api", publicKeys: { someGateway: "pub" } };

    await expect(loadConfig(async () => new Response(JSON.stringify(served)))).resolves.toEqual({
      apiBaseUrl: "https://api.example.com/v1/api",
      environment: "simulator",
      publicKeys: { someGateway: "pub" },
    });
  });

  it("takes sandbox when the deployment asks for it, and anything else is simulator", async () => {
    const load = (environment: unknown) => loadConfig(async () => new Response(JSON.stringify({ environment })));

    await expect(load("sandbox")).resolves.toMatchObject({ environment: "sandbox" });
    await expect(load("production")).resolves.toMatchObject({ environment: "simulator" });
    await expect(load(undefined)).resolves.toMatchObject({ environment: "simulator" });
  });
});

describe("cardTokenizationProblem", () => {
  it("lets the card through when the SDK's simulator destination is the API", () => {
    expect(cardTokenizationProblem({ environment: "simulator", apiBaseUrl: "http://localhost:3000/v1/api" })).toBeUndefined();
    expect(cardTokenizationProblem({ environment: "simulator", apiBaseUrl: "http://127.0.0.1:3000/v1/api" })).toBeUndefined();
  });

  it("stops the card when the environment is simulator and the API is anywhere else", () => {
    const remote = cardTokenizationProblem({ environment: "simulator", apiBaseUrl: DEFAULT_API_URL });
    const otherPort = cardTokenizationProblem({ environment: "simulator", apiBaseUrl: "http://localhost:3001/v1/api" });

    expect(remote).toContain("https://kit-pagos-colombia.onrender.com");
    expect(remote).toContain("localhost:3000");
    expect(remote).toContain("npm run start:sandbox");
    expect(otherPort).toContain("http://localhost:3001");
  });

  it("does not stop the card in sandbox, which tokenizes at the gateway wherever the API is", () => {
    expect(cardTokenizationProblem({ environment: "sandbox", apiBaseUrl: DEFAULT_API_URL })).toBeUndefined();
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
