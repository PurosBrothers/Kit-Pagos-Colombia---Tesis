import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_API_URL as CLIENT_DEFAULT_API_URL } from "../src/config";
import {
  DEFAULT_API_URL,
  DEFAULT_ENV_FILE,
  clientConfigFrom,
  createStaticServer,
  parseArguments,
  prepareServer,
  publicKeysFromEnvFile,
  readEnvFile,
  resolvePublicKeys,
  startupSummary,
} from "../server.mjs";
import { GATEWAYS } from "./helpers/fakeApi";

describe("clientConfigFrom", () => {
  it("defaults to the official sandboxes through the deployed API and carries no public key", () => {
    expect(clientConfigFrom({})).toEqual({
      apiBaseUrl: "https://kit-pagos-colombia.onrender.com/v1/api",
      environment: "sandbox",
      publicKeys: {},
    });
  });

  it("uses the same default API as the client, so the page and the server never disagree", () => {
    expect(DEFAULT_API_URL).toBe(CLIENT_DEFAULT_API_URL);
  });

  it("maps each CHECKOUT_PUBLIC_KEY_<GATEWAY> to the lowercase gateway value", () => {
    const config = clientConfigFrom({
      KIT_PAGOS_API_URL: "https://api.example.com/v1/api",
      KIT_PAGOS_ENVIRONMENT: "sandbox",
      CHECKOUT_PUBLIC_KEY_SOMEGATEWAY: "pub_1",
      CHECKOUT_PUBLIC_KEY_EMPTY: "",
      UNRELATED: "x",
    });

    expect(config).toEqual({
      apiBaseUrl: "https://api.example.com/v1/api",
      environment: "sandbox",
      publicKeys: { somegateway: "pub_1" },
    });
  });

  it("lets an argument win over its environment variable, and adds keys to the ones in the environment", () => {
    const config = clientConfigFrom(
      {
        KIT_PAGOS_API_URL: "https://desde-el-entorno.example.com/v1/api",
        KIT_PAGOS_ENVIRONMENT: "simulator",
        CHECKOUT_PUBLIC_KEY_A: "pub_entorno_a",
        CHECKOUT_PUBLIC_KEY_B: "pub_entorno_b",
      },
      { apiUrl: "http://localhost:3000/v1/api", environment: "sandbox", publicKeys: { b: "pub_argumento_b" } },
    );

    expect(config).toEqual({
      apiBaseUrl: "http://localhost:3000/v1/api",
      environment: "sandbox",
      publicKeys: { a: "pub_entorno_a", b: "pub_argumento_b" },
    });
  });

  it("treats an empty variable as unset, which is what `set VARIABLE=` leaves behind", () => {
    expect(clientConfigFrom({ KIT_PAGOS_API_URL: "", KIT_PAGOS_ENVIRONMENT: "" })).toMatchObject({
      apiBaseUrl: DEFAULT_API_URL,
      environment: "sandbox",
    });
  });

  it("refuses an environment that is not simulator or sandbox, production included", () => {
    expect(() => clientConfigFrom({ KIT_PAGOS_ENVIRONMENT: "production" })).toThrow(
      "Ambiente «production» no válido: use simulator o sandbox.",
    );
    expect(() => clientConfigFrom({}, { environment: "prod" })).toThrow("no válido");
  });

  it("refuses an API URL that is not an http(s) URL", () => {
    expect(() => clientConfigFrom({ KIT_PAGOS_API_URL: "no es una url" })).toThrow("no es válida");
    expect(() => clientConfigFrom({ KIT_PAGOS_API_URL: "ftp://example.com/v1/api" })).toThrow("http:// o https://");
  });

  it("adds the public keys of the .env file under the ones from the environment and the arguments", () => {
    const config = clientConfigFrom(
      { CHECKOUT_PUBLIC_KEY_B: "pub_variable_b" },
      { publicKeys: { c: "pub_argumento_c" } },
      { a: "pub_archivo_a", b: "pub_archivo_b", c: "pub_archivo_c" },
    );

    expect(config.publicKeys).toEqual({ a: "pub_archivo_a", b: "pub_variable_b", c: "pub_argumento_c" });
  });
});

