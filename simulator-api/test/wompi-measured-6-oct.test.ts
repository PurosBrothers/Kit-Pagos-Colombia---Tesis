import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * Lo medido contra el sandbox de Wompi el 6 de octubre de 2026 (issue #122).
 *
 * - PSE (`docs/testing-data/wompi.md`, sección 3, «Medido de nuevo el 6 de octubre»): ninguna
 *   consulta mostró `PENDING` con `async_payment_url`; el rechazo y el error llegan con la URL
 *   y su `status_message` en la misma consulta.
 * - `POST /tokens/cards`: el número se valida contra `^\d{12,19}$` y después con Luhn.
 */

let app: FastifyInstance;

beforeAll(() => {
  app = buildApp({ logger: false });
});

afterAll(async () => {
  await app.close();
  resetSimulatorState();
});

let sequence = 0;

function createPse(bank: string, headers: Record<string, string> = {}, pesos = 50000) {
  return app.inject({
    method: "POST",
    url: "/v1/sim/wompi/transactions",
    headers,
    payload: {
      amount_in_cents: pesos * 100,
      currency: "COP",
      reference: `PSE-6OCT-${++sequence}`,
      customer_email: "pagador@example.com",
      payment_method: {
        type: "PSE",
        user_type: 0,
        user_legal_id_type: "CC",
        user_legal_id: "1999888777",
        financial_institution_code: bank,
        payment_description: "Pago de prueba",
      },
    },
  });
}

const read = async (id: string) =>
  (await app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` })).json().data;

describe("Wompi PSE: the outcome and the bank URL arrive together", () => {
  it.each([
    ["bank 2", "2", {}, 50000, "DECLINED", "Transacción RECHAZADA en Sandbox"],
    ["bank 3", "3", {}, 50000, "ERROR", "Transacción con ERROR en Sandbox"],
    ["header DECLINED", "1", { "x-simulator-scenario": "DECLINED" }, 50000, "DECLINED", "Transacción RECHAZADA en Sandbox"],
    ["amount 10100", "1", {}, 10100, "DECLINED", "Transacción RECHAZADA en Sandbox"],
  ] as const)(
    "%s (bank %s, headers %o, %d pesos): created PENDING without URL, the first query is %s with the URL and its status_message",
    async (_case, bank, headers, pesos, status, message) => {
      const created = (await createPse(bank, headers, pesos)).json().data;

      const first = await read(created.id);
      const second = await read(created.id);

      expect(created.status).toBe("PENDING");
      expect(created.payment_method.extra.async_payment_url).toBeUndefined();
      expect(first.status).toBe(status);
      expect(first.status_message).toBe(message);
      expect(first.payment_method.extra.async_payment_url).toContain("pse/redirect?ticket_id=");
      expect(second).toEqual(first);
    },
  );

  it("bank 1 keeps the simulator's two steps: URL while PENDING, then APPROVED without status_message", async () => {
    const created = (await createPse("1")).json().data;

    const first = await read(created.id);
    const second = await read(created.id);

    expect(first.status).toBe("PENDING");
    expect(first.payment_method.extra.async_payment_url).toBeDefined();
    expect(second.status).toBe("APPROVED");
    expect(second.status_message).toBeUndefined();
  });
});

describe("Wompi POST /tokens/cards: pattern first, then Luhn", () => {
  const tokenize = (number: string) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: { authorization: "Bearer pub_test_abc" },
      payload: { number, cvc: "123", exp_month: "12", exp_year: "30", card_holder: "Pedro Perez" },
    });

  const PATTERN_422 = {
    error: {
      type: "INPUT_VALIDATION_ERROR",
      messages: { number: ['debe coincidir con el patron "^\\d{12,19}$"'] },
    },
  };
  const LUHN_422 = {
    error: {
      type: "INPUT_VALIDATION_ERROR",
      messages: { number: ["El número de tarjeta es inválido. Luhn check falló."] },
    },
  };

  it.each(["4242", "4242 4242 4242 4242", "42424242424", "42424242424242424242", "4242a24242424242"])(
    "%s fails the pattern with the measured body",
    async (number) => {
      const res = await tokenize(number);

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual(PATTERN_422);
    },
  );

  it.each(["4242424242424241", "4242424242424242420"])(
    "%s has a valid length and fails Luhn with the measured body",
    async (number) => {
      const res = await tokenize(number);

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual(LUHN_422);
    },
  );

  it.each(["4242424242424242", "4111111111111111", "5254133674403564", "424242424242", "4242424242424242428"])(
    "%s passes the pattern and Luhn",
    async (number) => {
      const res = await tokenize(number);

      expect(res.statusCode).toBe(201);
    },
  );
});
