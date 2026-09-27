import Fastify from "fastify";
import { createAuthHook, timingSafeCompare } from "../src/auth/authHook";

describe("authHook", () => {
  describe("timingSafeCompare", () => {
    it("devuelve true para cadenas exactamente iguales", () => {
      expect(timingSafeCompare("secret_token_123", "secret_token_123")).toBe(true);
    });

    it("devuelve false para cadenas de diferente longitud", () => {
      expect(timingSafeCompare("short", "much_longer_token")).toBe(false);
    });

    it("devuelve false para cadenas de igual longitud pero diferente contenido", () => {
      expect(timingSafeCompare("token_12345", "token_99999")).toBe(false);
    });
  });

  describe("Comportamiento en modo abierto (sin API_AUTH_TOKEN)", () => {
    it("permite peticiones sin cabecera Authorization y emite una advertencia en el log", async () => {
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

    it("cae al alias SIMULATOR_API_AUTH_TOKEN si API_AUTH_TOKEN es cadena vacía", async () => {
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

  describe("Comportamiento con token configurado", () => {
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

    it("permite el paso a rutas exentas (/health) sin cabecera de autorización", async () => {
      const app = buildProtectedApp();
      const res = await app.inject({ method: "GET", url: "/health" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
      await app.close();
    });

    it("responde 401 si no se envía la cabecera Authorization en rutas protegidas", async () => {
      const app = buildProtectedApp();
      const res = await app.inject({ method: "GET", url: "/protected" });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Unauthorized");
      expect(res.json().message).toContain("Missing or malformed Authorization header");
      await app.close();
    });

    it("responde 401 si el esquema no es Bearer", async () => {
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

    it("responde 401 si el token es incorrecto", async () => {
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

    it("permite el paso con 200 cuando el token Bearer es correcto", async () => {
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
});
