import { Gateway } from "../../domain/value-objects/Gateway";
import { Environment } from "../../domain/value-objects/Environment";
import { GATEWAY_URL_CATALOG, resolveGatewayCatalogUrl } from "./gateway-urls";

describe("Gateway URL Catalog", () => {
  it("contiene entradas para las 12 combinaciones posibles (4 pasarelas x 3 ambientes)", () => {
    const gateways = [Gateway.WOMPI, Gateway.MERCADOPAGO, Gateway.RAPYD, Gateway.KUSHKI];
    const envs = [Environment.SIMULATOR, Environment.SANDBOX, Environment.PRODUCTION];

    for (const env of envs) {
      for (const gateway of gateways) {
        const url = resolveGatewayCatalogUrl(gateway, env);
        expect(typeof url).toBe("string");
        expect(url.length).toBeGreaterThan(0);
        expect(GATEWAY_URL_CATALOG[env][gateway]).toBe(url);
      }
    }
  });

  it("resuelve las URLs de sandbox medidas en las pruebas de contrato", () => {
    expect(resolveGatewayCatalogUrl(Gateway.WOMPI, Environment.SANDBOX)).toBe(
      "https://sandbox.wompi.co/v1",
    );
    expect(resolveGatewayCatalogUrl(Gateway.MERCADOPAGO, Environment.SANDBOX)).toBe(
      "https://api.mercadopago.com/v1",
    );
    expect(resolveGatewayCatalogUrl(Gateway.RAPYD, Environment.SANDBOX)).toBe(
      "https://sandboxapi.rapyd.net/v1",
    );
    expect(resolveGatewayCatalogUrl(Gateway.KUSHKI, Environment.SANDBOX)).toBe(
      "https://api-uat.kushkipagos.com",
    );
  });

  it("resuelve las URLs oficiales de producción", () => {
    expect(resolveGatewayCatalogUrl(Gateway.WOMPI, Environment.PRODUCTION)).toBe(
      "https://production.wompi.co/v1",
    );
    expect(resolveGatewayCatalogUrl(Gateway.MERCADOPAGO, Environment.PRODUCTION)).toBe(
      "https://api.mercadopago.com/v1",
    );
    expect(resolveGatewayCatalogUrl(Gateway.RAPYD, Environment.PRODUCTION)).toBe(
      "https://api.rapyd.net/v1",
    );
    expect(resolveGatewayCatalogUrl(Gateway.KUSHKI, Environment.PRODUCTION)).toBe(
      "https://api.kushkipagos.com",
    );
  });

  it("resuelve las URLs de simulación por defecto hacia Render", () => {
    expect(resolveGatewayCatalogUrl(Gateway.WOMPI, Environment.SIMULATOR)).toBe(
      "http://localhost:3000/v1/sim/wompi",
    );
    expect(resolveGatewayCatalogUrl(Gateway.MERCADOPAGO, Environment.SIMULATOR)).toBe(
      "http://localhost:3000/v1/sim/mercadopago",
    );
    expect(resolveGatewayCatalogUrl(Gateway.RAPYD, Environment.SIMULATOR)).toBe(
      "http://localhost:3000/v1/sim/rapyd",
    );
    expect(resolveGatewayCatalogUrl(Gateway.KUSHKI, Environment.SIMULATOR)).toBe(
      "http://localhost:3000/v1/sim/kushki",
    );
  });
});
