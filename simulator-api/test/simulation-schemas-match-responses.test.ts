import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app";
import * as wompiSchemas from "../src/routes/schemas/wompi.schemas";
import * as mercadoPagoSchemas from "../src/routes/schemas/mercadopago.schemas";
import { getHealthSchema } from "../src/routes/schemas/health.schemas";
import { buildSignedApp } from "./helpers/signedRequests";

/*
 * Lo que responde de verdad cada ruta de simulación de Wompi y Mercado Pago, y `/health`, está
 * declarado en su schema y lo cumple (issue #106).
 *
 * `compileSchemasAsIs` serializa con `JSON.stringify`, así que un schema de respuesta incompleto
 * no recorta nada y ninguna otra prueba lo nota: lo único que se pierde es la documentación de
 * `/docs`. Esta prueba hace que un código o un campo que el handler devuelve y el schema no
 * declara falle aquí. Las peticiones son las que mandan el SDK y el prototipo D, con los cuerpos
 * de las pruebas de cada ruta.
 */

interface Schema {
  items?: Schema;
  properties?: Record<string, Schema>;
  additionalProperties?: unknown;
  examples?: unknown[];
}

interface RouteSchema {
  body?: Schema;
  response: Record<string, Schema>;
}

const ajv = addFormats(
  new Ajv({ strict: false, allErrors: true, coerceTypes: false, keywords: ["example"] }),
);

const compiled = new Map<object, ValidateFunction>();

function validatorFor(schema: object): ValidateFunction {
  let validate = compiled.get(schema);
  if (validate === undefined) {
    validate = ajv.compile(schema);
    compiled.set(schema, validate);
  }
  return validate;
}

