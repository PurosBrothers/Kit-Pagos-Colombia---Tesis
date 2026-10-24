import { buildApp } from "../src/app";
import { resetSimulatorState } from "../src/store/GatewayStores";

const TOKENS = "/v1/sim/kushki/card/v1/tokens";
const CHARGES = "/v1/sim/kushki/card/v1/charges";

const card = { name: "APRO Ruiz", number: "4242424242424242", cvv: "123", expiryMonth: "11", expiryYear: "30" };
const tokenBody = { card, totalAmount: 48000, currency: "COP" };
const merchant = { "public-merchant-id": "kushki_public_sim" };

function chargeBody(token: string, subtotalIva0: number) {
  return { token, amount: { subtotalIva0, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" }, fullResponse: true };
}

/** Las respuestas medidas contra UAT el 17 de octubre de 2026 (punto 106). */
describe("Kushki POST /v1/sim/kushki/card/v1/tokens", () => {
  const app = buildApp();

  beforeEach(() => resetSimulatorState());
  afterAll(async () => {
    await app.close();
  });

  it("should issue a 32-hex token with 201, as UAT does", async () => {
    const res = await app.inject({ method: "POST", url: TOKENS, headers: merchant, payload: tokenBody });

    expect(res.statusCode).toBe(201);
    expect(Object.keys(res.json())).toEqual(["token"]);
    expect(res.json().token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("should answer 401 Unauthorized without Public-Merchant-Id", async () => {
    const res = await app.inject({ method: "POST", url: TOKENS, payload: tokenBody });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ message: "Unauthorized" });
  });

  it("should answer K004 to a merchant id marked invalid, before reading the body", async () => {
    const res = await app.inject({
      method: "POST",
      url: TOKENS,
      headers: { "public-merchant-id": "kushki_invalid" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ message: "ID de comercio o credencial no válido", code: "K004" });
  });

  it.each([
    ["without amount", { card, currency: "COP" }],
    ["with amount 0", { card, totalAmount: 0, currency: "COP" }],
    ["with the amount as text", { card, totalAmount: "48000", currency: "COP" }],
    ["with a short number", { card: { ...card, number: "4242" }, totalAmount: 48000, currency: "COP" }],
    ["without holder", { card: { ...card, name: " " }, totalAmount: 48000, currency: "COP" }],
    ["without cvv", { card: { ...card, cvv: "" }, totalAmount: 48000, currency: "COP" }],
    ["without month", { card: { ...card, expiryMonth: "" }, totalAmount: 48000, currency: "COP" }],
    ["without year", { card: { ...card, expiryYear: "" }, totalAmount: 48000, currency: "COP" }],
    ["without card", { totalAmount: 48000, currency: "COP" }],
  ])("should answer K001 to a body %s", async (_case, payload) => {
    const res = await app.inject({ method: "POST", url: TOKENS, headers: merchant, payload });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: "K001", message: "Cuerpo de la petición inválido." });
  });

  it("should answer K055 without currency", async () => {
    const res = await app.inject({ method: "POST", url: TOKENS, headers: merchant, payload: { card, totalAmount: 48000 } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: "K055", message: "Tipo de moneda no permitido" });
  });

  it("should apply a technical scenario from the header, as the other tokenizations do", async () => {
    const res = await app.inject({
      method: "POST",
      url: TOKENS,
      headers: { ...merchant, "x-simulator-scenario": "SERVER_ERROR" },
      payload: tokenBody,
    });

    expect(res.statusCode).toBe(500);
  });

  it("should not decide the outcome by the amount: a reserved amount still gets its token", async () => {
    const res = await app.inject({
      method: "POST",
      url: TOKENS,
      headers: merchant,
      payload: { ...tokenBody, totalAmount: 10002 },
    });

    expect(res.statusCode).toBe(201);
  });

  it("should charge its token for the same amount", async () => {
    const { token } = (await app.inject({ method: "POST", url: TOKENS, headers: merchant, payload: tokenBody })).json();

    const res = await app.inject({ method: "POST", url: CHARGES, payload: chargeBody(token, 48000) });

    expect(res.statusCode).toBe(201);
    expect(res.json().details.transactionStatus).toBe("APPROVAL");
  });

  it("should answer K220 when its token is charged for another amount, as UAT does", async () => {
    const { token } = (await app.inject({ method: "POST", url: TOKENS, headers: merchant, payload: tokenBody })).json();

    const res = await app.inject({ method: "POST", url: CHARGES, payload: chargeBody(token, 50000) });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: "K220",
      message: "Monto de la transacción es diferente al monto de la venta inicial",
    });
  });

  it("should compare the amount in cents, so 48000.5 is not 48000", async () => {
    const { token } = (
      await app.inject({ method: "POST", url: TOKENS, headers: merchant, payload: { ...tokenBody, totalAmount: 48000.5 } })
    ).json();

    expect((await app.inject({ method: "POST", url: CHARGES, payload: chargeBody(token, 48000) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: CHARGES, payload: chargeBody(token, 48000.5) })).statusCode).toBe(201);
  });

  it("should keep charging a token it did not issue, whose amount it cannot know", async () => {
    const res = await app.inject({ method: "POST", url: CHARGES, payload: chargeBody("token-de-otra-parte", 50000) });

    expect(res.statusCode).toBe(201);
  });

  it("should forget the issued tokens when the simulator is reset", async () => {
    const { token } = (await app.inject({ method: "POST", url: TOKENS, headers: merchant, payload: tokenBody })).json();
    resetSimulatorState();

    const res = await app.inject({ method: "POST", url: CHARGES, payload: chargeBody(token, 50000) });

    expect(res.statusCode).toBe(201);
  });
});

