import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfigFrom, createStaticServer } from "../server.mjs";

describe("clientConfigFrom", () => {
  it("defaults to the local simulator and carries no public key", () => {
    expect(clientConfigFrom({})).toEqual({
      apiBaseUrl: "http://localhost:3000/v1/api",
      tokenizationEnvironment: "simulator",
      publicKeys: {},
    });
  });

  it("maps each CHECKOUT_PUBLIC_KEY_<GATEWAY> to the lowercase gateway value", () => {
    const config = clientConfigFrom({
      KIT_PAGOS_API_URL: "https://api.example.com/v1/api",
      TOKENIZATION_ENVIRONMENT: "sandbox",
      CHECKOUT_PUBLIC_KEY_SOMEGATEWAY: "pub_1",
      CHECKOUT_PUBLIC_KEY_EMPTY: "",
      UNRELATED: "x",
    });

    expect(config).toEqual({
      apiBaseUrl: "https://api.example.com/v1/api",
      tokenizationEnvironment: "sandbox",
      publicKeys: { somegateway: "pub_1" },
    });
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
    server = createStaticServer({ root, env: { CHECKOUT_PUBLIC_KEY_G: "pub" } });
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

  it("serves the runtime config from the environment", async () => {
    const response = await fetch(`${base}/config.json`);

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ publicKeys: { g: "pub" } });
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
