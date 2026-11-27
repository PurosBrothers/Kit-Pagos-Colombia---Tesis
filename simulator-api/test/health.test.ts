import { buildApp } from "../src/app";

describe("GET /health", () => {
  it("answers 200 with status ok, without opening a real port", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });

  it("includes Access-Control-Allow-Origin: * so the landing page can check health from the browser", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://purosbrothers.github.io" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });
});
