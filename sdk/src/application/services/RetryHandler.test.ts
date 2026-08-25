import { RetryHandler } from "./RetryHandler";

describe("RetryHandler", () => {
  const handler = new RetryHandler();

  it("execute() debe existir y aceptar una operación async", async () => {
    await expect(handler.execute(async () => {}))
      .rejects.toThrow("aun no esta implementado");
  });

  it("isTransient() debe existir y aceptar un error", () => {
    expect(() => handler.isTransient(new Error("test")))
      .toThrow("aun no esta implementado");
  });
});
