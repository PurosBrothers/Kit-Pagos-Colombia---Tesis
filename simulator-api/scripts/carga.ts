/**
 * Prueba de carga aislada de la API de Simulación: la §3.2.3 del plan de pruebas
 * (`docs/final-doc/pruebas/`), ejecutada en el issue #174.
 *
 * La carga nunca puede llegar a una pasarela, a su sandbox ni a Render. Por eso el script:
 *
 * 1. aborta si encuentra un `.env` que `loadServerEnv()` leería o variables de pasarela en el entorno;
 * 2. instala un guardián sobre `globalThis.fetch` que bloquea y cuenta todo host que no sea de
 *    loopback, y lo autoprueba con `example.invalid` (RFC 2606) antes de cargar;
 * 3. construye la app en este mismo proceso con credenciales ficticias y la pone a escuchar en
 *    `127.0.0.1` con un puerto que asigna el sistema;
 * 4. no acepta una URL de destino ni la cabecera `x-kit-pagos-environment` con otro valor que
 *    `simulator`.
 *
 * Si el guardián bloquea algo, la corrida es nula y no se reporta ninguna cifra.
 *
 * Uso, desde `simulator-api/`:
 *   npx ts-node --transpile-only scripts/carga.ts [--salida=DIR] [--medicion=30] [--calentamiento=5] [--repeticiones=3]
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import autocannon from "autocannon";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SIMULATOR_ROOT = path.resolve(__dirname, "..");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const ENVIRONMENT_HEADER = "x-kit-pagos-environment";
const CONNECTION_LEVELS = [10, 50] as const;

/** Las rutas que `loadServerEnv()` lee, en `src/auth/CredentialResolver.ts`. */
const ENV_FILES = [
  path.join(REPO_ROOT, ".env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  "/etc/secrets/.env",
];
const FORBIDDEN_VARIABLE = /^(WOMPI|MERCADOPAGO|KUSHKI|RAPYD)_|^SIMULATOR_SDK_BASE_URL$|^(SIMULATOR_)?API_AUTH_TOKEN$/;

/** Credenciales inventadas: el perfil de Wompi del servidor con el que cobran E3 a E5. */
const FAKE_ENV: Record<string, string | undefined> = {
  WOMPI_PUBLIC_KEY: "pub_test_carga_ficticia",
  WOMPI_PRIVATE_KEY: "prv_test_carga_ficticia",
  WOMPI_INTEGRITY_SECRET: "integridad_carga_ficticia",
};

interface Settings {
  outputDir: string;
  measureSeconds: number;
  warmupSeconds: number;
  repetitions: number;
}

interface Scenario {
  id: string;
  description: string;
  method: "GET" | "POST";
  path: (paymentId: string) => string;
  headers: Record<string, string>;
  body?: (sequence: number) => string;
}

interface RunRecord {
  run: string;
  scenario: string;
  connections: number;
  repetition: number;
  startedAt: string;
  measureSeconds: number;
  own: { responses: number; p50Ms: number; p95Ms: number; p99Ms: number };
  requestsPerSecond: { average: number; stddev: number };
  bytesPerSecond: number;
  errors: number;
  timeouts: number;
  non2xx: number;
  total: number;
  errorRate: number;
  rssBeforeMb: number;
  rssAfterMb: number;
  eventLoopDelayP99Ms: number;
  autocannon: autocannon.Result;
}

class GuardError extends Error {}

const consoleLines: string[] = [];
function say(line: string): void {
  consoleLines.push(line);
  console.log(line);
}

function parseSettings(argv: readonly string[]): Settings {
  const value = (name: string): string | undefined =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const positive = (name: string, fallback: number): number => {
    const raw = value(name);
    const parsed = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`--${name} tiene que ser un entero positivo, y vale «${raw}».`);
    }
    return parsed;
  };
  return {
    outputDir: path.resolve(value("salida") ?? path.join(REPO_ROOT, "docs", "final-doc", "pruebas", "evidencias", "carga")),
    measureSeconds: positive("medicion", 30),
    warmupSeconds: positive("calentamiento", 5),
    repetitions: positive("repeticiones", 3),
  };
}

