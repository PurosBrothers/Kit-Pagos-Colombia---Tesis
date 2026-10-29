/**
 * native-concepts.ts
 *
 * Conteo de conceptos nativos expuestos — Issue #134 (Variable 4 del experimento).
 *
 * Cuenta identificadores propios de cada una de las cuatro pasarelas en el módulo de pagos
 * de los prototipos (`src/payments/`).
 *
 * En el prototipo B (tratamiento) el conteo debe ser estrictamente CERO. Si aparece un solo
 * identificador propio, la abstracción del SDK tiene una fuga (docs/project-management/prototypes-evaluation-plan.md §4).
 * En el prototipo D (control) el conteo refleja el acoplamiento a las APIs nativas de las pasarelas.
 *
 * Identificadores catalogados:
 * - Wompi: amount_in_cents, acceptance_token, x-event-checksum, integrity
 * - Mercado Pago: transaction_amount, total_amount, x-signature
 * - Kushki: x-kushki-signature, Private-Merchant-Id, Public-Merchant-Id, APPROVAL
 * - Rapyd: access_key, salt, CLO
 *
 * Uso:
 *   npx ts-node --project scripts/tsconfig.json scripts/native-concepts.ts [opciones]
 *   npm run metrics:concepts -- [opciones]
 *
 * Opciones:
 *   --target <dir>     Directorio o archivo a escanear (repetible)
 *   --json <file>      Escribe el reporte en formato JSON
 *   --assert-zero      Falla con código 1 si el conteo es mayor a cero (para CI en Prototipo B)
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export interface ConceptDefinition {
  identifier: string;
  gateway: 'wompi' | 'mercadopago' | 'kushki' | 'rapyd';
  description: string;
}

export interface GatewayConceptGroup {
  gateway: 'wompi' | 'mercadopago' | 'kushki' | 'rapyd';
  name: string;
  identifiers: ConceptDefinition[];
}

export const CATALOG: ConceptDefinition[] = [
  // Wompi
  {
    identifier: 'amount_in_cents',
    gateway: 'wompi',
    description: 'Monto en centavos en la API de transacciones de Wompi',
  },
  {
    identifier: 'acceptance_token',
    gateway: 'wompi',
    description: 'Token de aceptación de términos y condiciones de Wompi',
  },
  {
    identifier: 'x-event-checksum',
    gateway: 'wompi',
    description: 'Cabecera de verificación de webhook de Wompi',
  },
  {
    identifier: 'integrity',
    gateway: 'wompi',
    description: 'Firma de integridad y tipo de firma en Wompi',
  },

  // Mercado Pago
  {
    identifier: 'transaction_amount',
    gateway: 'mercadopago',
    description: 'Campo de monto en creación de pagos de Mercado Pago',
  },
  {
    identifier: 'total_amount',
    gateway: 'mercadopago',
    description: 'Campo de monto total en órdenes y checkout de Mercado Pago',
  },
  {
    identifier: 'x-signature',
    gateway: 'mercadopago',
    description: 'Cabecera de firma HMAC en webhooks de Mercado Pago',
  },

  // Kushki
  {
    identifier: 'x-kushki-signature',
    gateway: 'kushki',
    description: 'Cabecera de firma de webhooks de Kushki',
  },
  {
    identifier: 'Private-Merchant-Id',
    gateway: 'kushki',
    description: 'Cabecera de autenticación privada de Kushki',
  },
  {
    identifier: 'Public-Merchant-Id',
    gateway: 'kushki',
    description: 'Cabecera de autenticación pública para tokenización de Kushki',
  },
  {
    identifier: 'APPROVAL',
    gateway: 'kushki',
    description: 'Estado nativo de transacción aprobada en tarjetas Kushki',
  },

  // Rapyd
  {
    identifier: 'access_key',
    gateway: 'rapyd',
    description: 'Cabecera de autenticación pública/id en API de Rapyd',
  },
  {
    identifier: 'salt',
    gateway: 'rapyd',
    description: 'Cabecera de sal/nonce en cálculo de firma de Rapyd',
  },
  {
    identifier: 'CLO',
    gateway: 'rapyd',
    description: 'Estado nativo cerrado (closed checkout/payment) en Rapyd',
  },
];

export interface MatchOccurrence {
  file: string;
  line: number;
  column: number;
  identifier: string;
  gateway: string;
  lineContent: string;
}

export interface FileConceptSummary {
  file: string;
  totalOccurrences: number;
  distinctIdentifiersCount: number;
  distinctIdentifiers: string[];
  totalMatches: number;
  byGateway: Record<string, number>;
  byIdentifier: Record<string, number>;
  matches: MatchOccurrence[];
}

export interface DirectoryConceptReport {
  target: string;
  scannedFiles: number;
  totalOccurrences: number;
  distinctIdentifiersCount: number;
  distinctIdentifiers: string[];
  totalMatches: number;
  byGateway: Record<string, number>;
  byIdentifier: Record<string, number>;
  files: FileConceptSummary[];
}

function toRepoRelative(targetPath: string): string {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const abs = path.resolve(targetPath);
  const rel = path.relative(repoRoot, abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.replace(/\\/g, '/');
  }
  return abs.replace(/\\/g, '/');
}

/**
 * Reemplaza por espacios cada comentario del código, sin mover nada: los saltos de línea y
 * las posiciones quedan iguales, así que la línea y la columna de cada coincidencia son las
 * del archivo original. Imprimir el archivo sin comentarios (`ts.createPrinter`) lo
 * reformatea y cambia la numeración.
 */
