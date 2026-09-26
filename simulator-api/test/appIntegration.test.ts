import { buildApp } from "../src/app";
import { Gateway } from "kit-pagos-colombia";
import { CredentialResolver } from "../src/auth/CredentialResolver";

describe("Integración general en buildApp()", () => {
  it("decora la instancia de Fastify con credentialResolver y kitPagosProvider", async () => {
    const app = buildApp({ logger: false });

    expect(app.credentialResolver).toBeDefined();
    expect(app.kitPagosProvider).toBeDefined();

    await app.close();
  });

  it("responde 401 si un handler lanza MissingCredentialsError", async () => {
    // Resolver sin credenciales configuradas
    const emptyResolver = new CredentialResolver({});
    const app = buildApp({
      logger: false,
      credentialResolver: emptyResolver,
    });

    app.get<{ Params: { gateway: string } }>(
      "/test-credentials/:gateway",
      async (req) => {
        const gateway = req.params.gateway as Gateway;
        // Esto lanzará MissingCredentialsError
        const creds = app.credentialResolver.resolve(gateway, req.headers);
        return { creds };
      },
    );

    const res = await app.inject({
      method: "GET",
      url: "/test-credentials/wompi",
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toContain("Missing credentials for gateway 'wompi'");

    await app.close();
  });

  it("permite el acceso sin token a /health y a rutas mock /v1/sim/* aun con auth activa", async () => {
    const app = buildApp({
      logger: false,
      authOptions: {
        expectedToken: "my_auth_token_999",
      },
    });

    // Registrar la ruta de prueba ANTES de que app.inject() inicialice la app
    app.get("/v1/payments", async () => ({ ok: true }));

    // 1. /health es pública
    const healthRes = await app.inject({ method: "GET", url: "/health" });
    expect(healthRes.statusCode).toBe(200);

    // 2. /v1/sim/wompi/... es pública (mock de pasarela llamado por el SDK)
    const wompiRes = await app.inject({
      method: "GET",
      url: "/v1/sim/wompi/merchants/pub_test_xyz",
    });
    expect(wompiRes.statusCode).toBe(200);

    // 3. Una ruta protegida sin token responde 401
    const protectedRes = await app.inject({
      method: "GET",
      url: "/v1/payments",
    });
    expect(protectedRes.statusCode).toBe(401);

    // 4. Con el token correcto responde 200
    const authedRes = await app.inject({
      method: "GET",
      url: "/v1/payments",
      headers: { authorization: "Bearer my_auth_token_999" },
    });
    expect(authedRes.statusCode).toBe(200);
    expect(authedRes.json()).toEqual({ ok: true });

    await app.close();
  });
});
