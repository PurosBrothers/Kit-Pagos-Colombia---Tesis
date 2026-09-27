import { Gateway } from "kit-pagos-colombia";
import { KitPagosProvider } from "../src/services/KitPagosProvider";

describe("KitPagosProvider", () => {
  const mockServerEnv = {
    WOMPI_PUBLIC_KEY: "pub_test_wompi_server",
    WOMPI_PRIVATE_KEY: "prv_test_wompi_server",
    MERCADOPAGO_PUBLIC_KEY: "pub_test_mp_server",
    MERCADOPAGO_ACCESS_TOKEN: "access_token_mp_server",
  };

  it("reutiliza la misma instancia para el perfil del servidor", () => {
    const provider = new KitPagosProvider(undefined, mockServerEnv);

    const instance1 = provider.getKitPagos(Gateway.WOMPI);
    const instance2 = provider.getKitPagos(Gateway.WOMPI);

    expect(instance1).toBe(instance2);
  });

  it("mantiene instancias separadas por pasarela", () => {
    const provider = new KitPagosProvider(undefined, mockServerEnv);

    const wompiInstance = provider.getKitPagos(Gateway.WOMPI);
    const mpInstance = provider.getKitPagos(Gateway.MERCADOPAGO);

    expect(wompiInstance).not.toBe(mpInstance);
  });

  it("crea una instancia nueva bajo demanda cuando se envían cabeceras de cliente", () => {
    const provider = new KitPagosProvider(undefined, mockServerEnv);

    const serverInstance = provider.getKitPagos(Gateway.WOMPI);

    const clientHeaders = {
      "x-gateway-public-key": "pub_custom",
      "x-gateway-private-key": "prv_custom",
    };

    const clientInstance1 = provider.getKitPagos(Gateway.WOMPI, clientHeaders);
    const clientInstance2 = provider.getKitPagos(Gateway.WOMPI, clientHeaders);

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
});
