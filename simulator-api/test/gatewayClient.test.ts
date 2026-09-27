import { FastifyInstance } from "fastify";
import { Gateway, KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { kitPagosApi } from "../src/kit-pagos-api";
import { gatewayClientFor, logCredentialPolicy } from "../src/kit-pagos-api/gateway-client";
import { KitPagosProvider } from "../src/services/KitPagosProvider";

/**
 * La regla de credenciales vista desde HTTP (puntos 69 y 70).
 *
 * Todavía no hay una ruta de `/v1/api` que llame a la pasarela —llegan con los issues
 * #102 y #103—, así que la prueba monta dos que usan `gatewayClientFor()` como la usarán
 * ellas, dentro de un contexto armado por el mismo `kitPagosApi()`: así cubre también
 * el cableado del hook y de CORS.
 */
function appPointingTo(baseUrl: string): FastifyInstance {
  const env = {
    WOMPI_PUBLIC_KEY: "pub_prod_del_operador",
    WOMPI_PRIVATE_KEY: "prv_prod_del_operador",
    WOMPI_BASE_URL: baseUrl,
  };
  const credentialResolver = new CredentialResolver(env);
  const app = buildApp({
    credentialResolver,
    kitPagosProvider: new KitPagosProvider(credentialResolver, env),
    authOptions: { expectedToken: "token-de-prueba" },
  });

  app.register(
    async (scope) => {
      await kitPagosApi(scope);
      scope.get("/client", async (request, reply) => {
        gatewayClientFor(scope, request, reply, Gateway.WOMPI);
        return { ok: true };
      });
      scope.get("/client-then-gateway-error", async (request, reply) => {
        gatewayClientFor(scope, request, reply, Gateway.WOMPI);
        throw new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.WOMPI, null, "rejected");
      });
    },
    { prefix: "/v1/api/test-only" },
  );
  return app;
}

const AUTH = { authorization: "Bearer token-de-prueba" };

describe("gatewayClientFor over HTTP", () => {
  it("should answer 401 with the reason when production is called without own credentials", async () => {
    const app = appPointingTo("https://production.wompi.co/v1");

    const response = await app.inject({
      method: "GET",
      url: "/v1/api/test-only/client",
      headers: AUTH,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: string; message: string };
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toContain("la trata como producción");
    expect(body.message).toContain("Falta: x-gateway-public-key, x-gateway-private-key");
    // El mensaje explica la regla, pero no filtra nada de la configuración del servidor.
    expect(body.message).not.toContain("production.wompi.co");
    expect(body.message).not.toContain("del_operador");
    await app.close();
  });

  it("should serve a sandbox request with the server credentials and the warning header", async () => {
    const app = appPointingTo("https://sandbox.wompi.co/v1");

    const response = await app.inject({
      method: "GET",
      url: "/v1/api/test-only/client",
      headers: AUTH,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-kit-pagos-warning"]).toContain(
      "Para pruebas futuras se recomienda utilizar las credenciales propias",
    );
    await app.close();
  });

  it("should also put the warning in the JSON body, next to the route's own fields", async () => {
    const app = appPointingTo("https://sandbox.wompi.co/v1");

    const response = await app.inject({
      method: "GET",
      url: "/v1/api/test-only/client",
      headers: { ...AUTH, "x-gateway-public-key": "pub_test_cliente" },
    });

    expect(response.json()).toEqual({
      ok: true,
      warnings: [
        {
          code: "SERVER_SANDBOX_CREDENTIALS_USED",
          message: expect.stringContaining("porque falta: x-gateway-private-key"),
        },
      ],
    });
    await app.close();
  });

  it("should keep the warning in the body when the gateway call fails", async () => {
    const app = appPointingTo("https://sandbox.wompi.co/v1");

    const response = await app.inject({
      method: "GET",
      url: "/v1/api/test-only/client-then-gateway-error",
      headers: AUTH,
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json().warnings).toEqual([
      expect.objectContaining({ code: "SERVER_SANDBOX_CREDENTIALS_USED" }),
    ]);
    await app.close();
  });

  it("should not add warnings to the body against the local simulator", async () => {
    const app = appPointingTo("http://localhost:3000/v1/sim/wompi");

    const response = await app.inject({
      method: "GET",
      url: "/v1/api/test-only/client",
      headers: AUTH,
    });

    expect(response.json()).toEqual({ ok: true });
    expect(response.headers["x-kit-pagos-warning"]).toBeUndefined();
    await app.close();
  });

  it("should not send the warning header when the client brings its own credentials", async () => {
    const app = appPointingTo("https://sandbox.wompi.co/v1");

    const response = await app.inject({
      method: "GET",
      url: "/v1/api/test-only/client",
      headers: {
        ...AUTH,
        "x-gateway-public-key": "pub_test_cliente",
        "x-gateway-private-key": "prv_test_cliente",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-kit-pagos-warning"]).toBeUndefined();
    await app.close();
  });

  /** Sin esto, un frontend recibiría la advertencia pero su JavaScript no podría leerla. */
  it("should expose the warning header to browsers through CORS", async () => {
    const app = appPointingTo("https://sandbox.wompi.co/v1");

    const response = await app.inject({
      method: "GET",
      url: "/v1/api/gateways",
      headers: { ...AUTH, origin: "https://frontend.example.com" },
    });

    expect(response.headers["access-control-expose-headers"]).toContain("x-kit-pagos-warning");
    await app.close();
  });
});

describe("logCredentialPolicy", () => {
  it("should log, per gateway, where it points and which credentials it accepts", () => {
    const env = {
      WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
      RAPYD_BASE_URL: "https://api.rapyd.net/v1",
    };
    const info = jest.fn();
    const warn = jest.fn();
    const app = {
      kitPagosProvider: new KitPagosProvider(new CredentialResolver(env), env),
      log: { info, warn },
    } as unknown as FastifyInstance;

    logCredentialPolicy(app);

    expect(warn).toHaveBeenCalledWith(
      { gateway: "wompi", target: "sandbox" },
      expect.stringContaining("with a warning"),
    );
    expect(warn).toHaveBeenCalledWith(
      { gateway: "rapyd", target: "production" },
      expect.stringContaining("never used"),
    );
    expect(info).toHaveBeenCalledWith({ gateway: "kushki", target: "simulator" }, expect.any(String));
    expect(info).toHaveBeenCalledWith({ gateway: "mercadopago", target: "simulator" }, expect.any(String));
  });
});
