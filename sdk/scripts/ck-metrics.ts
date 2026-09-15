/**
 * ck-metrics.ts
 *
 * CK Metrics Analysis — Issue #19
 *
 * Analyzes WMC (Weighted Methods per Class), CBO (Coupling Between Objects),
 * and RFC (Response For a Class) for every class in sdk/src/**\/*.ts.
 * Compares metrics against thresholds defined in docs/project-management/methodology.md:
 * - WMC ≤ 15 (Definition of Done, condition 4)
 * - CBO ≤ 5  (loose coupling target)
 * - RFC ≤ 20 (responsibility scope)
 *
 * Metrics guide the experimental evaluation (Phase 5 of SPMP): whether introducing
 * the architecture-as-code framework improves coupling and complexity vs. baseline.
 *
 * Usage:
 *   npm run metrics
 *
 * Exit codes:
 *   0 = all classes within thresholds
 *   1 = one or more classes exceed thresholds (for CI integration)
 *
 * Thresholds source: docs/project-management/methodology.md §6, Definition of Done
 * Calculation formulas:
 *   - WMC = sum of the cyclomatic complexity of every method and constructor
 *   - CC  = cyclomatic complexity of a single method (reported as its maximum)
 *   - CBO = number of distinct external classes referenced in method signatures
 *   - RFC = number of methods + number of distinct external method calls
 *
 * WMC used to be a plain method count, which made it blind to exactly what it is
 * supposed to measure: a single 360-line method holding a four-way switch scored
 * WMC 1, the best in the codebase. Chidamber & Kemerer define WMC as the sum of
 * method complexities, and that is what is computed here. See
 * docs/architecture/architecture-log.md, point 34.
 */

import {
  Project,
  SourceFile,
  ClassDeclaration,
  MethodDeclaration,
  ConstructorDeclaration,
  SyntaxKind,
  Node,
} from 'ts-morph';
import * as path from 'path';

// ── Thresholds (methodology.md §6, Definition of Done condition 4) ────────────
//
// WMC sube de 15 a 20 al pasar de conteo de metodos a suma de complejidad
// ciclomatica: son escalas distintas y el 15 original no era comparable. 20 es
// el valor que reporta el SATC de NASA para WMC y el que usan las herramientas
// que implementan la metrica canonica.
//
// MAX_CC es nuevo y es el que hace el trabajo real de mantenibilidad: 10 es el
// umbral clasico de McCabe. WMC acota cuanto hace una clase en total; MAX_CC
// acota cuanto hace un metodo, que es donde se lee y se corrige el codigo.
const THRESHOLDS = {
  WMC: 20,
  CBO: 5,
  RFC: 20,
  MAX_CC: 10,
} as const;

// Excepciones documentadas: clases cuyo acoplamiento por encima del umbral
// es una consecuencia directa de una decision arquitectonica ya registrada,
// no un defecto de diseño. Cada entrada debe enlazar al punto del
// architecture-log.md que la justifica. Agregar una clase aqui sin ese
// registro no es una resolucion valida.
const KNOWN_EXCEPTIONS: Record<string, { metric: 'WMC' | 'CBO' | 'RFC' | 'MAX_CC'; reason: string }[]> = {
  Transaction: [{
    metric: 'CBO',
    reason: 'SAD 15.1: unica Entity del dominio, construida a partir de ' +
            'los 7 objetos de valor del modelo unificado. Ver architecture-log.md, punto 22.',
  }],
  Amount: [{
    metric: 'WMC',
    reason: 'WMC 23 es la suma de 12 metodos con complejidad maxima 4: no hay ' +
            'ningun metodo complejo, hay muchas operaciones pequenas, y esas ' +
            'operaciones son la superficie del objeto de valor que exige el SAD ' +
            '15.1 (aritmetica exacta con escala). Partirla para bajar la suma ' +
            'separaria operaciones de dinero de su invariante de escala. La ' +
            'senal que si aplica aca es MAX_CC, y esta en 4 de 10. ' +
            'Ver architecture-log.md, punto 34.',
  }],
};

// ── ANSI terminal colors ──────────────────────────────────────────────────────
const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD  = '\x1b[1m';
const RESET = '\x1b[0m';

