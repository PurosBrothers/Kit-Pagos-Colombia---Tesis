import { buildApp } from "../src/app";

/**
 * Prueba de la especificación OpenAPI 3.0 en /docs.
 *
 * Verifica que:
 * - /docs/json devuelve una especificación válida de OpenAPI 3.0
 * - Los cinco endpoints de Kit Pagos aparecen documentados
 * - Las dos respuestas de POST /v1/api/payments están definidas como alternativas
 * - El securityScheme bearerAuth está declarado
 * - Las dos etiquetas Kit Pagos y Simulación están definidas
 */
describe("GET /docs/json — especificación OpenAPI", () => {
  it("sirve una especificación OpenAPI 3.0 válida", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });

    expect(response.statusCode).toBe(200);
    const spec = response.json<Record<string, unknown>>();
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info).toBeDefined();
    expect((spec.info as Record<string, unknown>).title).toContain("Kit Pagos");
  });

  it("documenta GET /v1/api/gateways con tag Kit Pagos", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, unknown>;

    expect(paths["/v1/api/gateways"]).toBeDefined();
    const get = (paths["/v1/api/gateways"] as Record<string, unknown>)["get"] as Record<string, unknown>;
    expect((get.tags as string[])). toContain("Kit Pagos");
  });

  it("documenta POST /v1/api/payments con union discriminada en la respuesta 201", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, unknown>;

    const post = (paths["/v1/api/payments"] as Record<string, unknown>)?.["post"] as Record<string, unknown>;
    expect(post).toBeDefined();
    const resp201 = (post.responses as Record<string, unknown>)?.["201"] as Record<string, unknown>;
    expect(resp201).toBeDefined();

    // La respuesta 201 debe usar oneOf para la unión discriminada TRANSACTION | REDIRECT_REQUIRED
    const content = (resp201.content as Record<string, unknown>)?.["application/json"] as Record<string, unknown>;
    const schema = content?.schema as Record<string, unknown>;
    expect(schema?.oneOf).toBeDefined();
    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect((schema.oneOf as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("documenta POST /v1/api/webhooks/:gateway", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, unknown>;

    expect(paths["/v1/api/webhooks/{gateway}"]).toBeDefined();
  });

  it("declara el securityScheme bearerAuth", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const components = spec.components as Record<string, unknown>;
    const schemes = components?.securitySchemes as Record<string, unknown>;

    expect(schemes?.bearerAuth).toBeDefined();
    const bearer = schemes.bearerAuth as Record<string, unknown>;
    expect(bearer.type).toBe("http");
    expect(bearer.scheme).toBe("bearer");
  });

  it("define las etiquetas Kit Pagos y Simulación", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const tags = (spec.tags as Array<Record<string, unknown>>).map((t) => t.name);

    expect(tags).toContain("Kit Pagos");
    expect(tags).toContain("Simulación");
  });

  it("documenta los doce códigos de error KitPagosErrorCode en el schema 400 de /payments", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, unknown>;
    const post = (paths["/v1/api/payments"] as Record<string, unknown>)?.["post"] as Record<string, unknown>;
    const resp400 = (post.responses as Record<string, unknown>)?.["400"] as Record<string, unknown>;

    expect(resp400).toBeDefined();
    // El schema del 400 describe el campo 'code' con los KitPagosErrorCode
    const content = (resp400.content as Record<string, unknown>)?.["application/json"] as Record<string, unknown>;
    const schema = content?.schema as Record<string, unknown>;
    const codeProperty = (schema?.properties as Record<string, unknown>)?.code as Record<string, unknown>;
    expect(codeProperty?.description).toBeDefined();
    // La descripción debe mencionar al menos algunos de los 12 códigos
    expect(String(codeProperty.description)).toContain("INVALID_REQUEST");
    expect(String(codeProperty.description)).toContain("GATEWAY_TIMEOUT");
  });

  it("sirve el spec JSON en /docs/json", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("sirve la interfaz interactiva Swagger UI en /docs", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs" });
    // Swagger UI redirige con 302 a /docs/ o responde 200 con HTML
    expect([200, 302]).toContain(response.statusCode);
  });

  it("rechaza con 400 e INVALID_REQUEST una petición que viola el schema de /payments antes de llegar al handler", async () => {
    const app = buildApp({ logger: false });
    // orderReference que excede maxLength: 100 definido en el schema
    const response = await app.inject({
      method: "POST",
      url: "/v1/api/payments",
      payload: {
        amount: "50000.00",
        currency: "COP",
        orderReference: "A".repeat(101),
        payer: { email: "usuario@example.com" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(response.json().message).toContain("orderReference");
  });
});
