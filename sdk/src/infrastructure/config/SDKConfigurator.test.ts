import { SdkConfigurator, SDKOptions } from "./SDKConfigurator";
import { Gateway } from "../../domain/value-objects/Gateway";

describe("SDKConfigurator", () => {
  const configurator = new SdkConfigurator();

  it("configure() debe existir y aceptar opciones", () => {
    const options: SDKOptions = {
      gateway: Gateway.WOMPI,
      credentials: {},
    };
    expect(() => configurator.configure(options))
      .toThrow("aun no esta implementado");
  });

  it("getActiveGateway() debe existir y retornar Gateway", () => {
    expect(() => configurator.getActiveGateway())
      .toThrow("aun no esta implementado");
  });

  it("getCredentials() debe existir y aceptar una pasarela", () => {
    expect(() => configurator.getCredentials(Gateway.WOMPI))
      .toThrow("aun no esta implementado");
  });
});
