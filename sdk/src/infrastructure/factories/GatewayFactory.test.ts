import { GatewayFactory } from "./GatewayFactory";
import { Gateway } from "../../domain/value-objects/Gateway";

describe("GatewayFactory", () => {
  const factory = new GatewayFactory();

  it("create() debe existir y aceptar una pasarela", () => {
    expect(() => factory.create(Gateway.WOMPI))
      .toThrow("aun no esta implementado");
  });
});
