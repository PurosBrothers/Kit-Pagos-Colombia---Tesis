import { execFileSync } from "child_process";
import { transformSync } from "esbuild";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";

/**
 * Carga el bundle ESM real como un módulo aparte, con su propia copia de las clases, igual que
 * le llega a un comercio que importa `kit-pagos-colombia` y `kit-pagos-colombia/browser`.
 * Jest corre en CommonJS, por eso se transforma el formato sin volver a empaquetar.
 */
function loadBundle(bundlePath: string): {
  KitPagosError: typeof KitPagosError;
  Gateway: typeof Gateway;
} {
  const { code } = transformSync(fs.readFileSync(bundlePath, "utf-8"), { format: "cjs", loader: "js" });
  const module = { exports: {} };
  vm.runInThisContext(`(function (module, exports) {${code}\n})`)(module, module.exports);
  return module.exports as { KitPagosError: typeof KitPagosError; Gateway: typeof Gateway };
}

describe("Browser Bundle Verification", () => {
  const bundlePath = path.resolve(__dirname, "../../dist/browser/index.js");
  const dtsPath = path.resolve(__dirname, "../../dist/browser/index.d.ts");

  beforeAll(() => {
    const buildScript = path.resolve(__dirname, "../../scripts/build-browser.js");
    execFileSync(process.execPath, [buildScript], { stdio: "pipe" });
  });

  it("generates dist/browser/index.js and dist/browser/index.d.ts", () => {
    expect(fs.existsSync(bundlePath)).toBe(true);
    expect(fs.existsSync(dtsPath)).toBe(true);
  });

  it("the browser bundle does not import native Node.js modules", () => {
    const bundleContent = fs.readFileSync(bundlePath, "utf-8");

    const forbiddenNodeModules = [
      "crypto",
      "node:crypto",
      "fs",
      "node:fs",
      "path",
      "node:path",
      "http",
      "node:http",
      "https",
      "node:https",
      "net",
      "node:net",
      "tls",
      "node:tls",
      "stream",
      "node:stream",
    ];

    for (const mod of forbiddenNodeModules) {
      // Verifica que no haya `from "mod"` o `require("mod")`
      const importRegex = new RegExp(`from\\s+['"]${mod}['"]`, "g");
      const requireRegex = new RegExp(`require\\(['"]${mod}['"]\\)`, "g");
      expect(importRegex.test(bundleContent)).toBe(false);
      expect(requireRegex.test(bundleContent)).toBe(false);
    }
  });

  it("exports KitPagosBrowser, WompiTokenizer and MercadoPagoTokenizer in ESM format", () => {
    const bundleContent = fs.readFileSync(bundlePath, "utf-8");
    expect(bundleContent).toContain("KitPagosBrowser");
    expect(bundleContent).toContain("WompiTokenizer");
    expect(bundleContent).toContain("MercadoPagoTokenizer");
    expect(bundleContent).toMatch(/export\s*\{/);
  });

  it("KitPagosError is instanceof across the bundle copy and the Node package copy, both ways", () => {
    const browser = loadBundle(bundlePath);
    expect(browser.KitPagosError).not.toBe(KitPagosError);

    const fromBrowser = new browser.KitPagosError(KitPagosErrorCode.CONNECTION_FAILED, browser.Gateway.WOMPI, null);
    const fromNode = new KitPagosError(KitPagosErrorCode.CONNECTION_FAILED, Gateway.WOMPI, null);

    expect(fromBrowser instanceof KitPagosError).toBe(true);
    expect(fromNode instanceof browser.KitPagosError).toBe(true);
  });

  it("Gateway is a string enum: its values match across both copies", () => {
    expect(loadBundle(bundlePath).Gateway.WOMPI).toBe(Gateway.WOMPI);
  });
});
