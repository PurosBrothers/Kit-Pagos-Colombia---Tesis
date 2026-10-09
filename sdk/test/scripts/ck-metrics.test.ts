import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { analyzeProject, parseArgs, run, UsageError } from "../../scripts/ck-metrics";

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
      expect(options.applyKnownExceptions).toBe(true);
    });

    it("should analyse an external root in measure mode and without exceptions", () => {
      const options = parseArgs(SAMPLE_ARGS);

      expect(options.roots).toEqual([SAMPLE_ROOT]);
      expect(options.tsconfig).toBe(SAMPLE_TSCONFIG);
      expect(options.mode).toBe("measure");
      expect(options.applyKnownExceptions).toBe(false);
    });

    it.each([
      ["an unknown flag", ["--src", "x"]],
      ["a flag without value", ["--root"]],
      ["a flag followed by another flag", ["--root", "--mode", "guard"]],
      ["an invalid mode", ["--root", "x", "--mode", "strict"]],
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
          roots: [SAMPLE_ROOT],
          tsconfig: SAMPLE_TSCONFIG,
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

  it("should exit with 2 on invalid arguments", () => {
    expect(run(["--mode", "strict"])).toBe(2);
    expect(errorLog).toHaveBeenCalled();
  });
});
