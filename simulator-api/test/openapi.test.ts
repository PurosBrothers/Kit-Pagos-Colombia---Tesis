import SwaggerParser from "@apidevtools/swagger-parser";
import { KitPagosErrorCode } from "kit-pagos-colombia";
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

  it("pasa la validación de OpenAPI 3.0, con los schemas de todas las rutas", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });

    await expect(SwaggerParser.validate(response.json())).resolves.toBeDefined();
  });

  it("documenta las rutas de simulación de gateways y los preflights de tokenización", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const expectedOperations: Record<string, string> = {
      "/health": "get",
      "/v1/sim/wompi/transactions": "post",
      "/v1/sim/wompi/transactions/{id}": "get",
      "/v1/sim/wompi/merchants/{publicKey}": "get",
      "/v1/sim/wompi/pse/financial_institutions": "get",
      "/v1/sim/mercadopago/payments": "post",
      "/v1/sim/mercadopago/payments/{id}": "get",
      "/v1/sim/mercadopago/orders": "post",
      "/v1/sim/mercadopago/orders/{id}": "get",
      "/v1/sim/mercadopago/payment_methods": "get",
      "/v1/sim/wompi/tokens/cards": "post",
      "/v1/sim/mercadopago/card_tokens": "post",
    };

    for (const [path, method] of Object.entries(expectedOperations)) {
      expect(paths[path]?.[method]).toBeDefined();
    }

    for (const path of ["/v1/sim/wompi/tokens/cards", "/v1/sim/mercadopago/card_tokens"]) {
      const preflight = paths[path]?.["options"] as Record<string, unknown>;
      expect(preflight).toBeDefined();
      const response200 = (preflight.responses as Record<string, unknown>)?.["200"] as Record<string, unknown>;
      expect(response200).toBeDefined();
      expect(response200.headers).toBeDefined();
    }

    const wompiTokenPost = paths["/v1/sim/wompi/tokens/cards"]["post"] as Record<string, unknown>;
    const mercadoPagoTokenPost = paths["/v1/sim/mercadopago/card_tokens"]["post"] as Record<string, unknown>;
    expect(wompiTokenPost.requestBody).toBeDefined();
    expect(mercadoPagoTokenPost.requestBody).toBeDefined();
    expect(wompiTokenPost.responses).toHaveProperty("422");
    expect(mercadoPagoTokenPost.responses).toHaveProperty("401");

    const wompiPaymentPost = paths["/v1/sim/wompi/transactions"]["post"] as Record<string, unknown>;
    const wompiRequestBody = wompiPaymentPost.requestBody as Record<string, unknown>;
    const wompiJsonContent = (wompiRequestBody.content as Record<string, unknown>)["application/json"] as Record<string, unknown>;
    const wompiBodySchema = wompiJsonContent.schema as Record<string, unknown>;
    expect(wompiBodySchema.required).toEqual(
      expect.arrayContaining(["payment_method", "acceptance_token", "signature"]),
    );

    const paymentPost = paths["/v1/sim/mercadopago/payments"]["post"] as Record<string, unknown>;
    const paymentRequestBody = paymentPost.requestBody as Record<string, unknown>;
    const paymentJsonContent = (paymentRequestBody.content as Record<string, unknown>)["application/json"] as Record<string, unknown>;
    const paymentBodySchema = paymentJsonContent.schema as Record<string, unknown>;
    expect(paymentBodySchema.required).toEqual(expect.arrayContaining(["token", "installments"]));

    const mercadoPagoTokenParameters = mercadoPagoTokenPost.parameters as Array<Record<string, unknown>>;
    expect(mercadoPagoTokenParameters).toContainEqual(
      expect.objectContaining({ name: "public_key", in: "query", required: true }),
    );

    const paymentParameters = paymentPost.parameters as Array<Record<string, unknown>>;
    expect(paymentParameters).toContainEqual(
      expect.objectContaining({ name: "x-idempotency-key", in: "header", required: true }),
    );
  });

  it("documenta la orden de tarjeta de Mercado Pago y las dos lecturas del SDK 0.6.0 antes de cobrar", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const paths = response.json<Record<string, unknown>>().paths as Record<string, Record<string, Record<string, unknown>>>;

    expect(paths["/v1/sim/mercadopago/card_tokens/{id}"]?.["get"]?.["responses"]).toHaveProperty("401");
    expect(paths["/v1/sim/mercadopago/payment_methods/search"]?.["get"]?.["responses"]).toHaveProperty("400");

    const orderPost = paths["/v1/sim/mercadopago/orders"]["post"];
    expect(orderPost.summary).toContain("tarjeta");
    const orderResponses = orderPost.responses as Record<string, Record<string, unknown>>;
    expect(Object.keys(orderResponses)).toEqual(expect.arrayContaining(["201", "400", "402", "409", "423"]));

    // La orden de tarjeta lleva token y cuotas en el medio de pago, y la orden fallida va en `data`.
    const orderBody = (orderPost.requestBody as Record<string, Record<string, Record<string, unknown>>>).content[
      "application/json"
    ].schema as Record<string, Record<string, Record<string, unknown>>>;
    const method = (orderBody.properties.transactions.properties as Record<string, Record<string, unknown>>).payments
      .items as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    expect(Object.keys(method.properties.payment_method.properties)).toEqual(
      expect.arrayContaining(["token", "installments"]),
    );
    expect(orderBody.required).toBeUndefined();
    const declined = (orderResponses["402"].content as Record<string, Record<string, Record<string, unknown>>>)[
      "application/json"
    ].schema;
    expect(declined.properties).toHaveProperty("data");
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

  it("documenta las variables reales de autenticación y no acepta webhookSecret desde el cliente", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const info = spec.info as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    const post = (paths["/v1/api/payments"] as Record<string, unknown>)["post"] as Record<string, unknown>;
    const parameters = post.parameters as Array<Record<string, unknown>>;

    expect(info.description).toContain("API_AUTH_TOKEN");
    expect(info.description).toContain("SIMULATOR_API_AUTH_TOKEN");
    expect(info.description).not.toContain("API_KEY");
    expect(spec.security).toBeUndefined();
    expect(parameters.some((parameter) => parameter.name === "x-gateway-webhook-secret")).toBe(false);
  });

  it("define las etiquetas Kit Pagos y Simulación", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const tags = (spec.tags as Array<Record<string, unknown>>).map((t) => t.name);

    expect(tags).toContain("Kit Pagos");
    expect(tags).toContain("Simulación");
  });

  it("documenta todos los códigos de error KitPagosErrorCode en el schema 400 de /payments", async () => {
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
    for (const code of Object.values(KitPagosErrorCode)) {
      expect(String(codeProperty.description)).toContain(code);
    }
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

  it("documenta GET /v1/api/payments/{id} con tag Kit Pagos y parámetros de ruta y consulta", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, unknown>;

    expect(paths["/v1/api/payments/{id}"]).toBeDefined();
    const get = (paths["/v1/api/payments/{id}"] as Record<string, unknown>)["get"] as Record<string, unknown>;
    expect((get.tags as string[])).toContain("Kit Pagos");

    const resp200 = (get.responses as Record<string, unknown>)["200"] as Record<string, unknown>;
    expect(resp200).toBeDefined();
    const content = (resp200.content as Record<string, unknown>)["application/json"] as Record<string, unknown>;
    const schema = content.schema as Record<string, unknown>;
    expect(schema.required).toContain("gateway");
    expect(schema.required).toContain("transaction");
  });

  it("documenta GET /v1/api/pse-banks con tag Kit Pagos y respuesta de bancos agrupados", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, unknown>;

    expect(paths["/v1/api/pse-banks"]).toBeDefined();
    const get = (paths["/v1/api/pse-banks"] as Record<string, unknown>)["get"] as Record<string, unknown>;
    expect((get.tags as string[])).toContain("Kit Pagos");

    const resp200 = (get.responses as Record<string, unknown>)["200"] as Record<string, unknown>;
    expect(resp200).toBeDefined();
    const content = (resp200.content as Record<string, unknown>)["application/json"] as Record<string, unknown>;
    const schema = content.schema as Record<string, unknown>;
    expect(schema.required).toContain("pseBanks");
  });

  it("rechaza con 400 e INVALID_REQUEST una petición a GET /payments/:id que omite gateway en el query", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/v1/api/payments/trx-12345",
      headers: {
        authorization: "Bearer test-token",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(response.json().message).toContain("gateway");
  });

  it("pasa la validación de OpenAPI 3.0 con SwaggerParser (issue #107)", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });

    expect(response.statusCode).toBe(200);
    const spec = response.json();
    await expect(SwaggerParser.validate(spec)).resolves.toBeDefined();
  });

  it("documenta las 6 rutas de simulación de Kushki con sus schemas (issue #107)", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    const kushkiRoutes: Record<string, string> = {
      "/v1/sim/kushki/card/v1/charges": "post",
      "/v1/sim/kushki/charges/{ticketNumber}": "get",
      "/v1/sim/kushki/transfer/v1/bankList": "get",
      "/v1/sim/kushki/transfer/v1/tokens": "post",
      "/v1/sim/kushki/transfer/v1/init": "post",
      "/v1/sim/kushki/transfer/v1/status/{token}": "get",
    };

    for (const [path, method] of Object.entries(kushkiRoutes)) {
      const operation = paths[path]?.[method] as Record<string, unknown> | undefined;
      expect(operation).toBeDefined();
      expect(operation?.tags).toContain("Kushki Simulación");
    }

    // Valida que el cobro documenta x-simulate-scenario y la respuesta 501
    const chargePost = paths["/v1/sim/kushki/card/v1/charges"]["post"] as Record<string, unknown>;
    expect(chargePost.responses).toHaveProperty("501");
    expect(chargePost.responses).toHaveProperty("400");
    expect(chargePost.responses).toHaveProperty("201");

    // Valida que transfer init y transfer tokens documentan el flujo PSE
    const initPost = paths["/v1/sim/kushki/transfer/v1/init"]["post"] as Record<string, unknown>;
    expect(initPost.summary).toContain("Iniciar transferencia");
    expect(initPost.responses).toHaveProperty("201");
  });

  it("documenta las rutas de simulación de Rapyd incluyendo checkout y pagos (issue #107)", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    const rapydRoutes: Record<string, string> = {
      "/v1/sim/rapyd/payments": "post",
      "/v1/sim/rapyd/payments/{paymentId}": "get",
      "/v1/sim/rapyd/checkout": "post",
      "/v1/sim/rapyd/checkout/{checkoutId}": "get",
      "/v1/sim/rapyd/checkout/{checkoutId}/pagar": "get",
      "/v1/sim/rapyd/checkout/{checkoutId}/pay": "get",
      "/v1/sim/rapyd/customers": "post",
      "/v1/sim/rapyd/payment_methods/country": "get",
    };

    for (const [path, method] of Object.entries(rapydRoutes)) {
      const operation = paths[path]?.[method] as Record<string, unknown> | undefined;
      expect(operation).toBeDefined();
      expect(operation?.tags).toContain("Rapyd Simulación");
    }

    // Valida que /checkout/:checkoutId/pagar y /pay están marcadas como facilidad del simulador
    const payOperation = paths["/v1/sim/rapyd/checkout/{checkoutId}/pay"]["get"] as Record<string, unknown>;
    expect(payOperation.description).toContain("facilidad exclusiva del simulador");

    // Valida que POST /checkout responde 200 y documenta 501
    const checkoutPost = paths["/v1/sim/rapyd/checkout"]["post"] as Record<string, unknown>;
    expect(checkoutPost.responses).toHaveProperty("200");
    expect(checkoutPost.responses).toHaveProperty("501");
  });

  it("declara cada etiqueta que usa una operación, y /health queda en Diagnóstico (issue #106)", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json<Record<string, unknown>>();
    const paths = spec.paths as Record<string, Record<string, { tags?: string[] }>>;
    const declared = (spec.tags as Array<Record<string, unknown>>).map((t) => t.name);
    const used = new Set(
      Object.values(paths)
        .flatMap((operations) => Object.values(operations))
        .flatMap((operation) => operation.tags ?? []),
    );

    expect([...used].filter((tag) => !declared.includes(tag))).toEqual([]);
    expect(paths["/health"].get.tags).toEqual(["Diagnóstico"]);
    expect(paths["/v1/sim/wompi/transactions"].post.tags).toEqual(["Wompi Simulación"]);
    expect(paths["/v1/sim/mercadopago/orders"].post.tags).toEqual(["Mercado Pago Simulación"]);
  });
});
