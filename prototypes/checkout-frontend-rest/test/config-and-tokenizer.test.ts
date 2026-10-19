import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_URL,
  DEFAULT_CONFIG,
  cardTokenizationProblem,
  cardUnavailableFor,
  loadConfig,
  missingPublicKeysProblem,
} from "../src/config";
import { KIT_PAGOS_BROWSER_URL, loadCardTokenizer, type CardTokenizer } from "../src/tokenizer";

describe("loadConfig", () => {
  it("falls back to the sandboxes through the deployed API when the deployment serves no config", async () => {
    await expect(loadConfig(async () => new Response("", { status: 404 }))).resolves.toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toEqual({ apiBaseUrl: DEFAULT_API_URL, environment: "sandbox", publicKeys: {} });
  });

  it("keeps what the deployment provides and fills the rest", async () => {
    const served = { apiBaseUrl: "https://api.example.com/v1/api", publicKeys: { someGateway: "pub" } };

    await expect(loadConfig(async () => new Response(JSON.stringify(served)))).resolves.toEqual({
      apiBaseUrl: "https://api.example.com/v1/api",
      environment: "sandbox",
      publicKeys: { someGateway: "pub" },
    });
  });

  it("takes simulator when the deployment asks for it, and anything else is sandbox", async () => {
    const load = (environment: unknown) => loadConfig(async () => new Response(JSON.stringify({ environment })));

    await expect(load("simulator")).resolves.toMatchObject({ environment: "simulator" });
    await expect(load("production")).resolves.toMatchObject({ environment: "sandbox" });
    await expect(load(undefined)).resolves.toMatchObject({ environment: "sandbox" });
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
    expect(remote).toContain("«npm start»");
    expect(otherPort).toContain("http://localhost:3001");
  });

  it("does not stop the card in sandbox, which tokenizes at the gateway wherever the API is", () => {
    expect(cardTokenizationProblem({ environment: "sandbox", apiBaseUrl: DEFAULT_API_URL })).toBeUndefined();
  });
});

describe("cardUnavailableFor", () => {
  const config = { publicKeys: { alfa: "pub_alfa" } };

  it("offers the card for a gateway that tokenizes in the browser when the deployment provides its key", () => {
    expect(cardUnavailableFor(config, "BROWSER_TOKEN", "alfa")).toBeUndefined();
  });

  it("offers the card on the gateway's own page without any key", () => {
    expect(cardUnavailableFor(config, "HOSTED_PAGE", "beta")).toBeUndefined();
  });

  it("says the store started without the key of a gateway that tokenizes in the browser, without naming it", () => {
    const reason = cardUnavailableFor(config, "BROWSER_TOKEN", "beta");

    expect(reason).toContain("arrancó sin ella");
    expect(reason).toContain("Paga con PSE");
    expect(reason).not.toContain("beta");
  });

  it("says the API does not tell how the gateway takes the card, as an API older than cardCapture does", () => {
    const reason = cardUnavailableFor(config, undefined, "alfa");

    expect(reason).toContain("no ofrecemos tarjeta");
    expect(reason).toContain("la API no dice cómo la recibe");
    expect(reason).not.toContain("alfa");
  });
});

describe("missingPublicKeysProblem", () => {
  it("says nothing when the page received at least one public key", () => {
    expect(missingPublicKeysProblem({ publicKeys: { alfa: "pub_alfa" } })).toBeUndefined();
  });

  it("points the tester to --dotenv when the page received no public key at all", () => {
    const problem = missingPublicKeysProblem({ publicKeys: {} });

    expect(problem).toContain("ninguna llave pública");
    expect(problem).toContain("--dotenv=");
  });
});

describe("loadCardTokenizer", () => {
  it("imports KitPagosBrowser from jsDelivr with a pinned version", async () => {
    const KitPagosBrowser: CardTokenizer = { tokenizeCard: async () => ({ token: "t" }) };
    const importer = vi.fn(async () => ({ KitPagosBrowser }));

    await expect(loadCardTokenizer(importer)).resolves.toBe(KitPagosBrowser);
    expect(importer).toHaveBeenCalledWith(KIT_PAGOS_BROWSER_URL);
    expect(KIT_PAGOS_BROWSER_URL).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/kit-pagos-colombia@\d+\.\d+\.\d+(-rc\.\d+)?\//);
  });

  it.each(["@next", "@latest", "@^0.6.0", "@0.6", "@0.6.x"])("would not accept %s, which is not one fixed version", (spec) => {
    const pinned = /^https:\/\/cdn\.jsdelivr\.net\/npm\/kit-pagos-colombia@\d+\.\d+\.\d+(-rc\.\d+)?\//;

    expect(`https://cdn.jsdelivr.net/npm/kit-pagos-colombia${spec}/dist/browser/index.js`).not.toMatch(pinned);
  });
});
