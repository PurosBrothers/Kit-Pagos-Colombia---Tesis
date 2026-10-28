import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import {
  CATALOG,
  parseArgs,
  run,
  scanFile,
  scanSource,
  scanTarget,
} from '../../scripts/native-concepts';

describe('native-concepts script (Variable 4)', () => {
  let log: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    errorLog.mockRestore();
  });

  describe('CATALOG', () => {
    it('should include concepts for all four gateways', () => {
      const gateways = new Set(CATALOG.map((c) => c.gateway));
      expect(gateways.has('wompi')).toBe(true);
      expect(gateways.has('mercadopago')).toBe(true);
      expect(gateways.has('kushki')).toBe(true);
      expect(gateways.has('rapyd')).toBe(true);
      expect(CATALOG.length).toBeGreaterThanOrEqual(13);
    });
  });

  describe('scanSource()', () => {
    it('should detect native concepts across multiple gateways', () => {
      const sample = [
        'const payload = { amount_in_cents: 50000 };',
        'const mp = { total_amount: 100 };',
        'headers["Public-Merchant-Id"] = "pub_123";',
        'const sig = headerValue(headers, "x-kushki-signature");',
        'const rapyd = { access_key: "abc", salt: "123" };',
        'if (status === "APPROVAL" || status === "CLO") return true;',
      ].join('\n');

      const matches = scanSource(sample, 'sample.ts');
      expect(matches.length).toBe(8);

      const identifiers = matches.map((m) => m.identifier);
      expect(identifiers).toContain('amount_in_cents');
      expect(identifiers).toContain('total_amount');
      expect(identifiers).toContain('Public-Merchant-Id');
      expect(identifiers).toContain('x-kushki-signature');
      expect(identifiers).toContain('access_key');
      expect(identifiers).toContain('salt');
      expect(identifiers).toContain('APPROVAL');
      expect(identifiers).toContain('CLO');
    });

    it('should not match identifiers as substrings of other variable names', () => {
      const sample = [
        'const integritySecret = "some_secret";',
        'const env = process.env.RAPYD_API_ACCESS_KEY;',
        'const saltyFood = true;',
        'const clojureCode = "clojure";',
      ].join('\n');

      const matches = scanSource(sample, 'clean.ts');
      expect(matches).toEqual([]);
    });

    it('should report correct line numbers and contents', () => {
      const sample = [
        'const line1 = 1;',
        'const line2 = { acceptance_token: "tok_123" };',
        'const line3 = 3;',
      ].join('\n');
      const matches = scanSource(sample, 'test.ts');

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        file: 'test.ts',
        line: 2,
        identifier: 'acceptance_token',
        gateway: 'wompi',
        lineContent: 'const line2 = { acceptance_token: "tok_123" };',
      });
    });

    it('should ignore native concepts inside single-line, multi-line, and inline comments', () => {
      const sample = [
        '// Formula: SHA256(reference + amount_in_cents + integrity)',
        '/* Rapyd solo manda salt y access_key en el header */',
        'const status = "PENDING"; // APPROVAL is not returned directly here',
        'const validCode = { total_amount: 100 };',
      ].join('\n');

      const matches = scanSource(sample, 'sample.ts');
      expect(matches).toHaveLength(1);
      expect(matches[0].identifier).toBe('total_amount');
    });

    it('should track distinct identifiers separate from total occurrences', () => {
      const sample = [
        'const a = { total_amount: 100 };',
        'const b = { total_amount: 200 };',
        'const c = { access_key: "k1" };',
      ].join('\n');

      const matches = scanSource(sample, 'sample.ts');
      expect(matches).toHaveLength(3);

      const distinct = new Set(matches.map((m) => m.identifier));
      expect(distinct.size).toBe(2);
      expect(Array.from(distinct).sort()).toEqual(['access_key', 'total_amount']);
    });
  });

  describe('parseArgs()', () => {
    it('should parse valid flags', () => {
      const opts = parseArgs(['--target', 'src', '--json', 'out.json', '--assert-zero'], '/base');

      expect(opts.targets).toEqual([path.resolve('/base', 'src')]);
      expect(opts.json).toBe(path.resolve('/base', 'out.json'));
      expect(opts.assertZero).toBe(true);
    });

    it('should default assertZero to false', () => {
      const opts = parseArgs(['--target', 'src'], '/base');
      expect(opts.assertZero).toBe(false);
    });

    it.each([
      ['an unknown argument', ['--unknown']],
      ['a missing target value', ['--target']],
      ['a missing json value', ['--json']],
    ])('should throw on %s', (_label, argv) => {
      expect(() => parseArgs(argv)).toThrow();
    });
  });

  describe('CLI and filesystem execution', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'concepts-test-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('should scan a directory and write JSON report', () => {
      const fileA = path.join(dir, 'clean.ts');
      const fileB = path.join(dir, 'dirty.ts');
      const jsonOut = path.join(dir, 'report.json');

      writeFileSync(fileA, 'export const clean = 42;\n');
      writeFileSync(fileB, 'export const wompi = { amount_in_cents: 1000 };\n');

      const fileSummary = scanFile(fileB);
      expect(fileSummary.totalMatches).toBe(1);
      expect(fileSummary.byGateway.wompi).toBe(1);

      const dirSummary = scanTarget(dir);
      expect(dirSummary.totalMatches).toBe(1);
      expect(dirSummary.scannedFiles).toBe(2);

      const exitCode = run(['--target', dir, '--json', jsonOut]);
      expect(exitCode).toBe(0);

      const parsed = JSON.parse(readFileSync(jsonOut, 'utf8'));
      expect(parsed.reports).toHaveLength(1);
      expect(parsed.reports[0].totalMatches).toBe(1);
      expect(parsed.reports[0].byGateway.wompi).toBe(1);
    });

    it('should fail with exit code 1 when --assert-zero is set and concepts exist', () => {
      const file = path.join(dir, 'dirty.ts');
      writeFileSync(file, 'export const rapyd = { access_key: "abc" };\n');

      const exitCode = run(['--target', dir, '--assert-zero']);
      expect(exitCode).toBe(1);
    });

    it('should pass with exit code 0 when --assert-zero is set and no concepts exist', () => {
      const file = path.join(dir, 'clean.ts');
      writeFileSync(file, 'export const clean = true;\n');

      const exitCode = run(['--target', dir, '--assert-zero']);
      expect(exitCode).toBe(0);
    });

    it('should return exit code 2 on invalid arguments', () => {
      const exitCode = run(['--invalid-flag']);
      expect(exitCode).toBe(2);
      expect(errorLog).toHaveBeenCalled();
    });
  });
});