interface ClassMetrics {
  file: string;
  className: string;
  WMC: number;
  CBO: number;
  RFC: number;
  maxCC: number;
  worstMethod: string;
  violations: string[];
}

type Callable = MethodDeclaration | ConstructorDeclaration;

/** Nodos que introducen una rama en el flujo de control. */
const BRANCH_KINDS = [
  SyntaxKind.IfStatement,
  SyntaxKind.CaseClause,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
] as const;

/** Operadores que cortocircuitan y por lo tanto crean un camino alterno. */
const BRANCH_OPERATORS = [
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
] as const;

/**
 * Cyclomatic complexity of a single method: 1 + one per decision point.
 *
 * `case` counts but `default` does not: default is the path that already existed
 * when no case matches, so counting it would double-count the same route.
 * Optional chaining (`?.`) is not counted either — it short-circuits a property
 * access, not a branch a reader has to follow.
 */
function calcCyclomaticComplexity(node: Callable): number {
  let complexity = 1;

  for (const kind of BRANCH_KINDS) {
    complexity += node.getDescendantsOfKind(kind).length;
  }

  for (const bin of node.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (BRANCH_OPERATORS.includes(bin.getOperatorToken().getKind() as never)) {
      complexity += 1;
    }
  }

  return complexity;
}

/** Todos los invocables de la clase: metodos y constructores. */
function callablesOf(cls: ClassDeclaration): Callable[] {
  return [...cls.getConstructors(), ...cls.getMethods()];
}

/**
 * WMC: sum of the cyclomatic complexity of every method and constructor.
 *
 * This is the Chidamber & Kemerer definition. Note that it is *not* reduced by
 * extracting methods out of a large one: the decision points move but each new
 * method adds its own base 1, so the sum stays roughly flat. Lowering WMC means
 * either removing duplicated logic or splitting the class.
 */
function calcWMC(cls: ClassDeclaration): number {
  return callablesOf(cls).reduce(
    (sum, c) => sum + calcCyclomaticComplexity(c),
    0,
  );
}

/**
 * Highest cyclomatic complexity among the class methods, with its name.
 *
 * Complements WMC: a class can have an acceptable total while hiding one
 * unreadable method, and a cohesive class can have a high total made entirely of
 * trivial methods. The two numbers answer different questions.
 */
function calcMaxCC(cls: ClassDeclaration): { maxCC: number; worstMethod: string } {
  let maxCC = 0;
  let worstMethod = '—';

  for (const c of callablesOf(cls)) {
    const cc = calcCyclomaticComplexity(c);
    if (cc > maxCC) {
      maxCC = cc;
      worstMethod = Node.isConstructorDeclaration(c) ? 'constructor' : c.getName();
    }
  }

  return { maxCC, worstMethod };
}

/** Number of methods and constructors, used by RFC. */
function calcMethodCount(cls: ClassDeclaration): number {
  return cls.getMethods().length + cls.getConstructors().length;
}

/**
 * CBO: Count distinct external classes imported or referenced in method/constructor signatures.
 * A class reference in a signature creates coupling: parameter types, return types, etc.
 * Only counts names that appear in the imports (not built-ins).
 */
function calcCBO(cls: ClassDeclaration, sourceFile: SourceFile): number {
  const externalTypes = new Set<string>();

  // Step 1: Collect all imported names in this source file
  const importedNames = new Set<string>();
  for (const importDecl of sourceFile.getImportDeclarations()) {
    // Named imports: import { A, B } from 'pkg'
    for (const named of importDecl.getNamedImports()) {
      importedNames.add(named.getName());
    }
    // Default import: import A from 'pkg'
    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport) {
      importedNames.add(defaultImport.getText());
    }
  }

  // Step 2: Check method and constructor signatures for references to imported names
  const allSignatures = [
    ...cls.getMethods(),
    ...cls.getConstructors(),
  ];

  for (const sig of allSignatures) {
    // Parameter types
    for (const param of sig.getParameters()) {
      const typeNode = param.getTypeNode();
      if (typeNode) {
        const typeText = typeNode.getText();
        for (const importedName of importedNames) {
          if (typeText.includes(importedName)) {
            externalTypes.add(importedName);
          }
        }
      }
    }

    // Return type (for methods only)
    if (sig.getKind && sig.getKind() !== SyntaxKind.Constructor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const returnType = (sig as any).getReturnTypeNode?.();
      if (returnType) {
        const returnText = returnType.getText();
        for (const importedName of importedNames) {
          if (returnText.includes(importedName)) {
            externalTypes.add(importedName);
          }
        }
      }
    }
  }

  return externalTypes.size;
}

