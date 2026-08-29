import { ResponseNormalizer } from "./ResponseNormalizer";
import { Gateway } from "../../domain/value-objects/Gateway";

describe("ResponseNormalizer", () => {
  const normalizer = new ResponseNormalizer();

  it("normalize() debe existir y aceptar una respuesta cruda y la pasarela", () => {
    expect(() => normalizer.normalize({}, Gateway.WOMPI))
      .toThrow("aun no esta implementado");
  });
});
