import { Gateway } from "kit-pagos-colombia";
import { classifyTarget } from "../src/auth/targetEnvironment";

describe("classifyTarget", () => {
  it("should treat a missing base URL as the simulator, which is the SDK default", () => {
    expect(classifyTarget(Gateway.WOMPI, undefined)).toBe("simulator");
  });

  it("should recognize the simulator path, local or deployed", () => {
    expect(classifyTarget(Gateway.WOMPI, "http://localhost:3000/v1/sim/wompi")).toBe("simulator");
    expect(classifyTarget(Gateway.RAPYD, "https://kit-pagos.onrender.com/v1/sim/rapyd/")).toBe(
      "simulator",
    );
  });

  it("should not take another gateway's simulator path as its own", () => {
    expect(classifyTarget(Gateway.WOMPI, "http://localhost:3000/v1/sim/rapyd")).toBe("production");
  });

  it.each([
    [Gateway.WOMPI, "https://sandbox.wompi.co/v1"],
    [Gateway.RAPYD, "https://sandboxapi.rapyd.net/v1"],
    [Gateway.KUSHKI, "https://api-uat.kushkipagos.com"],
  ])("should recognize the published sandbox of %s", (gateway, baseUrl) => {
    expect(classifyTarget(gateway, baseUrl)).toBe("sandbox");
  });

  it.each([
    [Gateway.WOMPI, "https://production.wompi.co/v1"],
    [Gateway.RAPYD, "https://api.rapyd.net/v1"],
    [Gateway.KUSHKI, "https://api.kushkipagos.com"],
    [Gateway.MERCADOPAGO, "https://api.mercadopago.com/v1"],
  ])("should treat the real host of %s as production", (gateway, baseUrl) => {
    expect(classifyTarget(gateway, baseUrl)).toBe("production");
  });

  /** Ante la duda, la API no presta las credenciales del servidor. */
  it("should treat anything it cannot vouch for as production", () => {
    expect(classifyTarget(Gateway.WOMPI, "http://sandbox.wompi.co/v1")).toBe("production");
    expect(classifyTarget(Gateway.WOMPI, "https://sandboxapi.rapyd.net/v1")).toBe("production");
    expect(classifyTarget(Gateway.WOMPI, "https://sandbox.wompi.co.evil.example/v1")).toBe(
      "production",
    );
    expect(classifyTarget(Gateway.WOMPI, "no es una url")).toBe("production");
  });
});
