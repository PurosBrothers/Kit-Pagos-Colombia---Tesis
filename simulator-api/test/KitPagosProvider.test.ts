import { Gateway } from "kit-pagos-colombia";
import { ClientCredentialsRequiredError } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";

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

  it("reutiliza la misma instancia para el perfil del servidor", () => {
    const provider = new KitPagosProvider(undefined, mockServerEnv);

    const instance1 = provider.resolveClient(Gateway.WOMPI).kitPagos;
    const instance2 = provider.resolveClient(Gateway.WOMPI).kitPagos;

    expect(instance1).toBe(instance2);
  });

  it("mantiene instancias separadas por pasarela", () => {
    const provider = new KitPagosProvider(undefined, mockServerEnv);

    const wompiInstance = provider.resolveClient(Gateway.WOMPI).kitPagos;
    const mpInstance = provider.resolveClient(Gateway.MERCADOPAGO).kitPagos;

    expect(wompiInstance).not.toBe(mpInstance);
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

  it("resuelve baseUrl específica por pasarela si la variable está definida", () => {
    const customEnv = {
      ...mockServerEnv,
      WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
    };
    const provider = new KitPagosProvider(undefined, customEnv);

    expect(provider.resolveBaseUrl(Gateway.WOMPI)).toBe("https://sandbox.wompi.co/v1");
    // Mercado Pago no tiene variable específica configurada
    expect(provider.resolveBaseUrl(Gateway.MERCADOPAGO)).toBeUndefined();
  });

  it("resuelve baseUrl global con SIMULATOR_SDK_BASE_URL agregando el path de la pasarela", () => {
    const customEnv = {
      ...mockServerEnv,
      SIMULATOR_SDK_BASE_URL: "https://simulator.myapi.com",
    };
    const provider = new KitPagosProvider(undefined, customEnv);

    expect(provider.resolveBaseUrl(Gateway.WOMPI)).toBe(
      "https://simulator.myapi.com/v1/sim/wompi",
    );
    expect(provider.resolveBaseUrl(Gateway.MERCADOPAGO)).toBe(
      "https://simulator.myapi.com/v1/sim/mercadopago",
    );
  });

  /** Las credenciales que la API usa dependen de a dónde apunta (punto 68). */
  describe("resolveClient() according to the target environment", () => {
    const productionEnv = { ...mockServerEnv, WOMPI_BASE_URL: "https://production.wompi.co/v1" };
    const sandboxEnv = { ...mockServerEnv, WOMPI_BASE_URL: "https://sandbox.wompi.co/v1" };

    it("should refuse the server credentials against production, even when the server has them", () => {
      const provider = new KitPagosProvider(undefined, productionEnv);

      expect(() => provider.resolveClient(Gateway.WOMPI)).toThrow(ClientCredentialsRequiredError);
      expect(() => provider.resolveClient(Gateway.WOMPI)).toThrow(
        /x-gateway-public-key, x-gateway-private-key/,
      );
    });

    /**
     * Es el caso que hoy es más peligroso que no mandar nada: el desarrollador cree que
     * usa su cuenta y, por una cabecera mal escrita, cobra con la del operador.
     */
    it("should name the missing header when production credentials come incomplete", () => {
      const provider = new KitPagosProvider(undefined, productionEnv);

      try {
        provider.resolveClient(Gateway.WOMPI, { "x-gateway-public-key": "pub_prod_cliente" });
        throw new Error("debió lanzar");
      } catch (error) {
        expect(error).toBeInstanceOf(ClientCredentialsRequiredError);
        expect((error as ClientCredentialsRequiredError).missingHeaders).toEqual([
          "x-gateway-private-key",
        ]);
      }
    });

    it("should use complete client credentials against production, without a warning", () => {
      const provider = new KitPagosProvider(undefined, productionEnv);

      const client = provider.resolveClient(Gateway.WOMPI, clientHeaders);

      expect(client.target).toBe("production");
      expect(client.warning).toBeUndefined();
    });

    /** Mercado Pago comparte host entre prueba y producción, así que no hay sandbox que reconocer. */
    it("should treat the real Mercado Pago host as production", () => {
      const provider = new KitPagosProvider(undefined, {
        ...mockServerEnv,
        MERCADOPAGO_BASE_URL: "https://api.mercadopago.com/v1",
      });

      expect(() => provider.resolveClient(Gateway.MERCADOPAGO)).toThrow(
        ClientCredentialsRequiredError,
      );
    });

    it("should fall back to the server credentials against a sandbox, with the recommendation", () => {
      const provider = new KitPagosProvider(undefined, sandboxEnv);

      const client = provider.resolveClient(Gateway.WOMPI);

      expect(client.target).toBe("sandbox");
      expect(client.warning).toContain(
        "Para pruebas futuras se recomienda utilizar las credenciales propias",
      );
      expect(client.warning).toContain("x-gateway-public-key, x-gateway-private-key");
    });

    it("should say which header is missing when sandbox credentials come incomplete", () => {
      const provider = new KitPagosProvider(undefined, sandboxEnv);

      const client = provider.resolveClient(Gateway.WOMPI, {
        "x-gateway-private-key": "prv_test_cliente",
      });

      expect(client.warning).toMatch(/falta: x-gateway-public-key\.$/);
    });

    it("should not warn when the client brings its own sandbox credentials", () => {
      const provider = new KitPagosProvider(undefined, sandboxEnv);

      expect(provider.resolveClient(Gateway.WOMPI, clientHeaders).warning).toBeUndefined();
    });

    it("should keep the local simulator free of restrictions and warnings", () => {
      const provider = new KitPagosProvider(undefined, mockServerEnv);

      const client = provider.resolveClient(Gateway.WOMPI);

      expect(client.target).toBe("simulator");
      expect(client.warning).toBeUndefined();
    });

    /**
     * Verificar no llama a la pasarela y el secreto sale solo del servidor (punto 65), así
     * que apuntar a producción no puede dejar a la API sin poder verificar webhooks.
     */
    it("should keep verifying webhooks with the server profile when pointed at production", () => {
      const provider = new KitPagosProvider(undefined, productionEnv);

      expect(() => provider.getWebhookVerifier(Gateway.WOMPI)).not.toThrow();
    });
  });
});