/**
 * RFC: Response For a Class = method count + distinct external method calls.
 *
 * External calls: any call to a method that is not on `this`.
 * Example: this.internal() is not counted, but gateway.pay() is.
 *
 * RFC counts the *size of the response set* — how many distinct methods can run
 * in reaction to a message — so it takes the plain method count and not WMC.
 * Feeding it the complexity-weighted WMC would conflate two different ideas and
 * make RFC grow with every `if` added inside an existing method.
 */
function calcRFC(cls: ClassDeclaration, methodCount: number): number {
  const externalCalls = new Set<string>();

  const allBodies = [
    ...cls.getMethods(),
    ...cls.getConstructors(),
  ];

  for (const method of allBodies) {
    const callExprs = method.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of callExprs) {
      const expr = call.getExpression();
      const text = expr.getText();

      // External call = has a dot + receiver is not 'this'
      if (text.includes('.') && !text.startsWith('this.')) {
        // Deduplicar por el metodo real invocado, no por la cadena completa
        // con sus argumentos: `a.b(x).c(y)` y `a.b(z).c(w)` son la misma
        // llamada a `c`, no dos llamadas distintas. Sin esto, cualquier
        // metodo que encadene llamadas nativas (crypto, JSON, arrays) con
        // argumentos distintos en cada invocacion infla el conteo de forma
        // artificial.
        const methodName = text.match(/\.([A-Za-z_$][\w$]*)$/)?.[1] ?? text;
        externalCalls.add(methodName);
      }
    }
  }

  return methodCount + externalCalls.size;
}

/**
 * Print a formatted table of metrics with color coding for violations.
 * Column widths are computed dynamically from actual content so nothing overflows.
 */
function printReport(metrics: ClassMetrics[]): void {
  // Dynamic column widths based on actual content
  const fileW  = Math.max('File'.length,  ...metrics.map(m => m.file.length))      + 2;
  const classW = Math.max('Class'.length, ...metrics.map(m => m.className.length)) + 2;
  const numW   = 7; // numbers are always short

  const totalW = fileW + classW + numW * 4 + '  Status'.length;
  const hr = '─'.repeat(totalW);

  console.log(`\n${BOLD}${YELLOW}CK Metrics Report${RESET} — Kit Pagos Colombia SDK\n`);
  console.log(`${YELLOW}Thresholds${RESET} (methodology.md §6): WMC ≤ ${THRESHOLDS.WMC}  CBO ≤ ${THRESHOLDS.CBO}  RFC ≤ ${THRESHOLDS.RFC}  MAX_CC ≤ ${THRESHOLDS.MAX_CC}\n`);
  console.log(hr);

  // Table header
  const headerRow =
    'File'.padEnd(fileW) +
    'Class'.padEnd(classW) +
    'WMC'.padStart(numW) +
    'CBO'.padStart(numW) +
    'RFC'.padStart(numW) +
    'MaxCC'.padStart(numW) +
    '  Status';
  console.log(`${BOLD}${headerRow}${RESET}`);
  console.log(hr);

  // Data rows
  for (const m of metrics) {
    const hasViolation = m.violations.length > 0;
    const status = hasViolation ? `${RED}FAIL${RESET}` : `${GREEN}✓ OK${RESET}`;

    // Pad the raw number string first (no ANSI), then colorize.
    // This avoids ANSI escape codes skewing padStart width calculations.
    const wmcPad = String(m.WMC).padStart(numW);
    const cboPad = String(m.CBO).padStart(numW);
    const rfcPad = String(m.RFC).padStart(numW);
    const ccPad  = String(m.maxCC).padStart(numW);
    const wmcCol = m.WMC > THRESHOLDS.WMC ? `${RED}${wmcPad}${RESET}` : wmcPad;
    const cboCol = m.CBO > THRESHOLDS.CBO ? `${RED}${cboPad}${RESET}` : cboPad;
    const rfcCol = m.RFC > THRESHOLDS.RFC ? `${RED}${rfcPad}${RESET}` : rfcPad;
    const ccCol  = m.maxCC > THRESHOLDS.MAX_CC ? `${RED}${ccPad}${RESET}` : ccPad;

    const row =
      m.file.padEnd(fileW) +
      m.className.padEnd(classW) +
      wmcCol +
      cboCol +
      rfcCol +
      ccCol +
      `  ${status}`;

    console.log(row);

    // Print violation details below each failing class
    if (hasViolation) {
      for (const v of m.violations) {
        console.log(`  ${RED}↓ ${v}${RESET}`);
      }
    }
  }

  console.log(hr);
}

