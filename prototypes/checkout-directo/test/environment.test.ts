import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RENDER_SIMULATOR_URL, paymentsEnvironment } from "../src/checkout/environment";
import { ROOT_ENV_FILE, applyArguments, loadRootEnv } from "../src/config";

describe("paymentsEnvironment", () => {
  it("should default to the gateway's official sandbox, with Render's simulator as the simulator", () => {
    expect(paymentsEnvironment({})).toEqual({ environment: "sandbox", simulatorUrl: RENDER_SIMULATOR_URL });
  });

  it("should take the simulator and its URL, without a trailing slash", () => {
    expect(
      paymentsEnvironment({ CHECKOUT_ENVIRONMENT: "simulator", CHECKOUT_SIMULATOR_URL: "http://localhost:3000/" }),
    ).toEqual({ environment: "simulator", simulatorUrl: "http://localhost:3000" });
  });

  it("should refuse an environment it does not know", () => {
    expect(() => paymentsEnvironment({ CHECKOUT_ENVIRONMENT: "production" })).toThrow(/sandbox o simulator/);
  });
});

describe("applyArguments", () => {
  it("should turn the command line options into their environment variables", () => {
    const env: NodeJS.ProcessEnv = { CHECKOUT_ENVIRONMENT: "sandbox" };

    applyArguments(["--environment=simulator", "--simulator-url=http://localhost:3000", "--port=4100"], env);

    expect(env).toEqual({
      CHECKOUT_ENVIRONMENT: "simulator",
      CHECKOUT_SIMULATOR_URL: "http://localhost:3000",
      PORT: "4100",
    });
  });

  it.each([["--environment"], ["--sandbox"], ["simulator"]])("should refuse «%s»", (arg) => {
    expect(() => applyArguments([arg], {})).toThrow(/Opción desconocida/);
  });
});

describe("loadRootEnv", () => {
  const envFile = (content: string): string => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "checkout-env-")), ".env");
    writeFileSync(file, content);
    return file;
  };

  it("should point at the .env of the repository root", () => {
    expect(ROOT_ENV_FILE).toBe(path.resolve(__dirname, "..", "..", "..", ".env"));
  });

  it("should add the file's variables, letting the environment win and skipping empty lines and comments", () => {
    const env: NodeJS.ProcessEnv = { ALREADY_SET: "from the shell" };
    const file = envFile("# comment\nNEW_KEY= value \nALREADY_SET=from the file\nEMPTY_KEY=\nnot a variable\n");

    expect(loadRootEnv(file, env)).toBe(true);
    expect(env).toEqual({ ALREADY_SET: "from the shell", NEW_KEY: "value" });
  });

  it("should say so when there is no file, and change nothing", () => {
    const env: NodeJS.ProcessEnv = {};

    expect(loadRootEnv(path.join(tmpdir(), "no-such-dir-checkout", ".env"), env)).toBe(false);
    expect(env).toEqual({});
  });
});
