import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  analyzeProject,
  analyzeProjectFiles,
  applyExceptionRegistry,
  loadExceptionRegistry,
  parseArgs,
  RegisteredException,
  run,
  UsageError,
} from "../../scripts/ck-metrics";

/*
 * El proyecto de muestra vive en test/, fuera de las raíces que mide `npm run metrics`.
 * Su única clase se llama `Amount` y viola WMC: ver fixtures/ck-sample/src/Amount.ts.
 */
const SAMPLE_ROOT = path.join(__dirname, "fixtures", "ck-sample", "src");
const SAMPLE_TSCONFIG = path.join(__dirname, "fixtures", "ck-sample", "tsconfig.json");
const SAMPLE_ARGS = ["--root", SAMPLE_ROOT, "--tsconfig", SAMPLE_TSCONFIG];

describe("ck-metrics", () => {
  let log: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    errorLog.mockRestore();
  });

  const printed = (): string => log.mock.calls.map((call) => call.join(" ")).join("\n");

  describe("parseArgs()", () => {
    it("should analyse the SDK in guard mode with its exceptions when there are no arguments", () => {
      const options = parseArgs([]);

      expect(options.roots.map((root) => path.basename(root))).toEqual(["src", "src-browser"]);
      expect(path.basename(options.tsconfig ?? "")).toBe("tsconfig.json");
      expect(options.mode).toBe("guard");
      expect(options.unit).toBe("class");
      expect(options.applyKnownExceptions).toBe(true);
    });

    it("should analyse an external root in measure mode and without exceptions", () => {
      const options = parseArgs(SAMPLE_ARGS);

      expect(options.roots).toEqual([SAMPLE_ROOT]);
      expect(options.tsconfig).toBe(SAMPLE_TSCONFIG);
      expect(options.mode).toBe("measure");
      expect(options.unit).toBe("class");
      expect(options.applyKnownExceptions).toBe(false);
    });

    it("should support --unit and --files flags", () => {
      expect(parseArgs([...SAMPLE_ARGS, "--unit", "file"]).unit).toBe("file");
      expect(parseArgs([...SAMPLE_ARGS, "--unit", "all"]).unit).toBe("all");
      expect(parseArgs([...SAMPLE_ARGS, "--files"]).unit).toBe("file");
    });

    it.each([
      ["an unknown flag", ["--src", "x"]],
      ["a flag without value", ["--root"]],
      ["a flag followed by another flag", ["--root", "--mode", "guard"]],
      ["an invalid mode", ["--root", "x", "--mode", "strict"]],
      ["an invalid unit", ["--root", "x", "--unit", "method"]],
      ["a tsconfig without root", ["--tsconfig", "x/tsconfig.json"]],
    ])("should reject %s", (_label, argv) => {
      expect(() => parseArgs(argv)).toThrow(UsageError);
    });
  });

  describe("on an external project", () => {
    it("should report the violation of a class named like a KNOWN_EXCEPTIONS entry", () => {
      const metrics = analyzeProject(parseArgs(SAMPLE_ARGS));

      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({ file: "Amount.ts", className: "Amount", WMC: 23, maxCC: 2 });
      expect(metrics[0].violations).toEqual(["WMC 23 exceeds threshold (≤ 20)"]);
    });

    it("should exit with 0 in measure mode and still print the violation", () => {
      expect(run(SAMPLE_ARGS)).toBe(0);

      expect(printed()).toContain("WMC 23 exceeds threshold");
      expect(printed()).toContain("1/1 class(es) exceed one or more thresholds");
      expect(printed()).toContain("KNOWN_EXCEPTIONS not applied");
    });

    it("should exit with 1 in guard mode", () => {
      expect(run([...SAMPLE_ARGS, "--mode", "guard"])).toBe(1);
    });

    it("should write the report as JSON", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "ck-metrics-"));
      const file = path.join(dir, "report.json");
      try {
        expect(run([...SAMPLE_ARGS, "--json", file])).toBe(0);

        const report = JSON.parse(readFileSync(file, "utf8"));
        expect(report).toMatchObject({
          mode: "measure",
          roots: ["sdk/test/scripts/fixtures/ck-sample/src"],
          tsconfig: "sdk/test/scripts/fixtures/ck-sample/tsconfig.json",
          knownExceptionsApplied: false,
          totalClasses: 1,
          violatingClasses: 1,
        });
        expect(report.classes[0].violations).toEqual(["WMC 23 exceeds threshold (≤ 20)"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should analyse without a tsconfig", () => {
      const metrics = analyzeProject({ roots: [SAMPLE_ROOT], applyKnownExceptions: false });

      expect(metrics[0].WMC).toBe(23);
    });
  });

  describe("file-level metrics (issue #134)", () => {
    it("should compute metrics for files using analyzeProjectFiles()", () => {
      const fileMetrics = analyzeProjectFiles({ roots: [SAMPLE_ROOT], tsconfig: SAMPLE_TSCONFIG });

      expect(fileMetrics).toHaveLength(1);
      expect(fileMetrics[0]).toMatchObject({
        file: "Amount.ts",
        WMC: 23,
        maxCC: 2,
        functionCount: 12,
        CBO: 0,
      });
      expect(fileMetrics[0].violations).toEqual(["WMC 23 exceeds threshold (≤ 20)"]);
    });

    it("should run with --unit file in measure mode and print file table", () => {
      expect(run([...SAMPLE_ARGS, "--unit", "file"])).toBe(0);

      expect(printed()).toContain("CK Metrics Report (Files as Units)");
      expect(printed()).toContain("Amount.ts");
      expect(printed()).toContain("WMC 23 exceeds threshold");
      expect(printed()).toContain("1/1 file(s) exceed one or more thresholds");
    });

    it("should exit with 1 with --unit file in guard mode when violating", () => {
      expect(run([...SAMPLE_ARGS, "--unit", "file", "--mode", "guard"])).toBe(1);
    });

    it("should output files array in JSON report when --unit file is used", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "ck-file-metrics-"));
      const file = path.join(dir, "report.json");
      try {
        expect(run([...SAMPLE_ARGS, "--unit", "file", "--json", file])).toBe(0);

        const report = JSON.parse(readFileSync(file, "utf8"));
        expect(report.unit).toBe("file");
        expect(report.totalFiles).toBe(1);
        expect(report.violatingFiles).toBe(1);
        expect(report.files[0].file).toBe("Amount.ts");
        expect(report.files[0].WMC).toBe(23);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should support --unit all to analyze both classes and files", () => {
      expect(run([...SAMPLE_ARGS, "--unit", "all"])).toBe(0);

      expect(printed()).toContain("CK Metrics Report");
      expect(printed()).toContain("CK Metrics Report (Files as Units)");
    });
  });

  it("should exit with 2 on invalid arguments", () => {
    expect(run(["--mode", "strict"])).toBe(2);
    expect(errorLog).toHaveBeenCalled();
  });

  describe("CBO counting (issue #153)", () => {
    const CBO_ROOT = path.join(__dirname, "fixtures", "ck-cbo", "src");
    const CBO_TSCONFIG = path.join(__dirname, "fixtures", "ck-cbo", "tsconfig.json");

    const cboOf = (className: string): number | undefined =>
      analyzeProject({ roots: [CBO_ROOT], tsconfig: CBO_TSCONFIG, applyKnownExceptions: false }).find(
        (m) => m.className === className,
      )?.CBO;

    it("should count an import used through its alias", () => {
      expect(cboOf("Aliased")).toBe(1);
    });

    it("should not count a name only because another type in the signature contains it", () => {
      expect(cboOf("Nested")).toBe(1);
    });

    it("should count a typeof and a generic argument, each name once", () => {
      expect(cboOf("Typed")).toBe(2);
    });
  });

  describe("with an exceptions registry (issue #153)", () => {
    const AMOUNT_WMC: RegisteredException = {
      file: "Amount.ts",
      className: "Amount",
      metric: "WMC",
      allowed: 23,
      logPoint: 107,
      reason: "Sample exception for the test.",
    };

    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), "ck-exceptions-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    const registryFile = (contents: unknown): string => {
      const file = path.join(dir, "ck-exceptions.json");
      writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
      return file;
    };

    const guardWith = (exceptions: RegisteredException[]): number =>
      run([...SAMPLE_ARGS, "--exceptions", registryFile({ exceptions }), "--mode", "guard"]);

    it("should keep the registry path and stay out of the SDK run", () => {
      expect(parseArgs([...SAMPLE_ARGS, "--exceptions", "x.json"], "/base").exceptions).toBe(
        path.resolve("/base", "x.json"),
      );
      expect(parseArgs(SAMPLE_ARGS)).not.toHaveProperty("exceptions");
      expect(() => parseArgs(["--exceptions", "x.json"])).toThrow(UsageError);
    });

    it("should let guard mode pass when the violation is registered by file, class and metric", () => {
      expect(guardWith([AMOUNT_WMC])).toBe(0);

      expect(printed()).toContain("All 1 class(es) within thresholds");
      expect(printed()).toContain("Amount.ts  Amount  WMC ≤ 23 — architecture-log.md, point 107");
      expect(printed()).not.toContain("stale");
    });

    it("should not apply an exception registered for a class with the same name in another file", () => {
      expect(guardWith([{ ...AMOUNT_WMC, file: "other/Amount.ts" }])).toBe(1);

      expect(printed()).toContain("WMC 23 exceeds threshold");
      expect(printed()).toContain("stale: other/Amount.ts  Amount  WMC ≤ 23");
    });

    it("should bring the violation back when the metric grows past the allowed value", () => {
      const metrics = analyzeProject(parseArgs(SAMPLE_ARGS));
      const outcome = applyExceptionRegistry(metrics, [{ ...AMOUNT_WMC, allowed: 22 }]);

      expect(metrics[0].violations).toEqual(["WMC 23 exceeds threshold (≤ 20)"]);
      expect(outcome.applied).toEqual([]);
      expect(outcome.stale).toHaveLength(1);
    });

    it("should fail guard mode on an exception that covers no violation, and only report it in measure mode", () => {
      const stale = { ...AMOUNT_WMC, metric: "CBO" as const, allowed: 6 };

      expect(guardWith([AMOUNT_WMC, stale])).toBe(1);
      expect(printed()).toContain("stale: Amount.ts  Amount  CBO ≤ 6 covers no violation");

      expect(run([...SAMPLE_ARGS, "--exceptions", registryFile({ exceptions: [AMOUNT_WMC, stale] })])).toBe(0);
    });

    it.each([
      ["a file that is not JSON", "{ exceptions: "],
      ["a registry without an exceptions array", { exception: [] }],
      ["an entry without a log point", { exceptions: [{ ...AMOUNT_WMC, logPoint: undefined }] }],
      ["an entry with an unknown metric", { exceptions: [{ ...AMOUNT_WMC, metric: "LOC" }] }],
      ["an entry with an empty reason", { exceptions: [{ ...AMOUNT_WMC, reason: " " }] }],
      ["an entry with a non-integer allowed value", { exceptions: [{ ...AMOUNT_WMC, allowed: 7.5 }] }],
    ])("should reject %s with exit code 2", (_label, contents) => {
      const file = registryFile(contents);

      expect(() => loadExceptionRegistry(file)).toThrow(UsageError);
      expect(run([...SAMPLE_ARGS, "--exceptions", file])).toBe(2);
    });

    it("should exit with 2 when the registry does not exist", () => {
      expect(run([...SAMPLE_ARGS, "--exceptions", path.join(dir, "missing.json")])).toBe(2);
    });

    it("should write the applied and the stale exceptions in the JSON report", () => {
      const stale = { ...AMOUNT_WMC, metric: "RFC" as const };
      const exceptions = registryFile({ exceptions: [AMOUNT_WMC, stale] });
      const file = path.join(dir, "report.json");

      expect(run([...SAMPLE_ARGS, "--exceptions", exceptions, "--json", file])).toBe(0);

      const report = JSON.parse(readFileSync(file, "utf8"));
      expect(report).toMatchObject({
        exceptionsRegistry: expect.stringMatching(/ck-exceptions\.json$/),
        registeredExceptions: [AMOUNT_WMC],
        staleExceptions: [stale],
        violatingClasses: 0,
      });
    });
  });

  describe("file mode (--unit file) on functional files", () => {
    const FILE_SAMPLE_ROOT = path.join(__dirname, "fixtures", "ck-file-sample", "src");
    const FILE_SAMPLE_TSCONFIG = path.join(__dirname, "fixtures", "ck-file-sample", "tsconfig.json");

    it("should measure standalone functions, const arrows, object methods, callback branches, imported types and direct calls", () => {
      const fileMetrics = analyzeProjectFiles({
        roots: [FILE_SAMPLE_ROOT],
        tsconfig: FILE_SAMPLE_TSCONFIG,
      });

      const sample = fileMetrics.find((m) => m.file === "moduleSample.ts");
      expect(sample).toBeDefined();

      // WMC: processOrder(3) + calculateTax(1) + validate(2) + format(1) = 7
      expect(sample?.WMC).toBe(7);
      // MAX_CC: processOrder() has complexity 3 because branches in unassigned callback sum to containing function
      expect(sample?.maxCC).toBe(3);
      expect(sample?.worstFunction).toBe("processOrder()");
      // CBO: OrderPayload from ./types used in signature of processOrder
      expect(sample?.CBO).toBe(1);
      // RFC: 4 callables + 4 external calls (externalHelper direct call + map + compute + trim) = 8
      expect(sample?.RFC).toBe(8);
      expect(sample?.violations).toEqual([]);
    });

    it("should run successfully in measure mode with --unit file and output JSON", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "ck-file-metrics-"));
      const jsonFile = path.join(dir, "report.json");

      const exitCode = run([
        "--root",
        FILE_SAMPLE_ROOT,
        "--tsconfig",
        FILE_SAMPLE_TSCONFIG,
        "--unit",
        "file",
        "--json",
        jsonFile,
      ]);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(readFileSync(jsonFile, "utf8"));
      expect(parsed.unit).toBe("file");
      expect(parsed.files).toBeDefined();
      expect(parsed.files.length).toBeGreaterThanOrEqual(1);

      rmSync(dir, { recursive: true, force: true });
    });
  });
});
