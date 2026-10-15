import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_API_URL as CLIENT_DEFAULT_API_URL } from "../src/config";
import {
  DEFAULT_API_URL,
  clientConfigFrom,
  createStaticServer,
  parseArguments,
  prepareServer,
} from "../server.mjs";

describe("clientConfigFrom", () => {
  it("defaults to the deployed simulator and carries no public key", () => {
    expect(clientConfigFrom({})).toEqual({
      apiBaseUrl: "https://kit-pagos-colombia.onrender.com/v1/api",
      environment: "simulator",
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
      environment: "simulator",
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
});

describe("parseArguments", () => {
  it("reads --option=value and --option value", () => {
    expect(
      parseArguments(["--api-url=https://api.example.com/v1/api", "--environment", "sandbox", "--port=4200"]),
    ).toEqual({ apiUrl: "https://api.example.com/v1/api", environment: "sandbox", port: 4200, publicKeys: {} });
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

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "checkout-c-prepare-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("answers --help with the usage and does not need the build", () => {
    const prepared = prepareServer(["--help"], {}, join(root, "no-existe"));

    expect(prepared).toMatchObject({ help: expect.stringContaining("--environment=<ambiente>") });
  });

  it("tells the user to build first when dist has no index.html", () => {
    expect(() => prepareServer([], {}, root)).toThrow("npm run build");
  });

  it("reports an invalid option before it reports the missing build", () => {
    expect(() => prepareServer(["--environment=production"], {}, root)).toThrow("no válido");
  });

  it("builds the server with the config from the arguments and the port from the argument, the variable or 4100", () => {
    writeFileSync(join(root, "index.html"), "<!doctype html>");

    const fromArgument = prepareServer(["--environment=sandbox", "--port=4300"], { PORT: "4200" }, root);
    const fromVariable = prepareServer([], { PORT: "4200" }, root);
    const byDefault = prepareServer([], {}, root);

    expect(fromArgument).toMatchObject({ port: 4300, config: { environment: "sandbox" } });
    expect(fromVariable).toMatchObject({ port: 4200, config: { environment: "simulator", apiBaseUrl: DEFAULT_API_URL } });
    expect(byDefault).toMatchObject({ port: 4100 });
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
