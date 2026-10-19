/**
 * Compila los ejemplos del `README.md` contra el SDK construido.
 *
 * ## Por qué existe
 *
 * El README es lo primero —y para la mayoría, lo único— que lee quien instala el paquete
 * desde npm. El 19 de septiembre de 2026, el commit que configuró la publicación traía un
 * README con **diez afirmaciones que no compilaban**: `result.type` en vez de `result.outcome`,
 * `result.redirectUrl` en vez de `result.redirect.redirectUrl`, `orderReference` como cadena,
 * `payerEmail` en vez de `payer`, `PaymentMethod.card({ token })` con la firma equivocada, y
 * campos de PSE que no existen. Todo eso estaba a un `git tag` de publicarse, con el `CI` en
 * verde: ni el `CI` ni el workflow de publicación compilaban el README, y los ejemplos no
 * están en el `CI` porque necesitan el simulador levantado.
 *
 * La lección ya estaba escrita en los puntos 51 y 52 del `architecture-log.md`: lo que nadie
 * corre automáticamente no cuenta como verificado. Esto la aplica a la documentación.
 *
 * ## Qué hace, y qué no
 *
 * Extrae los bloques ```typescript del README, los concatena en un archivo temporal y lo
 * compila con `tsc --noEmit` contra `dist/`, o sea contra los tipos que de verdad se publican
 * y no contra el código fuente. Verifica que **compile**, no que funcione: un ejemplo puede
 * tipar bien y estar mal (los puntos 51 y 52 son justamente eso). Pero los diez errores que
 * motivaron el script eran todos de tipos.
 *
 * Los bloques comparten un solo archivo, así que se declaran una vez `sdk` y los imports; los
 * bloques del README que los repiten se deduplican aquí. Un bloque que no deba compilarse
 * —salida de consola, JSON— se marca en el README como ```json o ```bash y este script lo
 * ignora.
 *
 *     cd sdk && npm run check:readme
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const sdkRoot = path.resolve(__dirname, "..");
const readmePath = path.join(sdkRoot, "README.md");

/** Devuelve el contenido de cada bloque ```typescript (o ```ts) del README. */
function typeScriptBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```(?:typescript|ts)\r?\n([\s\S]*?)```/g;
  let regexMatch: RegExpExecArray | null;

  while ((regexMatch = pattern.exec(markdown)) !== null) {
    blocks.push(regexMatch[1]);
  }

  return blocks;
}

/**
 * Junta los bloques en un módulo compilable.
 *
 * El README repite los `import` en cada sección a propósito —quien copia un snippet suelto
 * necesita ver qué importar—, así que aquí se recogen los **símbolos** y se emite un solo
 * import. Deduplicar por línea de texto no sirve: el mismo símbolo aparece en un import de
 * una línea en una sección y en uno multilínea en otra, y las dos líneas son distintas aunque
 * traigan lo mismo.
 *
 * Las declaraciones repetidas de `const sdk` se dejan solo la primera vez, por el mismo
 * motivo por el que están repetidas en el README.
 */