/** Las tarjetas de kushki.md §1, medidas contra UAT el 24 de octubre de 2026 (punto 122). */
describe("Kushki test cards through the simulator", () => {
  const app = buildApp();

  beforeEach(() => resetSimulatorState());
  afterAll(async () => {
    await app.close();
  });

  async function tokenFor(number: string): Promise<string> {
    const res = await app.inject({ method: "POST", url: TOKENS, headers: merchant, payload: { ...tokenBody, card: { ...card, number } } });
    expect(res.statusCode).toBe(201);
    return res.json().token;
  }

  it.each([
    ["4349003000047015", "017", "Tarjeta no válida"],
    ["4349008516656431", "019", "Tarjeta no compatible"],
    ["4349001210846432", "021", "Tarjeta sin fondos"],
    ["4349003243371321", "022", "Imposible verificar cvv"],
    ["4349001386781322", "023", "Tarjeta bloqueada por el banco"],
  ])("should decline the card %s at the charge with 400 %s (%s)", async (number, code, reason) => {
    const res = await app.inject({ method: "POST", url: CHARGES, payload: chargeBody(await tokenFor(number), 48000) });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code,
      message: "Transacción declinada.",
      details: { ticketNumber: "", responseCode: code, responseText: reason },
    });
  });

  it("should decline the «Declinada en Token» card when tokenizing, with 400 017", async () => {
    const res = await app.inject({
      method: "POST",
      url: TOKENS,
      headers: merchant,
      payload: { ...tokenBody, card: { ...card, number: "4574441215190335" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: "017", message: "Transacción declinada." });
  });

  it("should approve the card the table lists as approved", async () => {
    const res = await app.inject({ method: "POST", url: CHARGES, payload: chargeBody(await tokenFor("5451951574925480"), 48000) });

    expect(res.statusCode).toBe(201);
    expect(res.json().details.transactionStatus).toBe("APPROVAL");
  });

  it("should let the header decide over the card, keeping the card's code", async () => {
    const token = await tokenFor("4349001210846432");

    const approved = await app.inject({
      method: "POST",
      url: CHARGES,
      headers: { "x-simulate-scenario": "APPROVED" },
      payload: chargeBody(token, 48000),
    });

    expect(approved.statusCode).toBe(201);
  });
});