/** Regla 2 del plan: sin `.env` y sin variables de pasarela, antes de importar nada del simulador. */
function refuseRealCredentials(): void {
  const files = [...new Set(ENV_FILES)].filter((file) => fs.existsSync(file));
  if (files.length > 0) {
    throw new GuardError(`hay un .env que el simulador leería (${files.join(", ")}); córralo desde un checkout sin .env.`);
  }
  const variables = Object.keys(process.env).filter((name) => FORBIDDEN_VARIABLE.test(name));
  if (variables.length > 0) {
    throw new GuardError(`el entorno define ${variables.join(", ")}; córralo sin esas variables.`);
  }
}

/** Regla 3 del plan: ningún escenario puede pedir otro ambiente que `simulator`. */
function refuseOtherEnvironments(scenarios: readonly Scenario[]): void {
  for (const scenario of scenarios) {
    for (const [name, value] of Object.entries(scenario.headers)) {
      if (name.toLowerCase() === ENVIRONMENT_HEADER && value.trim().toLowerCase() !== "simulator") {
        throw new GuardError(`el escenario ${scenario.id} pide ${ENVIRONMENT_HEADER}: ${value}; solo se acepta simulator.`);
      }
    }
  }
}

/** Regla 4 del plan: el guardián de `fetch`, con su contador. */
function installFetchGuard(): { blocked: string[] } {
  const state = { blocked: [] as string[] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      state.blocked.push(url.hostname);
      throw new GuardError(`guardián: petición a ${url.hostname} bloqueada`);
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return state;
}

async function selfTest(guard: { blocked: string[] }): Promise<void> {
  try {
    await fetch("http://example.invalid/");
  } catch (error) {
    if (error instanceof GuardError && guard.blocked.length === 1) {
      say(`Autoprueba del guardián: example.invalid bloqueado (${error.message}).`);
      guard.blocked.length = 0;
      return;
    }
    throw new GuardError(`la autoprueba no se bloqueó en el guardián: ${(error as Error).message}`);
  }
  throw new GuardError("la autoprueba llegó a responder: el guardián no está instalado.");
}

function payment(reference: string): string {
  return JSON.stringify({
    gateway: "WOMPI",
    amount: 50000,
    currency: "COP",
    description: "Carga aislada",
    orderReference: reference,
    payer: {
      email: "carga@example.com",
      fullName: "Comprador Ficticio",
      documentType: "CC",
      documentNumber: "1000000001",
      phoneNumber: "3000000000",
    },
    paymentMethod: { type: "CARD", cardToken: "tok_test_carga" },
  });
}

const JSON_HEADERS = { "content-type": "application/json" };

const SCENARIOS: readonly Scenario[] = [
  { id: "E1", description: "GET /health", method: "GET", path: () => "/health", headers: {} },
  { id: "E2", description: "GET /v1/api/gateways", method: "GET", path: () => "/v1/api/gateways", headers: {} },
  {
    id: "E3",
    description: "GET /v1/api/pse-banks?gateway=wompi",
    method: "GET",
    path: () => "/v1/api/pse-banks?gateway=wompi",
    headers: {},
  },
  {
    id: "E4",
    description: "GET /v1/api/payments/:id?gateway=wompi",
    method: "GET",
    path: (paymentId) => `/v1/api/payments/${paymentId}?gateway=wompi`,
    headers: {},
  },
  {
    id: "E5",
    description: "POST /v1/api/payments",
    method: "POST",
    path: () => "/v1/api/payments",
    headers: JSON_HEADERS,
    body: (sequence) => payment(`ORD-CARGA-${process.pid}-${sequence}`),
  },
];

/** Percentil por rango más cercano sobre las duraciones ya ordenadas. */
function percentile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

function rssMb(): number {
  return Number((process.memoryUsage().rss / 1048576).toFixed(1));
}

function run(options: autocannon.Options, onDuration?: (ms: number) => void): Promise<autocannon.Result> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(options, (error, result) => (error ? reject(error) : resolve(result)));
    if (onDuration) {
      instance.on("response", (_client: unknown, _status: number, _bytes: number, responseTime: number) =>
        onDuration(responseTime),
      );
    }
  });
}

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "desconocido";
  }
}

function localDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function main(): Promise<number> {
  const settings = parseSettings(process.argv.slice(2));
  refuseRealCredentials();
  refuseOtherEnvironments(SCENARIOS);
  const guard = installFetchGuard();
  await selfTest(guard);

  // Se importan después de las comprobaciones: nada del simulador se evalúa con un .env presente.
  const { buildApp } = await import("../src/app");
  const { CredentialResolver } = await import("../src/auth/CredentialResolver");
  const { KitPagosProvider } = await import("../src/services/KitPagosProvider");
  const { resetSimulatorState } = await import("../src/store/GatewayStores");

  const env: Record<string, string | undefined> = { ...FAKE_ENV };
  const credentialResolver = new CredentialResolver(env);
  const app = buildApp({
    logger: false,
    credentialResolver,
    kitPagosProvider: new KitPagosProvider(credentialResolver, env),
    webhooks: {},
    publicOrigin: null,
    trustForwardedFor: false,
  });
  const base = await app.listen({ port: 0, host: "127.0.0.1" });
  if (new URL(base).hostname !== "127.0.0.1") {
    throw new GuardError(`la app escucha en ${base}, que no es de loopback.`);
  }
  env.SIMULATOR_SDK_BASE_URL = base;

  const date = localDate();
  const commit = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain").length > 0;
  const autocannonVersion = (JSON.parse(
    fs.readFileSync(path.join(SIMULATOR_ROOT, "node_modules", "autocannon", "package.json"), "utf8"),
  ) as { version: string }).version;
  const context = {
    date,
    commit,
    uncommittedChanges: dirty,
    node: process.version,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: `${os.cpus()[0]?.model ?? "desconocido"} (${os.cpus().length} núcleos)`,
    autocannon: autocannonVersion,
    target: base,
    settings: { ...settings, outputDir: path.relative(REPO_ROOT, settings.outputDir) },
  };
  fs.mkdirSync(settings.outputDir, { recursive: true });
  say(`Carga aislada de la API de Simulación, ${date}. Commit ${commit.slice(0, 7)}${dirty ? " con cambios sin commit" : ""}.`);
  say(`Node.js ${context.node}; ${context.os}; ${context.cpu}; autocannon ${autocannonVersion}.`);
  say(`Instancia en ${base}, sin .env, con credenciales ficticias. Perfil: ${settings.warmupSeconds} s de calentamiento y ${settings.measureSeconds} s de medición, conexiones ${CONNECTION_LEVELS.join(" y ")}, ${settings.repetitions} repeticiones.`);

  const records: RunRecord[] = [];
  const written: string[] = [];
  const writeSummary = (valid: boolean, complete: boolean): void => {
    const summary = {
      context,
      guard: { selfTest: "example.invalid bloqueado", blockedDuringLoad: guard.blocked.length, hosts: [...new Set(guard.blocked)] },
      valid,
      complete,
      runs: valid ? records.map(({ autocannon: _ignored, ...rest }) => rest) : [],
    };
    fs.writeFileSync(path.join(settings.outputDir, `${date}-carga-resumen.json`), `${JSON.stringify(summary, null, 2)}\n`);
    fs.writeFileSync(path.join(settings.outputDir, `${date}-carga-consola.txt`), `${consoleLines.join("\n")}\n`);
  };
  // Regla 6 del plan: con un solo bloqueo la corrida es nula y no queda ninguna cifra escrita.
  const nullRun = async (where: string): Promise<number> => {
    await app.close();
    for (const file of written) fs.rmSync(file, { force: true });
    records.length = 0;
    const kept = consoleLines.filter((line) => !/^E\d-c\d+-r\d+\t/.test(line));
    consoleLines.splice(0, consoleLines.length, ...kept);
    say(`CORRIDA NULA en ${where}: el guardián bloqueó ${guard.blocked.length} peticiones (${[...new Set(guard.blocked)].join(", ")}). No se reporta ninguna cifra.`);
    writeSummary(false, false);
    return 1;
  };
  let sequence = 0;
  for (const scenario of SCENARIOS) {
    for (const connections of CONNECTION_LEVELS) {
      for (let repetition = 1; repetition <= settings.repetitions; repetition++) {
        // Cada corrida parte del almacén vacío, para que E5 no acumule los cobros de las anteriores.
        resetSimulatorState();
        let paymentId = "";
        if (scenario.id === "E4") {
          const created = await fetch(`${base}/v1/api/payments`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: payment(`ORD-CARGA-E4-${connections}-${repetition}`),
          });
          const body = (await created.json()) as { transaction?: { gatewayTransactionId?: string } };
          paymentId = body.transaction?.gatewayTransactionId ?? "";
          if (guard.blocked.length > 0) return nullRun(`el cobro previo de E4`);
          if (created.status !== 201 || !paymentId) {
            throw new Error(`E4 no pudo crear su cobro previo: HTTP ${created.status}.`);
          }
        }
        const request: autocannon.Request = {
          method: scenario.method,
          path: scenario.path(paymentId),
          headers: scenario.headers,
          ...(scenario.body
            ? { setupRequest: (req: autocannon.Request) => ({ ...req, body: scenario.body?.((sequence += 1)) }) }
            : {}),
        };
        const options: autocannon.Options = { url: base, connections, pipelining: 1, requests: [request] };

        await run({ ...options, duration: settings.warmupSeconds });
        if (guard.blocked.length > 0) return nullRun(`el calentamiento de ${scenario.id}`);
        const durations: number[] = [];
        const rssBeforeMb = rssMb();
        const loop = monitorEventLoopDelay({ resolution: 10 });
        loop.enable();
        const result = await run({ ...options, duration: settings.measureSeconds }, (ms) => durations.push(ms));
        loop.disable();
        const rssAfterMb = rssMb();
        if (guard.blocked.length > 0) return nullRun(`${scenario.id}, ${connections} conexiones, repetición ${repetition}`);

        const sorted = Float64Array.from(durations).sort();
        const total = result["2xx"] + result.non2xx + result.errors;
        const label = `${scenario.id}-c${connections}-r${repetition}`;
        const record: RunRecord = {
          run: label,
          scenario: `${scenario.id} ${scenario.description}`,
          connections,
          repetition,
          startedAt: new Date(result.start).toISOString(),
          measureSeconds: settings.measureSeconds,
          own: { responses: sorted.length, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), p99Ms: percentile(sorted, 0.99) },
          requestsPerSecond: { average: result.requests.average, stddev: result.requests.stddev },
          bytesPerSecond: result.throughput.average,
          errors: result.errors,
          timeouts: result.timeouts,
          non2xx: result.non2xx,
          total,
          errorRate: total === 0 ? 0 : (result.errors + result.non2xx) / total,
          rssBeforeMb,
          rssAfterMb,
          eventLoopDelayP99Ms: Number((loop.percentile(99) / 1e6).toFixed(3)),
          autocannon: result,
        };
        records.push(record);
        const file = path.join(settings.outputDir, `${date}-carga-${label}.json`);
        fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
        written.push(file);
        say(
          `${label}\t${record.requestsPerSecond.average} pet/s\tp50 ${record.own.p50Ms} ms\tp95 ${record.own.p95Ms} ms\t` +
            `p99 ${record.own.p99Ms} ms\terrores ${record.errors}\tno 2xx ${record.non2xx}\tRSS ${rssBeforeMb}→${rssAfterMb} MB\t` +
            `bucle p99 ${record.eventLoopDelayP99Ms} ms`,
        );
      }
    }
  }
  await app.close();

  const errorFree = records.every((record) => record.errors === 0 && record.non2xx === 0);
  const expectedRuns = SCENARIOS.length * CONNECTION_LEVELS.length * settings.repetitions;
  const complete = errorFree && records.length === expectedRuns;
  say(`Bloqueos del guardián durante la carga: ${guard.blocked.length}. Corridas: ${records.length} de ${expectedRuns}.`);
  say(complete ? "Criterio de completitud cumplido." : "Criterio de completitud NO cumplido: hubo errores o respuestas que no son 2xx.");
  writeSummary(true, complete);
  return complete ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error instanceof GuardError ? `ABORTADO: ${message}` : `ERROR: ${message}`);
    process.exit(1);
  });
