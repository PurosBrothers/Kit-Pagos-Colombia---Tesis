import { FastifyInstance } from "fastify";
import { Gateway, KitPagosErrorCode } from "kit-pagos-colombia";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";

const SERVER_CREDENTIALS = {
  WOMPI_PUBLIC_KEY: "pub_test_wompi_server",
  WOMPI_PRIVATE_KEY: "prv_test_wompi_server",
  WOMPI_INTEGRITY_SECRET: "test_integrity_secret",
  MERCADOPAGO_PUBLIC_KEY: "TEST-mp-public-server",
  MERCADOPAGO_ACCESS_TOKEN: "APP_USR-mp-token-server",
  RAPYD_API_ACCESS_KEY: "test_rapyd_access_server",
  RAPYD_API_SECRET_KEY: "test_rapyd_secret_server",
  KUSHKI_PUBLIC_MERCHANT_ID: "test_kushki_public_server",
  KUSHKI_PRIVATE_MERCHANT_ID: "test_kushki_private_server",
};

const CLIENT_CREDENTIALS_HEADERS = {
  "x-gateway-public-key": "pub_client_custom_123",
  "x-gateway-private-key": "prv_client_custom_456",
};

describe("Environment closed catalog and dynamic resolution (issue #123)", () => {
  let app: FastifyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    const credentialResolver = new CredentialResolver(SERVER_CREDENTIALS);
    app = buildApp({
      logger: false,
      credentialResolver,
      kitPagosProvider: new KitPagosProvider(credentialResolver, SERVER_CREDENTIALS),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("12 gateway x environment combinations call the closed catalog URL", () => {
    const combinations: Array<{
      gateway: Gateway;
      environment: "simulator" | "sandbox" | "production";
      expectedPrefix: string;
    }> = [
      // Wompi
      { gateway: Gateway.WOMPI, environment: "simulator", expectedPrefix: "http://localhost:3000/v1/sim/wompi" },
      { gateway: Gateway.WOMPI, environment: "sandbox", expectedPrefix: "https://sandbox.wompi.co/v1" },
      { gateway: Gateway.WOMPI, environment: "production", expectedPrefix: "https://production.wompi.co/v1" },
      // Mercado Pago
      { gateway: Gateway.MERCADOPAGO, environment: "simulator", expectedPrefix: "http://localhost:3000/v1/sim/mercadopago" },
      { gateway: Gateway.MERCADOPAGO, environment: "sandbox", expectedPrefix: "https://api.mercadopago.com/v1" },
      { gateway: Gateway.MERCADOPAGO, environment: "production", expectedPrefix: "https://api.mercadopago.com/v1" },
      // Rapyd
      { gateway: Gateway.RAPYD, environment: "simulator", expectedPrefix: "http://localhost:3000/v1/sim/rapyd" },
      { gateway: Gateway.RAPYD, environment: "sandbox", expectedPrefix: "https://sandboxapi.rapyd.net/v1" },
      { gateway: Gateway.RAPYD, environment: "production", expectedPrefix: "https://api.rapyd.net/v1" },
      // Kushki
      { gateway: Gateway.KUSHKI, environment: "simulator", expectedPrefix: "http://localhost:3000/v1/sim/kushki" },
      { gateway: Gateway.KUSHKI, environment: "sandbox", expectedPrefix: "https://api-uat.kushkipagos.com" },
      { gateway: Gateway.KUSHKI, environment: "production", expectedPrefix: "https://api.kushkipagos.com" },
    ];

    combinations.forEach(({ gateway, environment, expectedPrefix }) => {
      it(`should call ${expectedPrefix} for gateway ${gateway} in ${environment}`, async () => {
        // En producción se deben proveer credenciales del cliente para que no sea rechazado con 401
        const headers: Record<string, string> = {
          "x-kit-pagos-environment": environment,
          ...(environment === "production" ? CLIENT_CREDENTIALS_HEADERS : {}),
        };

        await app.inject({
          method: "GET",
          url: `/v1/api/pse-banks?gateway=${gateway.toLowerCase()}`,
          headers,
        });

        expect(fetchSpy).toHaveBeenCalled();
        const calledUrl = fetchSpy.mock.calls[0][0];
        expect(typeof calledUrl === "string" ? calledUrl : calledUrl.url).toMatch(
          new RegExp(`^${expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        );
      });
    });
  });

  describe("SSRF protection: client cannot force calls outside the closed catalog", () => {
    it("should reject malicious environment headers with 400 and never call fetch", async () => {
      const maliciousValues = [
        "https://evil.attacker.com",
        "http://169.254.169.254/latest/meta-data/",
        "staging",
        "local",
        "production; drop table",
      ];

      for (const malicious of maliciousValues) {
        fetchSpy.mockClear();
        const res = await app.inject({
          method: "GET",
          url: "/v1/api/pse-banks?gateway=wompi",
          headers: { "x-kit-pagos-environment": malicious },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe(KitPagosErrorCode.INVALID_REQUEST);
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    });

    it("should ignore any baseUrl or target URL fields sent in request bodies", async () => {
      const payload = {
        gateway: "wompi",
        amount: "10000.00",
        currency: "COP",
        orderReference: "ORDER-TEST-SSRF",
        payer: { email: "attacker@example.com" },
        paymentMethod: { type: "CARD", token: "tok_test_123" },
        baseUrl: "https://evil.attacker.com/v1",
        targetUrl: "https://evil.attacker.com/v1",
        apiUrl: "https://evil.attacker.com/v1",
      };

      await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload,
        headers: { "x-kit-pagos-environment": "sandbox" },
      });

      expect(fetchSpy).toHaveBeenCalled();
      const calledUrl = String(fetchSpy.mock.calls[0][0]);
      expect(calledUrl).toContain("https://sandbox.wompi.co/v1");
      expect(calledUrl).not.toContain("evil.attacker.com");
    });
  });

  describe("Default behavior and credential validation", () => {
    it("should default to simulator when x-kit-pagos-environment is not provided", async () => {
      await app.inject({
        method: "GET",
        url: "/v1/api/pse-banks?gateway=wompi",
      });

      expect(fetchSpy).toHaveBeenCalled();
      const calledUrl = String(fetchSpy.mock.calls[0][0]);
      expect(calledUrl).toContain("http://localhost:3000/v1/sim/wompi");
    });

    it("should answer 401 without calling the network when production has no client credentials", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/api/pse-banks?gateway=wompi",
        headers: { "x-kit-pagos-environment": "production" },
      });

      expect(res.statusCode).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should include warning in header and body when sandbox uses server credentials", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/api/pse-banks?gateway=wompi",
        headers: { "x-kit-pagos-environment": "sandbox" },
      });

      expect(res.headers["x-kit-pagos-warning"]).toContain("Para pruebas futuras se recomienda");
      expect(res.json().warnings).toEqual([
        expect.objectContaining({ code: "SERVER_SANDBOX_CREDENTIALS_USED" }),
      ]);
      expect(fetchSpy).toHaveBeenCalled();
    });
  });
});