function buildModule(blocks: string[]): string {
  const exportedSymbols = new Set<string>();
  const browserSymbols = new Set<string>();
  const blockBodies: string[] = [];
  let sdkAlreadyDeclared = false;

  for (const block of blocks) {
    const withoutImports = block
      .replace(
        /import\s*\{([^}]+)\}\s*from\s*["']kit-pagos-colombia\/browser["'];?\r?\n?/g,
        (_fullMatch, items: string) => {
          for (const symbolName of items.split(",")) {
            const cleaned = symbolName.trim();
            if (cleaned) browserSymbols.add(cleaned);
          }
          return "";
        },
      )
      .replace(
        /import\s*\{([^}]+)\}\s*from\s*["']kit-pagos-colombia["'];?\r?\n?/g,
        (_fullMatch, items: string) => {
          for (const symbolName of items.split(",")) {
            const cleaned = symbolName.trim();
            if (cleaned) exportedSymbols.add(cleaned);
          }
          return "";
        },
      );

    const lines: string[] = [];
    for (const lineText of withoutImports.split("\n")) {
      if (lineText.startsWith("const sdk = new KitPagos(")) {
        if (sdkAlreadyDeclared) break;
        sdkAlreadyDeclared = true;
      }
      lines.push(lineText);
    }

    blockBodies.push(lines.join("\n"));
  }

  // Si un símbolo se importó tanto del root como de /browser (ej. Gateway reexportado),
  // se aliasa en el browser para no colisionar en el archivo único generado,
  // validando que el módulo /browser efectivamente lo exporta.
  const formattedBrowserSymbols = [...browserSymbols].map((s) =>
    exportedSymbols.has(s) ? `${s} as _browser_${s}` : s,
  );

  const importsRoot = exportedSymbols.size > 0 ? `import { ${[...exportedSymbols].join(", ")} } from "kit-pagos-colombia";` : "";
  const importsBrowser =
    formattedBrowserSymbols.length > 0
      ? `import { ${formattedBrowserSymbols.join(", ")} } from "kit-pagos-colombia/browser";`
      : "";

  return [
    "/* Generado por scripts/check-readme.ts. No editar. */",
    "/* eslint-disable */",
    // El README usa Express en el ejemplo de webhooks sin declararlo, porque el lector ya
    // tiene su servidor. Aquí se declara para que el bloque compile aislado.
    "declare const app: { post(ruta: string, manejador: (req: any, res: any) => void): void };",
    importsRoot,
    importsBrowser,
    ...blockBodies,
  ].filter(Boolean).join("\n\n");
}

function main(): void {
  const markdown = fs.readFileSync(readmePath, "utf8");
  const blocks = typeScriptBlocks(markdown);

  if (blocks.length === 0) {
    console.error("No se encontró ningún bloque ```typescript en el README.");
    process.exit(1);
  }

  const dist = path.join(sdkRoot, "dist", "index.d.ts");
  if (!fs.existsSync(dist)) {
    console.error("Falta dist/. Corra `npm run build` antes de verificar el README.");
    process.exit(1);
  }

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "kit-pagos-readme-"));
  const filePath = path.join(folder, "readme-snippets.ts");
  fs.writeFileSync(filePath, buildModule(blocks));

  /*
   * `paths` solo se puede declarar en un tsconfig, no como bandera, así que se escribe uno
   * al lado del archivo generado. Apunta `kit-pagos-colombia` a `dist/`: el README tiene que
   * compilar contra los tipos que se publican, no contra `src/`, porque es lo único que ve
   * quien instala el paquete.
   */
  const configPath = path.join(folder, "tsconfig.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        /*
         * Las opciones espejan `sdk/tsconfig.json` a propósito, incluido no declarar
         * `moduleResolution` ni `baseUrl`: TypeScript 6 los marca como obsoletos cuando se
         * declaran explícitamente, y `paths` con rutas absolutas no necesita `baseUrl`.
         */
        compilerOptions: {
          noEmit: true,
          strict: true,
          target: "ES2020",
          module: "commonjs",
          lib: ["ES2020", "DOM"],
          esModuleInterop: true,
          skipLibCheck: true,
          types: ["node"],
          typeRoots: [path.join(sdkRoot, "node_modules", "@types")],
          paths: {
            "kit-pagos-colombia": [path.join(sdkRoot, "dist", "index.d.ts")],
            "kit-pagos-colombia/browser": [path.join(sdkRoot, "dist", "browser", "index.d.ts")],
          },
        },
        files: [filePath],
      },
      null,
      2,
    ),
  );

  try {
    const tscBin = path.join(sdkRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    execFileSync(
      tscBin,
      ["-p", configPath],
      { stdio: "inherit", shell: process.platform === "win32" },
    );
    console.log(`Los ${blocks.length} ejemplos de TypeScript del README compilan.`);
  } catch {
    console.error(
      "\nEl README no compila contra el SDK publicado. Los tipos de arriba son los que " +
        "vería quien copie el ejemplo desde npm.",
    );
    process.exit(1);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

main();
