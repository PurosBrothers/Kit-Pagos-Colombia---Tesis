import { buildApp } from "../src/app";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * Tarjeta por la Orders API, el camino de la versión 0.6.0 del SDK.
 *
 * Las respuestas reproducen lo medido contra `api.mercadopago.com` el 15 de octubre de 2026
 * con las credenciales del vendedor de prueba (`docs/testing-data/mercado-pago.md`): el titular
 * decide el desenlace por prefijo, el rechazo llega con `402` y la orden fallida en `data`, y
 * el SDK deduce la marca con `GET /card_tokens/{id}` y `GET /payment_methods/search`.
 */
describe("Mercado Pago card orders in the simulator", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    resetSimulatorState();
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  let sequence = 0;
  const nextRef = () => `mp-card-order-${++sequence}`;

  async function tokenize(name: string, cardNumber = "4013540682746260"): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/card_tokens?public_key=APP_USR-pub-prueba",
      payload: {
        card_number: cardNumber,
        expiration_month: 11,
        expiration_year: 2030,
        security_code: "123",
        cardholder: { name, identification: { type: "CC", number: "123456789" } },
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  function cardOrder(
    token: string | undefined,
    options: {
      amount?: string;
      method?: Record<string, unknown>;
      installments?: number;
      headers?: Record<string, string>;
      reference?: string;
    } = {},
  ) {
    const amount = options.amount ?? "20000";
    return app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/orders",
      headers: {
        "x-idempotency-key": `idem-${sequence}`,
        authorization: "Bearer APP_USR-prv-prueba",
        ...options.headers,
      },
      payload: {
        type: "online",
        processing_mode: "automatic",
        total_amount: amount,
        external_reference: options.reference ?? nextRef(),
        payer: { email: "test@testuser.com" },
        transactions: {
          payments: [
            {
              amount,
              payment_method: {
                ...(options.method ?? { id: "visa", type: "credit_card" }),
                ...(token === undefined ? {} : { token }),
                installments: options.installments ?? 1,
              },
            },
          ],
        },
      },
    });
  }

  const queryOrder = (id: string) =>
    app.inject({
      method: "GET",
      url: `/v1/sim/mercadopago/orders/${id}`,
      headers: { authorization: "Bearer APP_USR-prv-prueba" },
    });

  describe("the cardholder name decides the outcome", () => {
    it("APRO is created processed / accredited with 201, and the query answers the same", async () => {
      const created = await cardOrder(await tokenize("APRO"));

      expect(created.statusCode).toBe(201);
      const order = created.json();
      expect(order).toMatchObject({
        status: "processed",
        status_detail: "accredited",
        total_amount: "20000",
        total_paid_amount: "20000",
        capture_mode: "automatic_async",
        currency: "COP",
        config: { online: { transaction_security: { validation: "never" } } },
      });
      expect(order.id).toMatch(/^ORD/);
      expect(order.payer).toBeUndefined();
      expect(order.transactions.payments[0]).toMatchObject({
        status: "processed",
        status_detail: "accredited",
        paid_amount: "20000",
        payment_method: { id: "visa", type: "credit_card", installments: 1, installment_amount: "20000" },
      });

      const queried = await queryOrder(order.id);
      expect(queried.statusCode).toBe(200);
      expect(queried.json()).toEqual(order);
    });

    it("CONT stays processing / in_process with 201, also when queried", async () => {
      const created = await cardOrder(await tokenize("CONT"));

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ status: "processing", status_detail: "in_process" });
      expect(created.json().transactions.payments[0].status_detail).toBe("in_process");
      const queried = await queryOrder(created.json().id);
      expect(queried.json()).toMatchObject({ status: "processing", status_detail: "in_process" });
    });

    it.each([
      ["OTHE", "rejected_by_issuer"],
      ["CALL", "required_call_for_authorize"],
      ["FUND", "insufficient_amount"],
      ["SECU", "bad_filled_card_data"],
      ["EXPI", "bad_filled_card_data"],
      ["FORM", "bad_filled_card_data"],
    ])("%s answers the measured 402 with %s, and the order exists", async (name, detail) => {
      const created = await cardOrder(await tokenize(name));

      expect(created.statusCode).toBe(402);
      const body = created.json();
      const payment = body.data.transactions.payments[0];
      expect(body.errors).toEqual([
        {
          code: "failed",
          message: "The following transactions failed",
          details: [`${payment.id}: ${detail}`],
        },
      ]);
      expect(body.data).toMatchObject({
        status: "failed",
        status_detail: "failed",
        total_paid_amount: "20000",
      });
      expect(payment).toMatchObject({ status: "failed", status_detail: detail, paid_amount: "20000" });

      const queried = await queryOrder(body.data.id);
      expect(queried.statusCode).toBe(200);
      expect(queried.json()).toEqual(body.data);
    });

    // Con el monto que rechaza: sin la regla de prefijo, decidiría el monto y no el titular.
    it("is a prefix rule: APRO Ruiz is approved like APRO", async () => {
      const created = await cardOrder(await tokenize("APRO Ruiz"), { amount: "10100" });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ status: "processed", status_detail: "accredited" });
    });

    it("is a prefix rule in the Payments API too, the path of SDK 0.5.0", async () => {
      const token = await tokenize("OTHE Gomez");

      const charged = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { "x-idempotency-key": "idem-payments", authorization: "Bearer APP_USR-prv-prueba" },
        payload: {
          transaction_amount: 20000,
          description: nextRef(),
          token,
          installments: 1,
          payer: { email: "test@testuser.com" },
        },
      });

      expect(charged.statusCode).toBe(201);
      expect(charged.json()).toMatchObject({ status: "rejected", status_detail: "cc_rejected_other_reason" });
    });

    it("is case sensitive, as measured: apro is not APRO", async () => {
      const created = await cardOrder(await tokenize("apro"), { amount: "10100" });

      expect(created.statusCode).toBe(402);
    });

    it("leaves a name outside the table to the amount and the header", async () => {
      const token = await tokenize("Felipe Ruiz");

      const created = await cardOrder(token);

      expect(created.json()).toMatchObject({ status: "processed" });
    });

    it("lets the header win over the cardholder name", async () => {
      const created = await cardOrder(await tokenize("OTHE"), {
        headers: { "x-simulator-scenario": "APPROVED" },
      });

      expect(created.statusCode).toBe(201);
      expect(created.json().status).toBe("processed");
    });
  });

  describe("the simulator scenarios by amount", () => {
    it("10100 declines with the general error detail", async () => {
      const created = await cardOrder("tok_unknown", { amount: "10100" });

      expect(created.statusCode).toBe(402);
      expect(created.json().data.transactions.payments[0].status_detail).toBe("rejected_by_issuer");
    });

    it("10101 is created processing / in_process", async () => {
      const created = await cardOrder("tok_unknown", { amount: "10101" });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ status: "processing", status_detail: "in_process" });
    });

    it("10102 is created expired / expired with 201, and the query answers the same", async () => {
      const created = await cardOrder("tok_unknown", { amount: "10102" });

      expect(created.statusCode).toBe(201);
      const order = created.json();
      expect(order).toMatchObject({ status: "expired", status_detail: "expired" });
      expect(order.transactions.payments[0]).toMatchObject({
        status: "expired",
        status_detail: "expired",
      });

      const queried = await queryOrder(order.id);
      expect(queried.statusCode).toBe(200);
      expect(queried.json()).toEqual(order);
    });

    // Medido el 15 de octubre de 2026: la misma referencia con otra llave crea y cobra otra orden.
    it("10409 creates both charges with the same reference, as two approved orders", async () => {
      const reference = nextRef();

      const first = await cardOrder("tok_unknown", {
        amount: "10409",
        reference,
        headers: { "x-idempotency-key": "dup-1" },
      });
      const second = await cardOrder("tok_unknown", {
        amount: "10409",
        reference,
        headers: { "x-idempotency-key": "dup-2" },
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(first.json().status).toBe("processed");
      expect(second.json().status).toBe("processed");
      expect(second.json().id).not.toBe(first.json().id);
    });

    it("10600 creates the order and makes its query fail", async () => {
      const created = await cardOrder("tok_unknown", { amount: "10600" });
      expect(created.statusCode).toBe(201);

      const queried = await queryOrder(created.json().id);

      expect(queried.statusCode).toBe(500);
    });

    it("10002 fails two attempts and creates the order on the third one", async () => {
      const reference = nextRef();
      const attempts = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        attempts.push(await cardOrder("tok_unknown", { amount: "10002", reference }));
      }

      expect(attempts.map((res) => res.statusCode)).toEqual([503, 503, 201]);
      expect(attempts[2].json().status).toBe("processed");
    });

    it("splits the amount into the installments, rounded as measured", async () => {
      const created = await cardOrder(await tokenize("APRO"), { installments: 3 });

      expect(created.json().transactions.payments[0].payment_method).toMatchObject({
        installments: 3,
        installment_amount: "6667",
      });
    });
  });

  describe("the measured validations of a card order", () => {
    it.each([
      ["id", { type: "credit_card" }, "'id'"],
      ["type", { id: "visa" }, "'type'"],
      ["id and type", {}, "'id', 'type'"],
    ])("answers 400 required_properties without %s", async (_case, method, missing) => {
      const created = await cardOrder("tok_unknown", { method });

      expect(created.statusCode).toBe(400);
      expect(created.json()).toEqual({
        errors: [
          {
            code: "required_properties",
            message: "Missing properties",
            details: [`'$.transactions.payments[0].payment_method' - missing properties: ${missing}`],
          },
        ],
      });
    });

    it("answers 400 required_properties naming the token when it is missing", async () => {
      const created = await cardOrder(undefined);

      expect(created.statusCode).toBe(400);
      expect(created.json().errors[0].details[0]).toContain("missing properties: 'token'");
    });

    it("answers 400 when a debit card asks for more than one installment", async () => {
      const token = await tokenize("APRO", "4915112055246507");

      const created = await cardOrder(token, {
        method: { id: "debvisa", type: "debit_card" },
        installments: 3,
      });

      expect(created.statusCode).toBe(400);
      expect(created.json().errors[0]).toMatchObject({
        code: "property_value",
        details: ["'$.transactions.payments[0].payment_method.installments' - value must be '1'"],
      });
    });

    it("keeps PSE orders out of the card branch", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { "x-idempotency-key": "idem-pse" },
        payload: {
          type: "online",
          total_amount: "150000",
          external_reference: nextRef(),
          payer: { email: "cliente@example.com", entity_type: "individual" },
          transactions: {
            payments: [{ amount: "150000", payment_method: { id: "pse", type: "bank_transfer" } }],
          },
          config: { online: { callback_url: "https://comercio.example.com/retorno" } },
        },
      });

      expect(created.statusCode).toBe(201);
      expect(created.json().status).toBe("action_required");
    });
  });

  describe("GET /v1/sim/mercadopago/card_tokens/:id", () => {
    const readToken = (id: string, authorization?: string) =>
      app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/card_tokens/${id}`,
        headers: authorization === undefined ? {} : { authorization },
      });

    it("returns the issued token with its BIN and without the cardholder", async () => {
      const token = await tokenize("APRO", "5254133674403564");

      const res = await readToken(token, "Bearer APP_USR-prv-prueba");

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: token,
        public_key: "APP_USR-pub-prueba",
        first_six_digits: "525413",
        last_four_digits: "3564",
      });
      expect(res.json().cardholder).toBeUndefined();
    });

    it("answers a token it did not issue as the Visa credit test card", async () => {
      const res = await readToken("a1b2c3d4e5f6ejemplonoreal", "Bearer APP_USR-prv-prueba");

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: "a1b2c3d4e5f6ejemplonoreal", first_six_digits: "401354" });
    });

    it("answers the measured 401 E212 without Authorization", async () => {
      const res = await readToken("cualquiera");

      expect(res.statusCode).toBe(401);
      expect(res.json().cause).toEqual([{ description: "access_parameters is required", code: "E212" }]);
    });

    it("answers the measured 401 with an invalid access token", async () => {
      const res = await readToken("cualquiera", "Bearer APP_USR-invalid");

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: "unauthorized_access", cause: [{ description: "", code: "" }] });
    });
  });

  describe("GET /v1/sim/mercadopago/payment_methods/search", () => {
    const search = (query: string) =>
      app.inject({ method: "GET", url: `/v1/sim/mercadopago/payment_methods/search${query}` });

    it.each([
      ["401354", "visa", "credit_card"],
      ["525413", "master", "credit_card"],
      ["491511", "debvisa", "debit_card"],
      ["450000", "visa", "credit_card"],
      ["510000", "master", "credit_card"],
    ])("resolves the BIN %s to %s / %s", async (bin, id, type) => {
      const res = await search(`?public_key=APP_USR-pub-prueba&bins=${bin}`);

      expect(res.statusCode).toBe(200);
      expect(res.json().paging).toEqual({ total: 1, limit: 30, offset: 0 });
      expect(res.json().results[0]).toMatchObject({ id, payment_type_id: type, status: "active" });
    });

    it("answers an empty list for a BIN without payment method, as measured with 999999", async () => {
      const res = await search("?public_key=APP_USR-pub-prueba&bins=999999");

      expect(res.json()).toEqual({ paging: { total: 0, limit: 30, offset: 0 }, results: [] });
    });

    it("answers the measured 400 without public_key", async () => {
      const res = await search("?bins=401354");

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ code: 400, message: "public_key is required" });
    });

    it("answers the measured 404 for a public key marked as invalid", async () => {
      const res = await search("?public_key=APP_USR-inexistente&bins=401354");

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 404, message: "public key not found" });
    });
  });
});
