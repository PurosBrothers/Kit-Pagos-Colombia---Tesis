import Fastify, { FastifyInstance } from "fastify";
import { compileSchemasAsIs } from "../src/routes/schemas/compileSchemasAsIs";

// Un schema que declara menos de lo que la ruta recibe y responde, como pasa en un mock.
const schema = {
  body: {
    type: "object",
    properties: { amount: { type: "integer" } },
  },
  response: {
    200: {
      type: "object",
      properties: { total: { type: "string" } },
    },
  },
} as const;

async function echo(app: FastifyInstance): Promise<void> {
  app.post("/echo", { schema }, async (request) => {
    const body = request.body as Record<string, unknown>;
    return { total: 150000, received: body };
  });
}

function buildWith(asIs: boolean): FastifyInstance {
  const app = Fastify({ logger: false, ajv: { customOptions: { keywords: ["example"], strictTypes: false } } });
  app.register(async (routes) => {
    if (asIs) {
      compileSchemasAsIs(routes);
    }
    await echo(routes);
  });
  return app;
}

describe("compileSchemasAsIs: the simulation schemas do not rewrite requests or responses", () => {
  it("sends the response the handler built, with undeclared fields and their own types", async () => {
    const app = buildWith(true);
    const res = await app.inject({ method: "POST", url: "/echo", payload: { amount: 10, extra: "x" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 150000, received: { amount: 10, extra: "x" } });
  });

  it("rejects a request that breaks the schema instead of converting it", async () => {
    const app = buildWith(true);
    const res = await app.inject({ method: "POST", url: "/echo", payload: { amount: "10" } });

    expect(res.statusCode).toBe(400);
  });

  it("leaves Fastify's defaults to the plugins that do not call it, such as /v1/api", async () => {
    const app = buildWith(false);
    const res = await app.inject({ method: "POST", url: "/echo", payload: { amount: "10", extra: "x" } });

    // Lo que hace Fastify por omisión, y lo que perdían las rutas de simulación: el tipo
    // convertido en la petición, y en la respuesta el campo no declarado fuera y el número
    // vuelto texto.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: "150000" });
  });
});