/**
 * Main entry point: set up ts-morph project, traverse SDK source files,
 * calculate metrics, and report violations.
 */
function main(): void {
  const sdkRoot = path.resolve(__dirname, '..', 'src');

  // Load TypeScript project using SDK's tsconfig.json
  const project = new Project({
    tsConfigFilePath: path.resolve(__dirname, '..', 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });

  // Add all source files matching sdk/src/**/*.ts (exclude tests)
  project.addSourceFilesAtPaths([
    `${sdkRoot}/**/*.ts`,
    `!${sdkRoot}/**/*.test.ts`,
    `!${sdkRoot}/**/*.spec.ts`,
  ]);

  const allMetrics: ClassMetrics[] = [];

  // Process each source file
  for (const sourceFile of project.getSourceFiles()) {
    const relPath = path.relative(sdkRoot, sourceFile.getFilePath());
    const classes = sourceFile.getClasses();

    // Process each class in the file
    for (const cls of classes) {
      const className = cls.getName() ?? '(anonymous)';

      const WMC = calcWMC(cls);
      const CBO = calcCBO(cls, sourceFile);
      const RFC = calcRFC(cls, calcMethodCount(cls));
      const { maxCC, worstMethod } = calcMaxCC(cls);

      // Check for threshold violations
      const violations: string[] = [];
      if (WMC > THRESHOLDS.WMC) {
        violations.push(`WMC ${WMC} exceeds threshold (≤ ${THRESHOLDS.WMC})`);
      }
      if (CBO > THRESHOLDS.CBO) {
        violations.push(`CBO ${CBO} exceeds threshold (≤ ${THRESHOLDS.CBO})`);
      }
      if (RFC > THRESHOLDS.RFC) {
        violations.push(`RFC ${RFC} exceeds threshold (≤ ${THRESHOLDS.RFC})`);
      }
      if (maxCC > THRESHOLDS.MAX_CC) {
        violations.push(
          `MAX_CC ${maxCC} in ${worstMethod}() exceeds threshold (≤ ${THRESHOLDS.MAX_CC})`
        );
      }

      allMetrics.push({
        file: relPath, className, WMC, CBO, RFC, maxCC, worstMethod, violations,
      });
    }
  }

  // Handle case where no classes are found
  if (allMetrics.length === 0) {
    console.log('\nNo classes found in sdk/src/. Nothing to report.\n');
    process.exit(0);
  }

  // Filtrar violaciones ya cubiertas por excepciones documentadas
  // (arquitectura registrada en architecture-log.md), antes de imprimir
  // y de contarlas, para que la tabla refleje el estado real.
  for (const m of allMetrics) {
    const realViolations = m.violations.filter(v => {
      const metric = v.split(' ')[0]; // "CBO 7 exceeds..." -> "CBO"
      const exceptions = KNOWN_EXCEPTIONS[m.className] ?? [];
      return !exceptions.some(e => e.metric === metric);
    });
    m.violations = realViolations;
  }

  // Print results
  printReport(allMetrics);

  // Summary
  const totalClasses = allMetrics.length;
  const violatingClasses = allMetrics.filter(m => m.violations.length > 0).length;

  if (violatingClasses === 0) {
    console.log(
      `\n${GREEN}✓ All ${totalClasses} class(es) within thresholds.${RESET}\n`
    );
  } else {
    console.log(
      `\n${RED}✗ ${violatingClasses}/${totalClasses} class(es) exceed one or more thresholds.${RESET}\n`
    );
  }

  // Non-zero exit code for CI integration (issue #15, condition 4 of DoD)
  process.exit(violatingClasses > 0 ? 1 : 0);
}

// Run script
main();