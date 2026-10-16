import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El criterio del issue #109 hecho prueba: el código que se entrega al navegador no nombra
 * ninguna pasarela. Si alguien agrega un `if (gateway === "wompi")`, esto falla.
 */
const ROOT = join(__dirname, "..");
const GATEWAY_NAME = /wompi|mercado\s*pago|kushki|rapyd/i;

function shippedFiles(): string[] {
  const sources = readdirSync(join(ROOT, "src"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join("src", name));
  return [...sources, "index.html", "server.mjs"];
}

describe("client code", () => {
  it.each(shippedFiles())("%s does not name any gateway", (file) => {
    const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
    const offending = lines.filter((line) => GATEWAY_NAME.test(line));

    expect(offending).toEqual([]);
  });
});
