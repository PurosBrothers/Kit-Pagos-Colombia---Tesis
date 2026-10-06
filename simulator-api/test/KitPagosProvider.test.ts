import { Gateway } from "kit-pagos-colombia";
import { ClientCredentialsRequiredError } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";
import { ENVIRONMENT_HEADER } from "../src/auth/targetEnvironment";

describe("KitPagosProvider", () => {
  const mockServerEnv = {
    WOMPI_PUBLIC_KEY: "pub_test_wompi_server",
    WOMPI_PRIVATE_KEY: "prv_test_wompi_server",
    MERCADOPAGO_PUBLIC_KEY: "pub_test_mp_server",
    MERCADOPAGO_ACCESS_TOKEN: "access_token_mp_server",
  };

  const clientHeaders = {
    "x-gateway-public-key": "pub_custom",
    "x-gateway-private-key": "prv_custom",
  };

  it("reutiliza la misma instancia para el perfil del servidor en el mismo ambiente", () => {
    const provider = new KitPagosProvider(undefined, mockServerEnv);

    const instance1 = provider.resolveClient(Gateway.WOMPI).kitPagos;
    const instance2 = provider.resolveClient(Gateway.WOMPI).kitPagos;

    expect(instance1).toBe(instance2);
  });

  it("mantiene instancias separadas por pasarela y por ambiente", () => {
    const provider = new KitPagosProvider(undefined, mockServerEnv);

    const wompiSim = provider.resolveClient(Gateway.WOMPI, {
      [ENVIRONMENT_HEADER]: "simulator",
    }).kitPagos;
    const wompiSandbox = provider.resolveClient(Gateway.WOMPI, {
      [ENVIRONMENT_HEADER]: "sandbox",
    }).kitPagos;
    const mpSim = provider.resolveClient(Gateway.MERCADOPAGO, {
      [ENVIRONMENT_HEADER]: "simulator",
    }).kitPagos;

    expect(wompiSim).not.toBe(wompiSandbox);
    expect(wompiSim).not.toBe(mpSim);
  });

  it("crea una instancia nueva bajo demanda cuando se envían cabeceras de cliente", () => {
    const provider = new KitPagosProvider(undefined, mockServerEnv);

    const serverInstance = provider.resolveClient(Gateway.WOMPI).kitPagos;
    const clientInstance1 = provider.resolveClient(Gateway.WOMPI, clientHeaders).kitPagos;
    const clientInstance2 = provider.resolveClient(Gateway.WOMPI, clientHeaders).kitPagos;

    expect(clientInstance1).not.toBe(serverInstance);
    // Cada llamada con cabeceras de cliente construye una instancia aislada
    expect(clientInstance1).not.toBe(clientInstance2);
  });

  it("resuelve baseUrl de simulación con SIMULATOR_SDK_BASE_URL agregando el path de la pasarela", () => {
    const customEnv = {
      ...mockServerEnv,
      SIMULATOR_SDK_BASE_URL: "https://kit-pagos-colombia.onrender.com",
    };
    const provider = new KitPagosProvider(undefined, customEnv);

    expect(provider.resolveSimulatorBaseUrl(Gateway.WOMPI)).toBe(
      "https://kit-pagos-colombia.onrender.com/v1/sim/wompi",
    );
    expect(provider.resolveSimulatorBaseUrl(Gateway.MERCADOPAGO)).toBe(
      "https://kit-pagos-colombia.onrender.com/v1/sim/mercadopago",
    );
  });

  it("resuelve baseUrl de simulación hacia el propio proceso cuando no hay SIMULATOR_SDK_BASE_URL", () => {
    const provider = new KitPagosProvider(undefined, mockServerEnv);
    expect(provider.resolveSimulatorBaseUrl(Gateway.WOMPI)).toBe(
      "http://localhost:3000/v1/sim/wompi",
    );
  });

  it("usa el PORT del proceso cuando no hay SIMULATOR_SDK_BASE_URL", () => {
    const provider = new KitPagosProvider(undefined, { ...mockServerEnv, PORT: "10000" });
    expect(provider.resolveSimulatorBaseUrl(Gateway.KUSHKI)).toBe(
      "http://localhost:10000/v1/sim/kushki",
    );
  });

  /** Las credenciales que la API usa dependen del ambiente declarado (punto 69). */
  describe("resolveClient() according to declared environment", () => {
    it("should refuse server credentials against production, even when the server has them", () => {
      const provider = new KitPagosProvider(undefined, mockServerEnv);

      expect(() =>
        provider.resolveClient(Gateway.WOMPI, { [ENVIRONMENT_HEADER]: "production" }),
      ).toThrow(ClientCredentialsRequiredError);
      expect(() =>
        provider.resolveClient(Gateway.WOMPI, { [ENVIRONMENT_HEADER]: "production" }),
      ).toThrow(/x-gateway-public-key, x-gateway-private-key/);
    });

    it("should name the missing header when production credentials come incomplete", () => {
      const provider = new KitPagosProvider(undefined, mockServerEnv);

      try {
        provider.resolveClient(Gateway.WOMPI, {
          [ENVIRONMENT_HEADER]: "production",
          "x-gateway-public-key": "pub_prod_cliente",
        });
        throw new Error("debió lanzar");
      } catch (error) {
        expect(error).toBeInstanceOf(ClientCredentialsRequiredError);
        expect((error as ClientCredentialsRequiredError).missingHeaders).toEqual([
          "x-gateway-private-key",
        ]);
      }
    });

    it("should use complete client credentials against production, without a warning", () => {
      const provider = new KitPagosProvider(undefined, mockServerEnv);

      const client = provider.resolveClient(Gateway.WOMPI, {
        [ENVIRONMENT_HEADER]: "production",
        ...clientHeaders,
      });

      expect(client.target).toBe("production");
      expect(client.warning).toBeUndefined();
    });

    it("should fall back to server credentials against sandbox, with the recommendation", () => {
      const provider = new KitPagosProvider(undefined, mockServerEnv);

      const client = provider.resolveClient(Gateway.WOMPI, {
        [ENVIRONMENT_HEADER]: "sandbox",
      });

      expect(client.target).toBe("sandbox");
      expect(client.warning).toContain(
        "Para pruebas futuras se recomienda utilizar las credenciales propias",
      );
      expect(client.warning).toContain("x-gateway-public-key, x-gateway-private-key");
    });

    it("should say which header is missing when sandbox credentials come incomplete", () => {
      const provider = new KitPagosProvider(undefined, mockServerEnv);

      const client = provider.resolveClient(Gateway.WOMPI, {
        [ENVIRONMENT_HEADER]: "sandbox",
        "x-gateway-private-key": "prv_test_cliente",
      });

      expect(client.warning).toMatch(/falta: x-gateway-public-key\.$/);
    });

    it("should not warn when client brings its own sandbox credentials", () => {
      const provider = new KitPagosProvider(undefined, mockServerEnv);

      expect(
        provider.resolveClient(Gateway.WOMPI, {
          [ENVIRONMENT_HEADER]: "sandbox",
          ...clientHeaders,
        }).warning,
      ).toBeUndefined();
    });

    it("should default to simulator without restrictions and warnings when header is omitted", () => {
      const provider = new KitPagosProvider(undefined, mockServerEnv);

      const client = provider.resolveClient(Gateway.WOMPI);

      expect(client.target).toBe("simulator");
      expect(client.warning).toBeUndefined();
    });

    it("should keep verifying webhooks with the server profile", () => {
      const provider = new KitPagosProvider(undefined, mockServerEnv);

      expect(() => provider.getWebhookVerifier(Gateway.WOMPI)).not.toThrow();
    });
  });
});
