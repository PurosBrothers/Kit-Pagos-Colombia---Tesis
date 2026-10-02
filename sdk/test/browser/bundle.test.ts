import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

describe("Browser Bundle Verification", () => {
  const bundlePath = path.resolve(__dirname, "../../dist/browser/index.js");
  const dtsPath = path.resolve(__dirname, "../../dist/browser/index.d.ts");

  beforeAll(() => {
    const buildScript = path.resolve(__dirname, "../../scripts/build-browser.js");
    execFileSync(process.execPath, [buildScript], { stdio: "pipe" });
  });

  it("genera dist/browser/index.js y dist/browser/index.d.ts", () => {
    expect(fs.existsSync(bundlePath)).toBe(true);
    expect(fs.existsSync(dtsPath)).toBe(true);
  });

  it("el bundle de navegador no importa módulos nativos de Node.js", () => {
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

  it("exporta KitPagosBrowser y WompiTokenizer en formato ESM", () => {
    const bundleContent = fs.readFileSync(bundlePath, "utf-8");
    expect(bundleContent).toContain("KitPagosBrowser");
    expect(bundleContent).toContain("WompiTokenizer");
    expect(bundleContent).toMatch(/export\s*\{/);
  });
});
