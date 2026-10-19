import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkIntegrity, importedUrls, readImportMap, sha384 } from "../scripts/check-sri.mjs";
import { KIT_PAGOS_BROWSER_URL } from "../src/tokenizer";

const INDEX_HTML = readFileSync(join(__dirname, "..", "index.html"), "utf8");

describe("the import map of index.html", () => {
  it("pins with sha384 the exact module the tokenizer imports, and nothing else", () => {
    const { integrity } = readImportMap(INDEX_HTML);

    expect(Object.keys(integrity ?? {})).toEqual([KIT_PAGOS_BROWSER_URL]);
    expect(integrity?.[KIT_PAGOS_BROWSER_URL]).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
  });

  it("comes before any module script, which is the only place where the browser applies it", () => {
    const importMap = INDEX_HTML.indexOf('<script type="importmap">');

    expect(importMap).toBeGreaterThan(-1);
    expect(importMap).toBeLessThan(INDEX_HTML.indexOf('<script type="module"'));
  });

  it("fails clearly when the page has no import map", () => {
    expect(() => readImportMap("<!doctype html><title>sin mapa</title>")).toThrow('no tiene <script type="importmap">');
  });
});

describe("checkIntegrity (npm run check:sri)", () => {
  const MODULE_URL = "https://cdn.example/npm/paquete@1.0.0/dist/index.js";
  const MODULE = "export const valor = 1;\n";
  const pageWith = (integrity: Record<string, string>) =>
    `<script type="importmap">${JSON.stringify({ integrity })}</script><script type="module" src="./a.js"></script>`;
  const serving = (files: Record<string, string>) => async (url: string) =>
    url in files ? new Response(files[url]) : new Response("", { status: 404 });

  it("computes the same sha384 that a browser expects, in base64", () => {
    expect(sha384("abc")).toBe("sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn");
  });

  it("passes when every hash is the one of the file the CDN serves", async () => {
    const result = await checkIntegrity(pageWith({ [MODULE_URL]: sha384(MODULE) }), serving({ [MODULE_URL]: MODULE }));

    expect(result).toEqual({ verified: [`${MODULE_URL} ${sha384(MODULE)}`], problems: [] });
  });

  it("fails, with both hashes, when the CDN serves a different file", async () => {
    const result = await checkIntegrity(
      pageWith({ [MODULE_URL]: sha384(MODULE) }),
      serving({ [MODULE_URL]: MODULE.replace("1", "2") }),
    );

    expect(result.verified).toEqual([]);
    expect(result.problems).toEqual([
      `${MODULE_URL}: index.html espera ${sha384(MODULE)} y la CDN sirve ${sha384(MODULE.replace("1", "2"))}.`,
    ]);
  });

  it("fails when the CDN does not serve the file", async () => {
    const result = await checkIntegrity(pageWith({ [MODULE_URL]: sha384(MODULE) }), serving({}));

    expect(result.problems).toEqual([`${MODULE_URL}: la CDN respondió 404.`]);
  });

  it("fails when a pinned module imports another module without a hash", async () => {
    const importing = 'import { otro } from "./otro.js";\nexport const valor = await import("../extra.js");\n';
    const result = await checkIntegrity(pageWith({ [MODULE_URL]: sha384(importing) }), serving({ [MODULE_URL]: importing }));

    expect(result.problems).toEqual([
      `${MODULE_URL} importa https://cdn.example/npm/paquete@1.0.0/dist/otro.js, que no tiene hash en el import map.`,
      `${MODULE_URL} importa https://cdn.example/npm/paquete@1.0.0/extra.js, que no tiene hash en el import map.`,
    ]);
  });

  it("fails when the import map pins nothing", async () => {
    const result = await checkIntegrity('<script type="importmap">{"imports": {}}</script>', serving({}));

    expect(result.problems).toEqual(["El import map no tiene ninguna entrada en «integrity»."]);
  });

  it("resolves what a module imports against the module's own URL", () => {
    expect(importedUrls('export * from "./a.js"; import "https://otro.example/b.js";', MODULE_URL)).toEqual([
      "https://cdn.example/npm/paquete@1.0.0/dist/a.js",
      "https://otro.example/b.js",
    ]);
  });
});