describe("resolvePublicKeys", () => {
  it("for each gateway, the argument wins over CHECKOUT_PUBLIC_KEY_<GATEWAY>, and that variable over the .env file", () => {
    const resolved = resolvePublicKeys(
      { CHECKOUT_PUBLIC_KEY_B: "pub_variable_b", CHECKOUT_PUBLIC_KEY_C: "pub_variable_c" },
      { publicKeys: { c: "pub_argumento_c" } },
      { a: "pub_archivo_a", b: "pub_archivo_b", c: "pub_archivo_c" },
    );

    expect(resolved).toEqual({
      a: { key: "pub_archivo_a", source: "archivo" },
      b: { key: "pub_variable_b", source: "variable" },
      c: { key: "pub_argumento_c", source: "argumento" },
    });
  });
});

describe("publicKeysFromEnvFile", () => {
  it("takes each <GATEWAY>_PUBLIC_KEY under the lowercase gateway, and nothing else of the file", () => {
    const content = [
      "ALFA_PRIVATE_KEY=prv_secreto",
      "ALFA_PUBLIC_KEY=pub_alfa",
      "ALFA_INTEGRITY_SECRET=secreto_integridad",
      "GAMMA_PRIVATE_KEY=prv_sin_publica",
      "BETA2_PUBLIC_KEY = pub_beta ",
      "BETA2_ACCESS_TOKEN=token_secreto",
      "DOS_PALABRAS_PUBLIC_KEY=con_guion_bajo",
      "GAMMA_PUBLIC_KEY_ID=con_sufijo",
      "delta_public_key=en_minusculas",
      "API_AUTH_TOKEN=token_de_la_api",
    ].join("\n");

    expect(publicKeysFromEnvFile(content)).toEqual({ alfa: "pub_alfa", beta2: "pub_beta" });
  });

  it("parses like the repository's other readers: first `=`, comments, blank lines and CRLF, quotes kept", () => {
    const content = [
      "# ALFA_PUBLIC_KEY=pub_comentada",
      "   ",
      "ALFA_PUBLIC_KEY=pub=con=iguales",
      'BETA_PUBLIC_KEY="pub_entre_comillas"',
      "GAMMA_PUBLIC_KEY",
      "",
    ].join("\r\n");

    expect(publicKeysFromEnvFile(content)).toEqual({ alfa: "pub=con=iguales", beta: '"pub_entre_comillas"' });
  });

  it("keeps the first value of a repeated name, like the API, and treats an empty value as unset", () => {
    const content = [
      "ALFA_PUBLIC_KEY=pub_primera",
      "ALFA_PUBLIC_KEY=pub_segunda",
      "BETA_PUBLIC_KEY=",
      "BETA_PUBLIC_KEY=pub_beta_segunda",
    ].join("\n");

    expect(publicKeysFromEnvFile(content)).toEqual({ alfa: "pub_primera" });
  });

  it("reads from the repository's .env template exactly its three public keys, under gateway ids the API uses", () => {
    const template = readFileSync(join(__dirname, "..", "..", "..", ".env.example"), "utf8");
    const names = template
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => line.slice(0, line.indexOf("=")).trim());
    const fakeFile = names.map((name) => `${name}=valor_falso_de_${name}`).join("\n");

    const read = publicKeysFromEnvFile(fakeFile);

    expect(names.length).toBeGreaterThan(20);
    expect(Object.keys(read).sort()).toEqual(["kushki", "mercadopago", "wompi"]);
    expect(read).toEqual({
      kushki: "valor_falso_de_KUSHKI_PUBLIC_KEY",
      mercadopago: "valor_falso_de_MERCADOPAGO_PUBLIC_KEY",
      wompi: "valor_falso_de_WOMPI_PUBLIC_KEY",
    });
    expect(GATEWAYS).toEqual(expect.arrayContaining(Object.keys(read)));
  });
});

