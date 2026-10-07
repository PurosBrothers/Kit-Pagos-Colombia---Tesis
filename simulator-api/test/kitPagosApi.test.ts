import { FastifyInstance } from "fastify";
import {
  Gateway,
  KitPagos,
  KitPagosError,
  KitPagosErrorCode,
} from "kit-pagos-colombia";
import { buildApp } from "../src/app";

const FRONTEND_ORIGIN = "http://localhost:5173";

/** Registra rutas de prueba dentro del prefijo del módulo, antes de inject(). */
function registerApiTestRoutes(
  app: FastifyInstance,
  routes: (api: FastifyInstance) => void,
): void {
  app.register(
    async (api: FastifyInstance) => {
      routes(api);
    },
    { prefix: "/v1/api" },
  );
}

describe("REST module /v1/api", () => {
  describe("GET /v1/api/gateways", () => {
    it("should return 200 with the four supported gateways", async () => {
      const app = buildApp();

      const res = await app.inject({ method: "GET", url: "/v1/api/gateways" });

      expect(res.statusCode).toBe(200);
      expect(res.json().gateways.sort()).toEqual(
        ["kushki", "mercadopago", "rapyd", "wompi"],
      );

      await app.close();
    });

    it("should require the Bearer token when authentication is enabled", async () => {
      const app = buildApp({ authOptions: { expectedToken: "api_token_test" } });

      const withoutToken = await app.inject({ method: "GET", url: "/v1/api/gateways" });
      const withToken = await app.inject({
        method: "GET",
        url: "/v1/api/gateways",
        headers: { authorization: "Bearer api_token_test" },
      });

      expect(withoutToken.statusCode).toBe(401);
      expect(withToken.statusCode).toBe(200);

      await app.close();
    });
  });

  describe("CORS", () => {
    it("should answer the browser preflight even with authentication enabled", async () => {
      const app = buildApp({ authOptions: { expectedToken: "api_token_test" } });

      const res = await app.inject({
        method: "OPTIONS",
        url: "/v1/api/gateways",
        headers: {
          origin: FRONTEND_ORIGIN,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("*");

      await app.close();
    });

    it("should not add CORS headers to the /v1/sim simulation routes", async () => {
      const app = buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/sim/wompi/merchants/pub_test_xyz",
        headers: { origin: FRONTEND_ORIGIN },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();

      await app.close();
    });
  });

  describe("KitPagosError to HTTP translation", () => {
    // Una fila por código del SDK, lo que cubre las dos familias de ErrorFamily
    // (RETRIABLE y FINAL) y todos los códigos HTTP de la tabla del issue #100.
    it.each([
      [KitPagosErrorCode.INVALID_REQUEST, 400],
      [KitPagosErrorCode.UNSUPPORTED_OPERATION, 400],
      [KitPagosErrorCode.INVALID_CREDENTIALS, 401],
      [KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID, 401],
      [KitPagosErrorCode.RESOURCE_NOT_FOUND, 404],
      [KitPagosErrorCode.RATE_LIMIT_EXCEEDED, 429],
      [KitPagosErrorCode.CONNECTION_FAILED, 502],
      [KitPagosErrorCode.GATEWAY_SERVER_ERROR, 502],
      [KitPagosErrorCode.MALFORMED_RESPONSE, 502],
      [KitPagosErrorCode.MAX_RETRIES_EXCEEDED, 502],
      [KitPagosErrorCode.GATEWAY_TIMEOUT, 504],
      [KitPagosErrorCode.UNKNOWN_ERROR, 500],
    ])("should answer %s with %i, the code and the message", async (code, status) => {
      const app = buildApp();
      registerApiTestRoutes(app, (api) => {
        api.get("/test-error", async () => {
          throw new KitPagosError(code, Gateway.WOMPI, null, `Mensaje de ${code}`);
        });
      });

      const res = await app.inject({ method: "GET", url: "/v1/api/test-error" });

      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ code, message: `Mensaje de ${code}` });

      await app.close();
    });

    it("should translate a real error thrown by the SDK facade", async () => {
      const app = buildApp();
      registerApiTestRoutes(app, (api) => {
        api.get("/test-sdk", async () => {
          const kitPagos = new KitPagos({ gateway: Gateway.WOMPI, credentials: {} });
          return kitPagos.getPaymentStatus("tx-inexistente");
        });
      });

      const res = await app.inject({ method: "GET", url: "/v1/api/test-sdk" });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);

      await app.close();
    });

    it("should not expose the raw gateway body, credentials or stack traces", async () => {
      const app = buildApp();
      const rawGatewayBody = {
        error: { type: "INPUT_VALIDATION_ERROR", reason: "cuerpo_crudo_de_wompi" },
        privateKey: "prv_test_SECRETO",
      };
      registerApiTestRoutes(app, (api) => {
        api.get("/test-leak", async () => {
          throw new KitPagosError(
            KitPagosErrorCode.GATEWAY_SERVER_ERROR,
            Gateway.WOMPI,
            rawGatewayBody,
            "Wompi gateway returned an HTTP error status 500",
          );
        });
      });

      const res = await app.inject({ method: "GET", url: "/v1/api/test-leak" });

      expect(res.statusCode).toBe(502);
      expect(Object.keys(res.json()).sort()).toEqual(["code", "message"]);
      expect(res.body).not.toContain("cuerpo_crudo_de_wompi");
      expect(res.body).not.toContain("SECRETO");
      expect(res.body).not.toContain("stack");
      expect(res.body).not.toMatch(/at .+\.(ts|js):\d+/);

      await app.close();
    });
  });
});