export function stripComments(code: string, filePath: string): string {
  const isJs = filePath.endsWith('.js') || filePath.endsWith('.jsx');
  const scriptKind = isJs ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const ranges = new Map<number, number>();
  const collect = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(code, node.getFullStart()) ?? []) {
      ranges.set(range.pos, range.end);
    }
    for (const range of ts.getTrailingCommentRanges(code, node.getEnd()) ?? []) {
      ranges.set(range.pos, range.end);
    }
    node.getChildren(sourceFile).forEach(collect);
  };
  collect(sourceFile);

  const chars = code.split('');
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}

function escapeRegex(text: string): string {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/** Construye una expresión regular con frontera de palabra para cada identificador. */
function buildRegex(identifier: string): RegExp {
  const escaped = escapeRegex(identifier);
  return new RegExp(`\\b${escaped}\\b`, 'g');
}

export function scanSource(
  source: string,
  filePath: string,
  catalog: ConceptDefinition[] = CATALOG,
): MatchOccurrence[] {
  const lines = stripComments(source, filePath).split(/\r?\n/);
  const originalLines = source.split(/\r?\n/);
  const matches: MatchOccurrence[] = [];
  const normalizedFile = path.isAbsolute(filePath) ? toRepoRelative(filePath) : filePath;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const code = lines[lineIdx];
    for (const concept of catalog) {
      const rx = buildRegex(concept.identifier);
      let match: RegExpExecArray | null;
      while ((match = rx.exec(code)) !== null) {
        matches.push({
          file: normalizedFile,
          line: lineIdx + 1,
          column: match.index + 1,
          identifier: concept.identifier,
          gateway: concept.gateway,
          lineContent: originalLines[lineIdx].trim(),
        });
      }
    }
  }

  return matches;
}

export function scanFile(filePath: string, catalog: ConceptDefinition[] = CATALOG): FileConceptSummary {
  const content = readFileSync(filePath, 'utf8');
  const matches = scanSource(content, filePath, catalog);

  const byGateway: Record<string, number> = {};
  const byIdentifier: Record<string, number> = {};
  const distinct = new Set<string>();

  for (const m of matches) {
    byGateway[m.gateway] = (byGateway[m.gateway] ?? 0) + 1;
    byIdentifier[m.identifier] = (byIdentifier[m.identifier] ?? 0) + 1;
    distinct.add(m.identifier);
  }

  const normalizedFile = path.isAbsolute(filePath) ? toRepoRelative(filePath) : filePath;

  return {
    file: normalizedFile,
    totalOccurrences: matches.length,
    distinctIdentifiersCount: distinct.size,
    distinctIdentifiers: Array.from(distinct).sort(),
    totalMatches: matches.length,
    byGateway,
    byIdentifier,
    matches,
  };
}

function collectFiles(dirPath: string, extensions: string[] = ['.ts', '.js']): string[] {
  const result: string[] = [];
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...collectFiles(fullPath, extensions));
    } else if (stat.isFile()) {
      const ext = path.extname(fullPath).toLowerCase();
      if (extensions.includes(ext) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.spec.ts')) {
        result.push(fullPath);
      }
    }
  }

  return result;
}