describe("readEnvFile", () => {
  let dir: string;
  let first: string;
  let second: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "checkout-c-env-"));
    first = join(dir, "primero.env");
    second = join(dir, "segundo.env");
    writeFileSync(first, "ALFA_PUBLIC_KEY=pub_primero\nALFA_PRIVATE_KEY=prv_secreto\n");
    writeFileSync(second, "ALFA_PUBLIC_KEY=pub_segundo\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to the repository root's .env, two folders above the prototype", () => {
    expect(DEFAULT_ENV_FILE).toBe(join(__dirname, "..", "..", "..", ".env"));
  });

  it("reads the default file when nothing else is given", () => {
    expect(readEnvFile({}, {}, first)).toEqual({ path: first, found: true, publicKeys: { alfa: "pub_primero" } });
  });

  it("starts without keys when the default file does not exist", () => {
    const missing = join(dir, "no-existe.env");

    expect(readEnvFile({}, {}, missing)).toEqual({ path: missing, found: false, publicKeys: {} });
  });

  it("lets --dotenv win over KIT_PAGOS_DOTENV, and that variable over the default", () => {
    expect(readEnvFile({ KIT_PAGOS_DOTENV: first }, { dotenv: second }, first).publicKeys).toEqual({ alfa: "pub_segundo" });
    expect(readEnvFile({ KIT_PAGOS_DOTENV: second }, {}, first).publicKeys).toEqual({ alfa: "pub_segundo" });
    expect(readEnvFile({ KIT_PAGOS_DOTENV: "" }, {}, first).publicKeys).toEqual({ alfa: "pub_primero" });
  });

  it("fails, naming the absolute path and the option, when a requested file does not exist", () => {
    const missing = join(dir, "pedido.env");

    expect(() => readEnvFile({}, { dotenv: missing }, first)).toThrow(`El archivo «${missing}» de --dotenv no existe.`);
    expect(() => readEnvFile({ KIT_PAGOS_DOTENV: missing }, {}, first)).toThrow(
      `El archivo «${missing}» de KIT_PAGOS_DOTENV no existe.`,
    );
  });
});

describe("parseArguments", () => {
  it("reads --option=value and --option value", () => {
    expect(
      parseArguments(["--api-url=https://api.example.com/v1/api", "--environment", "sandbox", "--port=4200"]),
    ).toEqual({ apiUrl: "https://api.example.com/v1/api", environment: "sandbox", port: 4200, publicKeys: {} });
    expect(parseArguments(["--dotenv=/una/ruta/.env"]).dotenv).toBe("/una/ruta/.env");
    expect(parseArguments(["--dotenv", "relativa.env"]).dotenv).toBe("relativa.env");
  });

  it("collects one public key per gateway, lowercases the gateway and keeps colons in the key", () => {
    expect(parseArguments(["--public-key=GatewayA:pub_a", "--public-key", "gatewayb:pub:with:colons"]).publicKeys).toEqual({
      gatewaya: "pub_a",
      gatewayb: "pub:with:colons",
    });
  });

  it("recognizes --help and -h", () => {
    expect(parseArguments(["--help"]).help).toBe(true);
    expect(parseArguments(["-h"]).help).toBe(true);
  });

  it("fails on what it does not recognize instead of ignoring it", () => {
    expect(() => parseArguments(["--enviroment=sandbox"])).toThrow("Argumento desconocido: --enviroment=sandbox");
    expect(() => parseArguments(["sandbox"])).toThrow("Argumento desconocido");
  });

  it("fails when an option has no value", () => {
    expect(() => parseArguments(["--environment"])).toThrow("Falta el valor de --environment.");
    expect(() => parseArguments(["--api-url", "--port=1"])).toThrow("Falta el valor de --api-url.");
    expect(() => parseArguments(["--api-url="])).toThrow("Falta el valor de --api-url.");
  });

  it("fails on a port that is not a port", () => {
    for (const port of ["abc", "0", "70000", "4100.5"]) {
      expect(() => parseArguments([`--port=${port}`]), port).toThrow("no es válido");
    }
  });

  it("fails on a public key that is not <gateway>:<key>", () => {
    for (const value of ["sinseparador", ":solo_llave", "pasarela:", "pasarela:  "]) {
      expect(() => parseArguments([`--public-key=${value}`]), value).toThrow("<pasarela>:<llave>");
    }
  });
});

