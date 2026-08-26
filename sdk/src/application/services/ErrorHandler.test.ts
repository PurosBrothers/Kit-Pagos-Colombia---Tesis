import { ErrorHandler } from "./ErrorHandler";
import { Gateway } from "../../domain/value-objects/Gateway";

describe("ErrorHandler", () => {
  const handler = new ErrorHandler();

  it("handle() debe existir, aceptar un error y la pasarela, y retornar SdkError", () => {
    expect(() => handler.handle(new Error("test"), Gateway.WOMPI))
      .toThrow("aun no esta implementado");
  });
});
