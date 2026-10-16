import { buildApp } from "../src/app";
import { mercadopagoOrders, resetSimulatorState } from "../src/store/GatewayStores";
import {
  claimIdempotencyKey,
  rememberIdempotentResponse,
  releaseIdempotencyKey,
} from "../src/store/IdempotencyKeys";

/**
 * La idempotencia de `POST /v1/orders`, como se midió contra Mercado Pago el 15 de octubre de
 * 2026 entre las 21:37 y las 21:45 (`docs/testing-data/mercado-pago.md`, «Duplicados e
 * idempotencia en la Orders API»).
 */
describe("Mercado Pago order idempotency in the simulator", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    resetSimulatorState();
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const AUTH = "Bearer APP_USR-prv-prueba";

  function pseOrder(amount = "20000", reference = "ord-idem-pse") {
    return {
      type: "online",
      total_amount: amount,
      external_reference: reference,
      payer: { email: "comprador@example.com" },
      transactions: {
        payments: [
          {
            amount,
            payment_method: { id: "pse", type: "bank_transfer", financial_institution: "1051" },
          },
        ],
      },
      config: { online: { callback_url: "https://comercio.example.com/retorno" } },
    };
  }

  function cardOrder(token: string, amount = "20000") {
    return {
      type: "online",
      total_amount: amount,
      external_reference: "ord-idem-card",
      transactions: {
        payments: [
          {
            amount,
            payment_method: { id: "visa", type: "credit_card", token, installments: 1 },
          },
        ],
      },
    };
  }

  function postOrder(key: string, payload: unknown, headers: Record<string, string> = {}) {
    return app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/orders",
      headers: { "x-idempotency-key": key, authorization: AUTH, ...headers },
      payload: payload as Record<string, unknown>,
    });
  }

  async function tokenize(name: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/card_tokens?public_key=APP_USR-pub-prueba",
      payload: {
        card_number: "4013540682746260",
        expiration_month: 11,
        expiration_year: 2030,
        security_code: "123",
        cardholder: { name, identification: { type: "CC", number: "123456789" } },
      },
    });
    return res.json().id;
  }

  it("answers the same key and body with a byte-identical copy, without a second order", async () => {
    const first = await postOrder("k-1", pseOrder());
    const second = await postOrder("k-1", pseOrder());

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.body).toBe(first.body);
    expect(second.headers["content-type"]).toBe(first.headers["content-type"]);
    expect(mercadopagoOrders.size()).toBe(1);
  });

  it("repeats the original response even after the order changed state", async () => {
    const created = await postOrder("k-2", pseOrder());
    const queried = await app.inject({
      method: "GET",
      url: `/v1/sim/mercadopago/orders/${created.json().id}`,
    });
    expect(queried.json().status).toBe("processed");

    const repeated = await postOrder("k-2", pseOrder());

    expect(repeated.json().status).toBe("action_required");
    expect(repeated.body).toBe(created.body);
  });

  it("repeats the 402 of a declined order with its status", async () => {
    const declined = await postOrder("k-3", cardOrder(await tokenize("OTHE")));
    const token = JSON.parse(declined.body).data.transactions.payments[0].payment_method.token;

    const repeated = await postOrder("k-3", cardOrder(token));

    expect(declined.statusCode).toBe(402);
    expect(repeated.statusCode).toBe(402);
    expect(repeated.body).toBe(declined.body);
  });

  it("repeats the 402 of a failed PSE order, without a second order", async () => {
    const failed = await postOrder("k-3-pse", pseOrder("10100"));
    const repeated = await postOrder("k-3-pse", pseOrder("10100"));

    expect(failed.statusCode).toBe(402);
    expect(repeated.statusCode).toBe(402);
    expect(repeated.body).toBe(failed.body);
    expect(mercadopagoOrders.size()).toBe(1);
  });

  it("answers 409 to the same key with another body, and creates nothing", async () => {
    await postOrder("k-4", pseOrder("20000"));

    const other = await postOrder("k-4", pseOrder("30000"));

    expect(other.statusCode).toBe(409);
    expect(other.json()).toEqual({
      errors: [
        {
          code: "idempotency_key_already_used",
          message: "X-Idempotency-Key already used. Please retry with a different value.",
        },
      ],
    });
    expect(mercadopagoOrders.size()).toBe(1);
  });

  it("answers 409 when a declined charge is retried with another card and the same key", async () => {
    const declined = await postOrder("k-5", cardOrder(await tokenize("OTHE")));
    const retried = await postOrder("k-5", cardOrder(await tokenize("APRO")));

    expect(declined.statusCode).toBe(402);
    expect(retried.statusCode).toBe(409);
  });

  describe("while the first request is still in progress", () => {
    const previous = process.env.SIMULATOR_SLOW_RESPONSE_MS;
    beforeAll(() => {
      process.env.SIMULATOR_SLOW_RESPONSE_MS = "300";
    });
    afterAll(() => {
      process.env.SIMULATOR_SLOW_RESPONSE_MS = previous;
    });

    it("answers 423 to a concurrent request with the same key, and frees the key afterwards", async () => {
      const slow = { "x-simulator-scenario": "SLOW" };
      const first = postOrder("k-6", pseOrder(), slow);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const concurrent = await postOrder("k-6", pseOrder(), slow);

      expect(concurrent.statusCode).toBe(423);
      expect(concurrent.json()).toEqual({
        errors: [
          {
            code: "resource_locked",
            message: "Idempotency key locked. Please retry after some time.",
          },
        ],
      });
      expect((await first).statusCode).toBe(504);

      const afterwards = await postOrder("k-6", pseOrder());
      expect(afterwards.statusCode).toBe(201);
    });
  });

  it("keeps the keys of each credential apart", async () => {
    const mine = await postOrder("k-7", pseOrder());
    const theirs = await postOrder("k-7", pseOrder(), { authorization: "Bearer APP_USR-otro" });

    expect(theirs.statusCode).toBe(201);
    expect(theirs.json().id).not.toBe(mine.json().id);
    expect(mercadopagoOrders.size()).toBe(2);
  });

  it("does not keep the key of a request that created nothing", async () => {
    const invalid = await postOrder("k-8", cardOrder(""));
    expect(invalid.statusCode).toBe(400);

    const valid = await postOrder("k-8", pseOrder());

    expect(valid.statusCode).toBe(201);
  });

  describe("IdempotencyKeys", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    it("treats a key as new again after 24 hours", () => {
      expect(claimIdempotencyKey("e-1", "f", 0)).toEqual({ outcome: "new" });
      rememberIdempotentResponse("e-1", 201, "{}", 0);

      expect(claimIdempotencyKey("e-1", "f", DAY_MS - 1).outcome).toBe("replay");
      expect(claimIdempotencyKey("e-1", "f", DAY_MS)).toEqual({ outcome: "new" });
    });

    it("does not release a remembered response, nor remember a key that was never claimed", () => {
      claimIdempotencyKey("e-2", "f", 0);
      rememberIdempotentResponse("e-2", 201, "{}", 0);
      releaseIdempotencyKey("e-2");
      rememberIdempotentResponse("e-3", 201, "{}", 0);

      expect(claimIdempotencyKey("e-2", "f", 1).outcome).toBe("replay");
      expect(claimIdempotencyKey("e-3", "f", 1)).toEqual({ outcome: "new" });
    });
  });
});