describe("prepareServer", () => {
  let root: string;
  let noEnvFile: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "checkout-c-prepare-"));
    noEnvFile = join(root, "no-existe.env");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("answers --help with the usage and does not need the build", () => {
    const prepared = prepareServer(["--help"], {}, join(root, "no-existe"), noEnvFile);

    expect(prepared).toMatchObject({ help: expect.stringContaining("--environment=<ambiente>") });
    expect(prepared).toMatchObject({ help: expect.stringContaining("--dotenv=<ruta>") });
  });

  it("tells the user to build first when dist has no index.html", () => {
    expect(() => prepareServer([], {}, root, noEnvFile)).toThrow("npm run build");
  });

  it("reports an invalid option, or a requested .env that does not exist, before it reports the missing build", () => {
    expect(() => prepareServer(["--environment=production"], {}, root, noEnvFile)).toThrow("no válido");
    expect(() => prepareServer([`--dotenv=${noEnvFile}`], {}, root, noEnvFile)).toThrow("de --dotenv no existe");
  });

  it("builds the server with the config from the arguments and the port from the argument, the variable or 4100", () => {
    writeFileSync(join(root, "index.html"), "<!doctype html>");

    const fromArgument = prepareServer(["--environment=simulator", "--port=4300"], { PORT: "4200" }, root, noEnvFile);
    const fromVariable = prepareServer([], { PORT: "4200" }, root, noEnvFile);
    const byDefault = prepareServer([], {}, root, noEnvFile);

    expect(fromArgument).toMatchObject({ port: 4300, config: { environment: "simulator" } });
    expect(fromVariable).toMatchObject({ port: 4200, config: { environment: "sandbox", apiBaseUrl: DEFAULT_API_URL } });
    expect(byDefault).toMatchObject({ port: 4100, envFile: { path: noEnvFile, found: false }, sources: {} });
  });

  it("says where each public key came from and never prints a key", () => {
    writeFileSync(join(root, "index.html"), "<!doctype html>");
    const envFile = join(root, "fuentes.env");
    writeFileSync(envFile, "ALFA_PUBLIC_KEY=pub_valor_alfa\nBETA_PUBLIC_KEY=pub_valor_beta_archivo\n");

    const prepared = prepareServer(
      ["--public-key=beta:pub_valor_beta_argumento", "--port=4111"],
      { CHECKOUT_PUBLIC_KEY_GAMMA: "pub_valor_gamma" },
      root,
      envFile,
    );
    if ("help" in prepared) throw new Error("no se esperaba la ayuda");
    const summary = startupSummary(prepared);

    expect(prepared.sources).toEqual({ alfa: "archivo", beta: "argumento", gamma: "variable" });
    expect(summary).toContain("Prototipo C en http://localhost:4111");
    expect(summary).toContain("Llaves públicas para tarjeta: alfa (archivo), beta (argumento), gamma (variable)");
    expect(summary).toContain(`Archivo .env: ${envFile}`);
    expect(summary).not.toContain("no se leyó");
    expect(summary).not.toMatch(/pub_valor/);
  });

  it("says when the default .env was not there, and that there is no key", () => {
    writeFileSync(join(root, "index.html"), "<!doctype html>");
    const prepared = prepareServer([], {}, root, noEnvFile);
    if ("help" in prepared) throw new Error("no se esperaba la ayuda");

    expect(startupSummary(prepared)).toContain("Llaves públicas para tarjeta: ninguna; la tarjeta queda deshabilitada");
    expect(startupSummary(prepared)).toContain("--dotenv=<ruta>");
    expect(startupSummary(prepared)).toContain(`Archivo .env: ${noEnvFile} (no existe; no se leyó)`);
  });

  it("points to the tunnel only when it charges in the sandbox", () => {
    writeFileSync(join(root, "index.html"), "<!doctype html>");
    const sandbox = prepareServer([], {}, root, noEnvFile);
    const simulator = prepareServer(["--environment=simulator"], {}, root, noEnvFile);
    if ("help" in sandbox || "help" in simulator) throw new Error("no se esperaba la ayuda");

    expect(startupSummary(sandbox)).toContain("sirva la página por un túnel");
    expect(startupSummary(simulator)).not.toContain("túnel");
  });

  it("serves in /config.json only the public keys of a .env that also holds private secrets", async () => {
    writeFileSync(join(root, "index.html"), "<!doctype html>");
    const envFile = join(root, "completo.env");
    writeFileSync(
      envFile,
      [
        "WOMPI_PUBLIC_KEY=pub_test_falsa_kp109",
        "WOMPI_PRIVATE_KEY=SECRETO_FALSO_1",
        "WOMPI_INTEGRITY_SECRET=SECRETO_FALSO_2",
        "WOMPI_EVENTS_SECRET=SECRETO_FALSO_3",
        "MERCADOPAGO_PUBLIC_KEY=TEST-falsa-kp109",
        "MERCADOPAGO_ACCESS_TOKEN=SECRETO_FALSO_4",
        "KUSHKI_PUBLIC_MERCHANT_ID=SECRETO_FALSO_5",
        "KUSHKI_PRIVATE_MERCHANT_ID=SECRETO_FALSO_6",
        "RAPYD_API_SECRET_KEY=SECRETO_FALSO_7",
        "API_AUTH_TOKEN=SECRETO_FALSO_8",
      ].join("\n"),
    );
    const prepared = prepareServer(["--environment=sandbox"], {}, root, envFile);
    if ("help" in prepared) throw new Error("no se esperaba la ayuda");
    await new Promise<void>((resolve) => prepared.server.listen(0, "127.0.0.1", resolve));

    try {
      const { port } = prepared.server.address() as AddressInfo;
      const body = await (await fetch(`http://127.0.0.1:${port}/config.json`)).text();

      expect(JSON.parse(body)).toEqual({
        apiBaseUrl: DEFAULT_API_URL,
        environment: "sandbox",
        publicKeys: { wompi: "pub_test_falsa_kp109", mercadopago: "TEST-falsa-kp109" },
      });
      expect(body).not.toContain("SECRETO_FALSO");
    } finally {
      await new Promise((resolve) => prepared.server.close(resolve));
    }
  });
});

