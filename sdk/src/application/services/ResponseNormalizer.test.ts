import { ResponseNormalizer } from "./ResponseNormalizer";

describe("ResponseNormalizer", () => {
  const normalizer = new ResponseNormalizer();

  it("normalize() debe existir y aceptar una respuesta cruda y la pasarela", () => {
    expect(() => normalizer.normalize({}, "WOMPI"))
      .toThrow("aun no esta implementado");
  });
});