export function scanTarget(targetPath: string, catalog: ConceptDefinition[] = CATALOG): DirectoryConceptReport {
  const stat = statSync(targetPath);
  const filePaths = stat.isDirectory() ? collectFiles(targetPath) : [targetPath];

  const files: FileConceptSummary[] = [];
  const totalByGateway: Record<string, number> = {};
  const totalByIdentifier: Record<string, number> = {};
  const globalDistinct = new Set<string>();
  let totalOccurrences = 0;

  for (const f of filePaths) {
    const summary = scanFile(f, catalog);
    files.push(summary);
    totalOccurrences += summary.totalOccurrences;

    for (const [gw, count] of Object.entries(summary.byGateway)) {
      totalByGateway[gw] = (totalByGateway[gw] ?? 0) + count;
    }
    for (const [id, count] of Object.entries(summary.byIdentifier)) {
      totalByIdentifier[id] = (totalByIdentifier[id] ?? 0) + count;
      globalDistinct.add(id);
    }
  }

  return {
    target: toRepoRelative(targetPath),
    scannedFiles: filePaths.length,
    totalOccurrences,
    distinctIdentifiersCount: globalDistinct.size,
    distinctIdentifiers: Array.from(globalDistinct).sort(),
    totalMatches: totalOccurrences,
    byGateway: totalByGateway,
    byIdentifier: totalByIdentifier,
    files,
  };
}

export interface CliOptions {
  targets: string[];
  json?: string;
  assertZero: boolean;
}

export function parseArgs(argv: readonly string[], cwd: string = process.cwd()): CliOptions {
  const targets: string[] = [];
  let json: string | undefined;
  let assertZero = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--assert-zero') {
      assertZero = true;
      continue;
    }
    const val = argv[i + 1];
    if (flag === '--target') {
      if (!val || val.startsWith('--')) {
        throw new Error('Missing value for --target');
      }
      targets.push(path.resolve(cwd, val));
      i++;
    } else if (flag === '--json') {
      if (!val || val.startsWith('--')) {
        throw new Error('Missing value for --json');
      }
      json = path.resolve(cwd, val);
      i++;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (targets.length === 0) {
    // Default targets: prototypes B and D
    targets.push(
      path.resolve(cwd, '../prototypes/checkout-sin-solucion/src/payments'),
      path.resolve(cwd, '../prototypes/checkout-con-sdk-front-back/src/payments'),
    );
  }

  return { targets, json, assertZero };
}

export function run(argv: readonly string[]): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  const reports: DirectoryConceptReport[] = [];
  let grandTotalOccurrences = 0;

  console.log('\n=== Native Concepts Scan (Issue #134, Variable 4) ===\n');

  for (const target of options.targets) {
    const report = scanTarget(target);
    reports.push(report);
    grandTotalOccurrences += report.totalOccurrences;

    console.log(`Target: ${report.target}`);
    console.log(`  Scanned files: ${report.scannedFiles}`);
    console.log(`  Distinct identifiers: ${report.distinctIdentifiersCount}`);
    console.log(`  Total occurrences: ${report.totalOccurrences}`);

    if (report.totalOccurrences > 0) {
      console.log(`  Distinct concepts list: ${report.distinctIdentifiers.join(', ')}`);
      console.log('  Breakdown by gateway:');
      for (const [gw, count] of Object.entries(report.byGateway)) {
        console.log(`    - ${gw}: ${count}`);
      }
      console.log('  Breakdown by identifier:');
      for (const [id, count] of Object.entries(report.byIdentifier)) {
        console.log(`    - ${id}: ${count}`);
      }
      console.log('  Files with matches:');
      for (const fileSummary of report.files) {
        if (fileSummary.totalOccurrences > 0) {
          console.log(`    * ${fileSummary.file} (${fileSummary.distinctIdentifiersCount} distinct, ${fileSummary.totalOccurrences} occurrences)`);
          for (const m of fileSummary.matches) {
            console.log(`        L${m.line}: [${m.gateway}] ${m.identifier} -> "${m.lineContent}"`);
          }
        }
      }
    } else {
      console.log('  ✓ No native concepts found (0 distinct identifiers, 0 occurrences).');
    }
    console.log('');
  }

  if (options.json) {
    const jsonOutput = {
      generatedAt: new Date().toISOString(),
      catalog: CATALOG,
      reports,
    };
    mkdirSync(path.dirname(options.json), { recursive: true });
    writeFileSync(options.json, JSON.stringify(jsonOutput, null, 2) + '\n');
    console.log(`JSON report written to: ${options.json}\n`);
  }

  if (options.assertZero && grandTotalOccurrences > 0) {
    console.error(`Assertion failed: expected 0 native concepts, but found ${grandTotalOccurrences}.`);
    return 1;
  }

  return 0;
}

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}
