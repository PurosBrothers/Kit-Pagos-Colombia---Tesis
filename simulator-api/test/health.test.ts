import { buildApp } from "../src/app";

describe("GET /health", () => {
  it("responde 200 con status ok, sin abrir un puerto real", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });
});
