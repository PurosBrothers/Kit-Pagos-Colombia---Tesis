/**
 * Verifica que todos los fragmentos TypeScript mostrados en la landing page
 * compilen contra las definiciones de tipos del SDK en `sdk/dist/`.
 *
 * Análogo a `npm run check:readme` en sdk/, esto previene que se publiquen
 * ejemplos rotos o desactualizados.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SNIPPET_UNIFIED_PAYMENT,
  SNIPPET_UNIFIED_FULL,
  SNIPPET_BROWSER_TOKENIZE,
  SNIPPET_WEBHOOK_VERIFY,
  SNIPPET_PSE_PAYMENT,
} from "../src/snippets";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const landingRoot = path.resolve(__dirname, "..");
const sdkRoot = path.resolve(landingRoot, "..", "sdk");

function armarModulo(bloques: string[]): string {
  const simbolos = new Set<string>();
  const simbolosBrowser = new Set<string>();
  const funciones: string[] = [];

  bloques.forEach((bloque, index) => {
    const sinImports = bloque
      .replace(
        /import\s*\{([^}]+)\}\s*from\s*["']kit-pagos-colombia\/browser["'];?\r?\n?/g,
        (_todo, lista: string) => {
          for (const simbolo of lista.split(",")) {
            const limpio = simbolo.trim();
            if (limpio) simbolosBrowser.add(limpio);
          }
          return "";
        },
      )
      .replace(
        /import\s*\{([^}]+)\}\s*from\s*["']kit-pagos-colombia["'];?\r?\n?/g,
        (_todo, lista: string) => {
          for (const simbolo of lista.split(",")) {
            const limpio = simbolo.trim();
            if (limpio) simbolos.add(limpio);
          }
          return "";
        },
      );

    funciones.push(`async function __landingSnippet_${index}() {\n${sinImports.trim()}\n}`);
  });

  const simbolosBrowserFormateados = [...simbolosBrowser].map((s) =>
    simbolos.has(s) ? `${s} as _browser_${s}` : s,
  );

  const importsRoot =
    simbolos.size > 0
      ? `import { ${[...simbolos].join(", ")} } from "kit-pagos-colombia";`
      : "";
  const importsBrowser =
    simbolosBrowserFormateados.length > 0
      ? `import { ${simbolosBrowserFormateados.join(", ")} } from "kit-pagos-colombia/browser";`
      : "";

  return [
    "/* Generado por landing/scripts/check-snippets.ts. No editar. */",
    "/* eslint-disable */",
    importsRoot,
    importsBrowser,
    ...funciones,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function main(): void {
  const snippets = [
    SNIPPET_UNIFIED_PAYMENT,
    SNIPPET_UNIFIED_FULL,
    SNIPPET_BROWSER_TOKENIZE,
    SNIPPET_WEBHOOK_VERIFY,
    SNIPPET_PSE_PAYMENT,
  ];

  const distNode = path.join(sdkRoot, "dist", "index.d.ts");
  const distBrowser = path.join(sdkRoot, "dist", "browser", "index.d.ts");

  if (!fs.existsSync(distNode) || !fs.existsSync(distBrowser)) {
    console.error(
      "Faltan tipos en sdk/dist/. Corré `npm run build` en sdk/ antes de verificar los snippets.",
    );
    process.exit(1);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-pagos-landing-"));
  const tempFile = path.join(tempDir, "landing-snippets.ts");
  fs.writeFileSync(tempFile, armarModulo(snippets));

  const configPath = path.join(tempDir, "tsconfig.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        compilerOptions: {
          noEmit: true,
          strict: true,
          target: "ES2022",
          module: "ESNext",
          lib: ["ES2022", "DOM"],
          skipLibCheck: true,
          paths: {
            "kit-pagos-colombia": [distNode],
            "kit-pagos-colombia/browser": [distBrowser],
          },
        },
        files: [tempFile],
      },
      null,
      2,
    ),
  );

  try {
    const tscBin = path.join(
      landingRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tsc.cmd" : "tsc",
    );
    execFileSync(tscBin, ["-p", configPath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    console.log(
      `Los ${snippets.length} fragmentos de código de la landing page compilan correctamente contra sdk/dist.`,
    );
  } catch (error) {
    console.error(
      "\nLos fragmentos de la landing page no compilan contra el SDK publicado. Corrige las firmas o importaciones.",
    );
    process.exit(1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
