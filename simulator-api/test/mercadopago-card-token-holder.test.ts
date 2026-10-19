import { buildApp } from "../src/app";

const TOKENS = "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key";
const card = { card_number: "5254133674403564", expiration_month: 11, expiration_year: 2030, security_code: "123" };

/**
 * El token vuelve con el titular que recibió, y sin nombre con el de omisión `APRO`.
 *
 * Las pruebas de `mercadopago.test.ts` mandan `APRO`, que es también el valor de omisión: una
 * fábrica que ignorara el nombre recibido pasaba igual (mutación del issue #153).
 */
describe("POST /v1/sim/mercadopago/card_tokens: the cardholder", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it("should echo the name and the identification it received", async () => {
    const res = await app.inject({
      method: "POST",
      url: TOKENS,
      payload: { ...card, cardholder: { name: "Felipe Ruiz", identification: { type: "CC", number: "1099888777" } } },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().cardholder).toEqual({
      name: "Felipe Ruiz",
      identification: { type: "CC", number: "1099888777" },
    });
  });

  it("should answer APRO and an empty identification without cardholder", async () => {
    const res = await app.inject({ method: "POST", url: TOKENS, payload: card });

    expect(res.statusCode).toBe(201);
    expect(res.json().cardholder).toEqual({ name: "APRO", identification: {} });
  });

  it("should leave the identification empty when only the type arrives", async () => {
    const res = await app.inject({
      method: "POST",
      url: TOKENS,
      payload: { ...card, cardholder: { name: "Felipe Ruiz", identification: { type: "CC" } } },
    });

    expect(res.json().cardholder.identification).toEqual({});
  });
});
