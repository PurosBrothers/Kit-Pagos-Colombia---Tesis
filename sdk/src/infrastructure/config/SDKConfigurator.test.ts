import { SdkConfigurator, SDKOptions } from "./SDKConfigurator";

describe("SDKConfigurator", () => {
  const configurator = new SdkConfigurator();

  it("configure() debe existir y aceptar opciones", () => {
    const options: SDKOptions = {
      gateway: "WOMPI",
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
    expect(() => configurator.getCredentials("WOMPI"))
      .toThrow("aun no esta implementado");
  });
});