function errorsOf(schema: object, value: unknown): string[] {
  const validate = validatorFor(schema);
  return validate(value)
    ? []
    : (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`);
}

/** Las propiedades que el valor trae y el schema no declara, recorriendo objetos y listas. */
function undeclaredFields(schema: Schema | undefined, value: unknown, path = ""): string[] {
  if (schema === undefined || value === null || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    const items = schema.items;
    return items ? value.flatMap((item) => undeclaredFields(items, item, `${path}[]`)) : [];
  }
  const properties = schema.properties;
  if (properties === undefined || schema.additionalProperties !== undefined) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key in properties ? undeclaredFields(properties[key], child, `${path}${key}.`) : [`${path}${key}`],
  );
}

function parsedBody(payload: string): unknown {
  try {
    return payload === "" ? undefined : JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/**
 * Hace la petición y comprueba que el código esté declarado y que el cuerpo JSON cumpla el schema
 * de ese código sin campos de más. Un cuerpo que no es JSON (`HTML_ERROR`, `MALFORMED_JSON`) solo
 * exige el código declarado.
 */
async function conforms(app: FastifyInstance, schema: RouteSchema, options: InjectOptions) {
  const res = await app.inject(options);
  const label = `${options.method} ${options.url} → ${res.statusCode}`;
  const declared = schema.response[res.statusCode];
  const body = parsedBody(res.body);

  expect({ label, declared: declared !== undefined }).toEqual({ label, declared: true });
  if (body !== undefined) {
    expect({ label, errors: errorsOf(declared, body) }).toEqual({ label, errors: [] });
    expect({ label, undeclared: undeclaredFields(declared, body) }).toEqual({ label, undeclared: [] });
  }
  return res;
}

let sequence = 0;
const next = (prefix: string) => `${prefix}-${process.pid}-${++sequence}`;

describe("simulation route schemas declare what the routes really answer", () => {
  const previousSlow = process.env.SIMULATOR_SLOW_RESPONSE_MS;

  beforeAll(() => {
    process.env.SIMULATOR_SLOW_RESPONSE_MS = "1";
  });

  afterAll(() => {
    if (previousSlow === undefined) {
      delete process.env.SIMULATOR_SLOW_RESPONSE_MS;
    } else {
      process.env.SIMULATOR_SLOW_RESPONSE_MS = previousSlow;
    }
  });

  describe("Wompi", () => {
    const app = buildSignedApp();
    const {
      postWompiTransactionsSchema: create,
      getWompiTransactionSchema: query,
      getWompiMerchantSchema: merchant,
      getWompiPseInstitutionsSchema: banks,
      postWompiTokenCardSchema: tokenize,
    } = wompiSchemas as unknown as Record<string, RouteSchema>;

    afterAll(() => app.close());

    const transaction = (method: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      amount_in_cents: 6800000,
      currency: "COP",
      reference: next("wompi"),
      customer_email: "comprador@example.com",
      payment_method: method,
      redirect_url: "http://localhost:4001/orden/1",
      ...extra,
    });
    const pse = { type: "PSE", user_type: 0, user_legal_id_type: "CC", user_legal_id: "1999888777", financial_institution_code: "1", payment_description: "Sondeo" };

    const createWith = (body: Record<string, unknown>, scenario?: string) =>
      conforms(app, create, {
        method: "POST",
        url: "/v1/sim/wompi/transactions",
        headers: { authorization: "Bearer prv_test_simulator", ...(scenario ? { "x-simulate-scenario": scenario } : {}) },
        payload: body,
      });
    const queryOf = (id: string, authorization = "Bearer prv_test_simulator") =>
      conforms(app, query, { method: "GET", url: `/v1/sim/wompi/transactions/${id}`, headers: { authorization } });

    it("card: token, merchant, creation and query", async () => {
      await conforms(app, merchant, { method: "GET", url: "/v1/sim/wompi/merchants/pub_test_simulator" });
      const token = await conforms(app, tokenize, {
        method: "POST",
        url: "/v1/sim/wompi/tokens/cards",
        headers: { authorization: "Bearer pub_test_simulator" },
        payload: { number: "4242424242424242", cvc: "123", exp_month: "12", exp_year: "29", card_holder: "Prueba Kit" },
      });
      const created = await createWith(transaction({ type: "CARD", token: token.json().data.id, installments: 1 }));

      expect(created.statusCode).toBe(201);
      expect((await queryOf(created.json().data.id)).statusCode).toBe(200);
    });

    it("PSE: banks, creation and the two queries", async () => {
      await conforms(app, banks, {
        method: "GET",
        url: "/v1/sim/wompi/pse/financial_institutions",
        headers: { authorization: "Bearer pub_test_simulator" },
      });
      const created = await createWith(transaction(pse));
      const id = created.json().data.id;

      expect((await queryOf(id)).json().data.payment_method.extra.async_payment_url).toBeDefined();
      expect((await queryOf(id)).json().data.status).toBe("APPROVED");
    });

    it("rejections: missing method, invalid key, duplicate, unknown scenario and missing transaction", async () => {
      expect((await createWith({ amount_in_cents: 6800000, currency: "COP" })).statusCode).toBe(422);
      expect((await createWith(transaction(pse), "INVALID_CREDENTIALS")).statusCode).toBe(401);

      const duplicate = transaction(pse);
      expect((await createWith(duplicate, "DUPLICATE_PAYMENT")).statusCode).toBe(201);
      expect((await createWith({ ...duplicate, acceptance_token: `sim_acceptance_${next("dup")}` }, "DUPLICATE_PAYMENT")).statusCode).toBe(409);

      expect((await createWith(transaction(pse), "NO_EXISTE")).statusCode).toBe(501);
      expect((await queryOf("no-existe")).statusCode).toBe(404);
      expect((await queryOf("no-existe", "Bearer prv_test_invalid")).statusCode).toBe(403);
      expect(
        (await conforms(app, merchant, { method: "GET", url: "/v1/sim/wompi/merchants/pub_test_invalid" })).statusCode,
      ).toBe(404);
    });

    it.each([
      ["RATE_LIMIT", 429],
      ["SERVER_ERROR", 500],
      ["BAD_GATEWAY", 502],
      ["HTML_ERROR", 502],
      ["SERVICE_UNAVAILABLE", 503],
      ["FLAPPING", 503],
      ["TIMEOUT", 504],
      ["SLOW", 504],
      ["MALFORMED_BODY", 200],
      ["MALFORMED_JSON", 200],
    ])("technical failure %s on creation answers a declared %i", async (scenario, status) => {
      expect((await createWith(transaction(pse), scenario)).statusCode).toBe(status);
    });

    it.each([
      [10600, 500],
      [10602, 503],
      [10604, 504],
    ])("a creation for %i pesos makes the query answer a declared %i", async (pesos, status) => {
      const created = await createWith(transaction(pse, { amount_in_cents: pesos * 100 }));
      const id = created.json().data.id;

      // La consulta que publica la URL del banco no falla: la hace el SDK dentro de la creación.
      expect((await queryOf(id)).statusCode).toBe(200);
      expect((await queryOf(id)).statusCode).toBe(status);
    });

    it.each([
      ["Bearer pub_test_sim_server_error", 500],
      ["Bearer pub_test_sim_flapping", 503],
    ])("the bank list with %s answers a declared %i", async (authorization, status) => {
      const res = await conforms(app, banks, {
        method: "GET",
        url: "/v1/sim/wompi/pse/financial_institutions",
        headers: { authorization },
      });
      expect(res.statusCode).toBe(status);
    });
  });

  describe("Mercado Pago", () => {
    const app = buildApp();
    const {
      postMpPaymentsSchema: createPayment,
      getMpPaymentSchema: queryPayment,
      postMpOrdersSchema: createOrder,
      getMpOrderSchema: queryOrder,
      getMpPaymentMethodsSchema: methods,
      getMpPaymentMethodSearchSchema: search,
      postMpTokenCardSchema: tokenize,
      getMpCardTokenSchema: readToken,
    } = mercadoPagoSchemas as unknown as Record<string, RouteSchema>;
    const authorization = "Bearer TEST-simulador-kit-pagos";

    afterAll(() => app.close());

    const payment = (extra: Record<string, unknown> = {}) => ({
      transaction_amount: 68000,
      description: "Sondeo PR 137",
      external_reference: next("mp-pago"),
      token: "a1b2c3d4e5f6",
      installments: 1,
      payment_method_id: "visa",
      payer: { email: "comprador@example.com" },
      ...extra,
    });
    const pseOrder = (amount = "68000") => ({
      type: "online",
      total_amount: amount,
      external_reference: next("mp-pse"),
      processing_mode: "automatic",
      payer: {
        email: "comprador@example.com",
        entity_type: "individual",
        identification: { type: "CC", number: "1999888777" },
        first_name: "Prueba",
        last_name: "Kit",
        phone: { area_code: "57", number: "3001234567" },
        address: { street_name: "Calle 10", street_number: "5-51", city: "Bogota", zip_code: "111711", neighborhood: "La Candelaria" },
      },
      transactions: {
        payments: [{ amount, payment_method: { id: "pse", type: "bank_transfer", financial_institution: "1051" } }],
      },
      additional_info: { "payer.ip_address": "190.24.0.10" },
      config: { online: { callback_url: "http://localhost:4001/orden/1" } },
    });

    const pay = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
      conforms(app, createPayment, {
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { authorization, "x-idempotency-key": next("idem"), ...headers },
        payload: body,
      });
    const order = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
      conforms(app, createOrder, {
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { authorization, "x-idempotency-key": next("idem"), ...headers },
        payload: body,
      });
    const paymentOf = (id: string, auth = authorization) =>
      conforms(app, queryPayment, { method: "GET", url: `/v1/sim/mercadopago/payments/${id}`, headers: { authorization: auth } });
    const orderOf = (id: string, auth = authorization) =>
      conforms(app, queryOrder, { method: "GET", url: `/v1/sim/mercadopago/orders/${id}`, headers: { authorization: auth } });

    it("card by orders, as the SDK and prototype D charge it: token, method, order and query", async () => {
      const token = await conforms(app, tokenize, {
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-simulador-kit-pagos-publica",
        payload: {
          card_number: "4013540682746260",
          expiration_month: 11,
          expiration_year: 2030,
          security_code: "123",
          cardholder: { name: "APRO", identification: { type: "CC", number: "1999888777" } },
        },
      });
      const id = token.json().id;
      const read = await conforms(app, readToken, { method: "GET", url: `/v1/sim/mercadopago/card_tokens/${id}`, headers: { authorization } });
      await conforms(app, search, {
        method: "GET",
        url: `/v1/sim/mercadopago/payment_methods/search?public_key=TEST-simulador-kit-pagos-publica&bins=${read.json().first_six_digits}`,
        headers: { authorization },
      });
      const created = await order({
        type: "online",
        processing_mode: "automatic",
        total_amount: "68000",
        external_reference: next("mp-tarjeta"),
        payer: { email: "comprador@example.com" },
        transactions: { payments: [{ amount: "68000", payment_method: { id: "visa", type: "credit_card", token: id, installments: 1 } }] },
      });

      expect(created.statusCode).toBe(201);
      expect((await orderOf(created.json().id)).statusCode).toBe(200);
    });

    it("PSE by orders: methods, order and query", async () => {
      await conforms(app, methods, { method: "GET", url: "/v1/sim/mercadopago/payment_methods", headers: { authorization } });
      const created = await order(pseOrder());

      expect(created.statusCode).toBe(201);
      expect((await orderOf(created.json().id)).statusCode).toBe(200);
    });

    it("card by the Payments API: creation and query", async () => {
      const created = await pay(payment());

      expect(created.statusCode).toBe(201);
      expect((await paymentOf(String(created.json().id))).statusCode).toBe(200);
    });

    it("rejections on payments: no key, invalid token, duplicate, unknown scenario and missing payment", async () => {
      const noKey = await conforms(app, createPayment, {
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { authorization },
        payload: payment(),
      });
      expect(noKey.statusCode).toBe(400);
      expect((await pay(payment({ token: undefined }))).statusCode).toBe(400);
      expect((await pay(payment(), { "x-simulate-scenario": "INVALID_CREDENTIALS" })).statusCode).toBe(401);
      expect((await pay(payment(), { "x-simulate-scenario": "REJECTED" })).statusCode).toBe(201);

      const duplicate = payment();
      expect((await pay(duplicate, { "x-simulate-scenario": "DUPLICATE_PAYMENT" })).statusCode).toBe(201);
      expect((await pay(duplicate, { "x-simulate-scenario": "DUPLICATE_PAYMENT" })).statusCode).toBe(409);

      expect((await pay(payment(), { "x-simulate-scenario": "NO_EXISTE" })).statusCode).toBe(501);
      expect((await paymentOf("999")).statusCode).toBe(404);
      expect((await paymentOf("999", "Bearer TEST-invalid")).statusCode).toBe(401);
    });

    it("rejections on orders: no key, invalid token, reused key, failed card, unknown scenario and missing order", async () => {
      const noKey = await conforms(app, createOrder, {
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { authorization },
        payload: pseOrder(),
      });
      expect(noKey.statusCode).toBe(400);
      expect((await order(pseOrder(), { "x-simulate-scenario": "INVALID_CREDENTIALS" })).statusCode).toBe(401);

      const key = next("idem-reusada");
      expect((await order(pseOrder(), { "x-idempotency-key": key })).statusCode).toBe(201);
      expect((await order(pseOrder(), { "x-idempotency-key": key })).statusCode).toBe(409);

      expect((await order(pseOrder(), { "x-simulate-scenario": "REJECTED" })).statusCode).toBe(402);
      expect((await order(pseOrder(), { "x-simulate-scenario": "NO_EXISTE" })).statusCode).toBe(501);
      expect((await orderOf("NO-EXISTE")).statusCode).toBe(404);
      expect((await orderOf("NO-EXISTE", "Bearer TEST-invalid")).statusCode).toBe(401);
    });

    it.each([
      ["RATE_LIMIT", 429],
      ["SERVER_ERROR", 500],
      ["BAD_GATEWAY", 502],
      ["HTML_ERROR", 502],
      ["SERVICE_UNAVAILABLE", 503],
      ["FLAPPING", 503],
      ["TIMEOUT", 504],
      ["SLOW", 504],
      ["MALFORMED_BODY", 200],
      ["MALFORMED_JSON", 200],
    ])("technical failure %s answers a declared %i on payments and on orders", async (scenario, status) => {
      expect((await pay(payment(), { "x-simulate-scenario": scenario })).statusCode).toBe(status);
      expect((await order(pseOrder(), { "x-simulate-scenario": scenario })).statusCode).toBe(status);
    });

    it.each([
      [10600, 500],
      [10602, 503],
      [10604, 504],
    ])("a creation for %i pesos makes both queries answer a declared %i", async (pesos, status) => {
      const created = await pay(payment({ transaction_amount: pesos }));
      expect((await paymentOf(String(created.json().id))).statusCode).toBe(status);

      const createdOrder = await order(pseOrder(String(pesos)));
      expect((await orderOf(createdOrder.json().id)).statusCode).toBe(status);
    });

    it("payment methods, card tokens and BIN search answer their declared errors", async () => {
      const list = (auth: string) =>
        conforms(app, methods, { method: "GET", url: "/v1/sim/mercadopago/payment_methods", headers: { authorization: auth } });
      expect((await list("Bearer TEST-invalid")).statusCode).toBe(401);
      expect((await list("Bearer TEST-sim_server_error")).statusCode).toBe(500);
      expect((await list("Bearer TEST-sim_flapping")).statusCode).toBe(503);

      // Medido el 4 de octubre de 2026: el Bearer en vez de `public_key` responde 400.
      const tokenize400 = await conforms(app, tokenize, {
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-simulador-kit-pagos-publica",
        headers: { authorization },
        payload: {},
      });
      expect(tokenize400.statusCode).toBe(400);
      expect(
        (await conforms(app, tokenize, { method: "POST", url: "/v1/sim/mercadopago/card_tokens", payload: {} })).statusCode,
      ).toBe(401);
      expect(
        (await conforms(app, readToken, { method: "GET", url: "/v1/sim/mercadopago/card_tokens/no-existe" })).statusCode,
      ).toBe(401);
      expect(
        (await conforms(app, search, { method: "GET", url: "/v1/sim/mercadopago/payment_methods/search?bins=401354" })).statusCode,
      ).toBe(400);
    });
  });

  it("GET /health", async () => {
    const app = buildApp();
    await conforms(app, getHealthSchema as unknown as RouteSchema, { method: "GET", url: "/health" });
    await app.close();
  });

  it("every example in a Wompi, Mercado Pago or health schema meets the schema it illustrates", () => {
    const all = { ...wompiSchemas, ...mercadoPagoSchemas, getHealthSchema } as unknown as Record<string, Partial<RouteSchema>>;
    const failures: string[] = [];

    for (const [name, route] of Object.entries(all)) {
      const parts: Array<[string, Schema | undefined]> = [["body", route.body], ...Object.entries(route.response ?? {})];
      for (const [part, schema] of parts) {
        for (const example of schema?.examples ?? []) {
          const errors = [
            ...errorsOf(schema as Schema, example),
            ...undeclaredFields(schema, example).map((field) => `${field} sin declarar`),
          ];
          if (errors.length > 0) {
            failures.push(`${name} ${part}: ${errors.join("; ")}`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