describe("npm start (the command line itself)", () => {
  const SERVER = join(__dirname, "..", "server.mjs");
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SERVER, ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });

  it("prints the usage and exits 0 with --help", () => {
    const result = run("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--environment=<ambiente>");
    expect(result.stdout).toContain("KIT_PAGOS_API_URL");
    expect(result.stdout).toContain("--dotenv=<ruta>");
    expect(result.stdout).toContain("KIT_PAGOS_DOTENV");
  });

  it("`node server.mjs --dotenv=<missing>` exits 1 with the server's own message, not one from Node", () => {
    const missing = join(tmpdir(), "checkout-c-no-existe", ".env");
    const result = run(`--dotenv=${missing}`);

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(`El archivo «${missing}» de --dotenv no existe.`);
    expect(result.stdout).toBe("");
  });

  it("exits 1 with a message, and does not start, on an environment that does not exist", () => {
    const result = run("--environment=production");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Ambiente «production» no válido");
    expect(result.stdout).toBe("");
  });

  it("exits 1 on an option it does not know, instead of starting against the default API", () => {
    const result = run("--api=https://example.com/v1/api");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Argumento desconocido: --api=https://example.com/v1/api");
  });
});

describe("createStaticServer", () => {
  let root: string;
  let base: string;
  let server: ReturnType<typeof createStaticServer>;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "checkout-c-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>C</title>");
    writeFileSync(join(root, "assets", "app.js"), "export {};");
    writeFileSync(join(root, "assets", "data.bin"), "x");
    writeFileSync(join(root, "..", "checkout-c-secret.txt"), "fuera de la raíz");
    server = createStaticServer({
      root,
      env: { CHECKOUT_PUBLIC_KEY_G: "pub" },
      options: { environment: "sandbox" },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
    rmSync(join(root, "..", "checkout-c-secret.txt"), { force: true });
  });

  it("serves index.html at the root and the assets with their type", async () => {
    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await index.text()).toContain("<title>C</title>");

    const script = await fetch(`${base}/assets/app.js`);
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");

    const unknown = await fetch(`${base}/assets/data.bin`);
    expect(unknown.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("serves the runtime config from the arguments and the environment", async () => {
    const response = await fetch(`${base}/config.json`);

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      apiBaseUrl: DEFAULT_API_URL,
      environment: "sandbox",
      publicKeys: { g: "pub" },
    });
  });

  it("does not serve files outside the build", async () => {
    for (const path of ["/../checkout-c-secret.txt", "/%2e%2e/checkout-c-secret.txt", "/missing.js"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, path).toBe(404);
    }
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
  });

  it("answers only GET and HEAD", async () => {
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
    const head = await fetch(`${base}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});
