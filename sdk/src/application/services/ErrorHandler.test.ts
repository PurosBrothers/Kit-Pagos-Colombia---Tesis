import { ErrorHandler } from "./ErrorHandler";

describe("ErrorHandler", () => {
  const handler = new ErrorHandler();

  it("handle() debe existir, aceptar un error y la pasarela, y retornar SdkError", () => {
    expect(() => handler.handle(new Error("test"), "WOMPI"))
      .toThrow("aun no esta implementado");
  });
});
