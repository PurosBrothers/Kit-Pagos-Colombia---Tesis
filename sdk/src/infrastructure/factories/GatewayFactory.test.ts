import { GatewayFactory } from "./GatewayFactory";

describe("GatewayFactory", () => {
  const factory = new GatewayFactory();

  it("create() debe existir y aceptar una pasarela", () => {
    expect(() => factory.create("WOMPI"))
      .toThrow("aun no esta implementado");
  });
});
