import Fastify from "fastify";
import { createAuthHook, timingSafeCompare } from "../src/auth/authHook";

describe("authHook", () => {
  describe("timingSafeCompare", () => {
    it("returns true for exactly equal strings", () => {
      expect(timingSafeCompare("secret_token_123", "secret_token_123")).toBe(true);
    });

    it("returns false for strings of different length", () => {
      expect(timingSafeCompare("short", "much_longer_token")).toBe(false);
    });

    it("returns false for strings of equal length but different content", () => {
      expect(timingSafeCompare("token_12345", "token_99999")).toBe(false);
    });
  });

  describe("Behavior in open mode (without API_AUTH_TOKEN)", () => {
    it("allows requests without an Authorization header and logs a warning", async () => {
      const warnSpy = jest.fn();
      const app = Fastify();

      app.addHook(
        "onRequest",
        createAuthHook({
          expectedToken: undefined,
          logger: { warn: warnSpy },
        }),
      );

      app.get("/test", async () => ({ ok: true }));

      const res = await app.inject({ method: "GET", url: "/test" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("API_AUTH_TOKEN no está definido"),
      );

      await app.close();
    });

    it("falls back to the SIMULATOR_API_AUTH_TOKEN alias if API_AUTH_TOKEN is an empty string", async () => {
      const originalEnv = { ...process.env };
      process.env.API_AUTH_TOKEN = "   ";
      process.env.SIMULATOR_API_AUTH_TOKEN = "fallback_secret_token";

      try {
        const app = Fastify();
        app.addHook("onRequest", createAuthHook());
        app.get("/alias-test", async () => ({ ok: true }));

        // Sin token debe responder 401 porque fallback_secret_token fue reconocido
        const resUnauthorized = await app.inject({ method: "GET", url: "/alias-test" });
        expect(resUnauthorized.statusCode).toBe(401);

        // Con el token de fallback debe responder 200
        const resAuthorized = await app.inject({
          method: "GET",
          url: "/alias-test",
          headers: { authorization: "Bearer fallback_secret_token" },
        });
        expect(resAuthorized.statusCode).toBe(200);

        await app.close();
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe("Behavior with a configured token", () => {
    const SECRET = "super_secure_api_token_123";

    function buildProtectedApp() {
      const app = Fastify();
      app.addHook(
        "onRequest",
        createAuthHook({
          expectedToken: SECRET,
          exemptPaths: ["/health"],
        }),
      );
      app.get("/health", async () => ({ status: "ok" }));
      app.get("/protected", async () => ({ secretData: 42 }));
      return app;
    }

    it("lets exempt routes (/health) through without an authorization header", async () => {
      const app = buildProtectedApp();
      const res = await app.inject({ method: "GET", url: "/health" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
      await app.close();
    });

    it("answers 401 if the Authorization header is not sent on protected routes", async () => {
      const app = buildProtectedApp();
      const res = await app.inject({ method: "GET", url: "/protected" });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Unauthorized");
      expect(res.json().message).toContain("Missing or malformed Authorization header");
      await app.close();
    });

    it("answers 401 if the scheme is not Bearer", async () => {
      const app = buildProtectedApp();
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Basic ${SECRET}` },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toContain("Expected 'Bearer <token>'");
      await app.close();
    });

    it("answers 401 if the token is wrong", async () => {
      const app = buildProtectedApp();
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: "Bearer invalid_token_xyz" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toContain("Invalid authorization token");
      await app.close();
    });

    it("lets the request through with 200 when the Bearer token is correct", async () => {
      const app = buildProtectedApp();
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${SECRET}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ secretData: 42 });
      await app.close();
    });
  });

  describe("Protected routes inside an exempt prefix", () => {
    const SECRET = "super_secure_api_token_123";

    function buildApp() {
      const app = Fastify();
      app.addHook("onRequest", createAuthHook({ expectedToken: SECRET }));
      app.get("/v1/sim/open", async () => ({ ok: true }));
      app.get("/v1/sim/webhooks/:id", async () => ({ ok: true }));
      return app;
    }

    it("decides on the registered route: /v1/sim stays exempt and /v1/sim/webhooks requires the token", async () => {
      const app = buildApp();

      expect((await app.inject({ method: "GET", url: "/v1/sim/open" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/v1/sim/webhooks/abc" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/v1/sim/%77ebhooks/abc" })).statusCode).toBe(401);
      await app.close();
    });

    it("without a matched route it normalizes the URL: upper case, double slashes and the trailing one do not exempt it", async () => {
      const app = buildApp();

      expect((await app.inject({ method: "GET", url: "/V1/SIM//WEBHOOKS/x/y/" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/v1/sim/nada" })).statusCode).toBe(404);
      // Una secuencia `%` inválida no rompe el hook; Fastify la rechaza o no la encuentra.
      expect([400, 404]).toContain((await app.inject({ method: "GET", url: "/v1/sim/%E0%A4%A" })).statusCode);
      await app.close();
    });

    it("accepts its own list of protected routes", async () => {
      const app = Fastify();
      app.addHook(
        "onRequest",
        createAuthHook({ expectedToken: SECRET, exemptPaths: ["/v1/sim"], protectedPaths: ["/v1/sim/open"] }),
      );
      app.get("/v1/sim/open", async () => ({ ok: true }));

      expect((await app.inject({ method: "GET", url: "/v1/sim/open" })).statusCode).toBe(401);
      await app.close();
    });
  });
});
