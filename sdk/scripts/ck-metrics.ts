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
 *   - WMC = number of methods (public, private, protected) + constructors
 *   - CBO = number of distinct external classes referenced in method signatures
 *   - RFC = WMC + number of distinct external method calls in method bodies
 */

import { Project, SourceFile, ClassDeclaration, SyntaxKind } from 'ts-morph';
import * as path from 'path';

// ── Thresholds (methodology.md §6, Definition of Done condition 4) ────────────
const THRESHOLDS = {
  WMC: 15,
  CBO: 5,
  RFC: 20,
} as const;

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
  violations: string[];
}

/**
 * WMC: Count all methods (public, private, protected) + constructors.
 * Approximation per methodology.md: simple method count without full cyclomatic
 * complexity analysis. Each method contributes weight 1.
 */
function calcWMC(cls: ClassDeclaration): number {
  const methodCount = cls.getMethods().length;
  const constructorCount = cls.getConstructors().length;
  return methodCount + constructorCount;
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
 * RFC: Response For a Class = WMC + count of distinct external method calls.
 * External calls: any call to a method that is not on `this`.
 * Example: this.internal() is not counted, but gateway.pay() is.
 * Approximation: count distinct call expressions in method bodies.
 */
function calcRFC(cls: ClassDeclaration, wmc: number): number {
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
        externalCalls.add(text);
      }
    }
  }

  return wmc + externalCalls.size;
}

/**
 * Print a formatted table of metrics with color coding for violations.
 */
function printReport(metrics: ClassMetrics[]): void {
  const COL = {
    file:      36,
    className: 26,
    WMC:        7,
    CBO:        7,
    RFC:        7,
    status:    10,
  };

  const hr = '─'.repeat(
    COL.file + COL.className + COL.WMC + COL.CBO + COL.RFC + COL.status + 18,
  );

  console.log(`\n${BOLD}${YELLOW}CK Metrics Report${RESET} — Kit Pagos Colombia SDK\n`);
  console.log(`${YELLOW}Thresholds${RESET} (methodology.md §6): WMC ≤ ${THRESHOLDS.WMC}  CBO ≤ ${THRESHOLDS.CBO}  RFC ≤ ${THRESHOLDS.RFC}\n`);
  console.log(hr);

  // Table header
  const headerRow =
    `${'File'.padEnd(COL.file)}` +
    `${'Class'.padEnd(COL.className)}` +
    `${'WMC'.padStart(COL.WMC)}` +
    `${'CBO'.padStart(COL.CBO)}` +
    `${'RFC'.padStart(COL.RFC)}` +
    `  Status`;
  console.log(`${BOLD}${headerRow}${RESET}`);
  console.log(hr);

  // Data rows
  for (const m of metrics) {
    const hasViolation = m.violations.length > 0;
    const status = hasViolation ? `${RED}FAIL${RESET}` : `${GREEN}✓ OK${RESET}`;

    // Color numbers that exceed thresholds
    const wmcStr = m.WMC > THRESHOLDS.WMC ? `${RED}${m.WMC}${RESET}` : String(m.WMC);
    const cboStr = m.CBO > THRESHOLDS.CBO ? `${RED}${m.CBO}${RESET}` : String(m.CBO);
    const rfcStr = m.RFC > THRESHOLDS.RFC ? `${RED}${m.RFC}${RESET}` : String(m.RFC);

    // Build row (accounting for ANSI codes in string length)
    const row =
      m.file.padEnd(COL.file) +
      m.className.padEnd(COL.className) +
      `${wmcStr}`.padStart(COL.WMC) +
      `${cboStr}`.padStart(COL.CBO) +
      `${rfcStr}`.padStart(COL.RFC) +
      `  ${status}`;

    console.log(row);

    // Print violation details below each failing class
    if (hasViolation) {
      for (const v of m.violations) {
        console.log(`  ${RED}↳ ${v}${RESET}`);
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
      const RFC = calcRFC(cls, WMC);

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

      allMetrics.push({ file: relPath, className, WMC, CBO, RFC, violations });
    }
  }

  // Handle case where no classes are found
  if (allMetrics.length === 0) {
    console.log('\n⚠️  No classes found in sdk/src/. Nothing to report.\n');
    process.exit(0);
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