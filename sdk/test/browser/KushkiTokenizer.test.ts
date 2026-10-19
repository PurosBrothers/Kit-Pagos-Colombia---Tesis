import { KushkiTokenizer } from "../../src-browser/tokenizers/KushkiTokenizer";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { BrowserEnvironment, CardData, TokenizeCardParams } from "../../src-browser/types";

describe("KushkiTokenizer", () => {
  const validCard: CardData = {
    number: "4242 4242 4242 4242",
    cvc: "123",
    expMonth: "5",
    expYear: "2030",
    cardHolder: "APRO Ruiz",
  };

  const params = (overrides: Partial<TokenizeCardParams> = {}): TokenizeCardParams => ({
    gateway: Gateway.KUSHKI,
    publicKey: " kushki_public_123 ",
    card: validCard,
    amount: "48000.00",
    ...overrides,
  });

  const reply = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    }) as unknown as Response;

  const answering = (status: number, body: unknown) => jest.fn(async () => reply(status, body));

  it("tokenizes against UAT in sandbox, with the merchant id in its own header and the amount", async () => {
    const fetchFn = answering(201, { token: "a".repeat(32) });

    const result = await KushkiTokenizer.tokenize(params(), fetchFn as unknown as typeof fetch);

    expect(result).toEqual({ token: "a".repeat(32), gateway: Gateway.KUSHKI, rawResponse: { token: "a".repeat(32) } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-uat.kushkipagos.com/card/v1/tokens");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "Public-Merchant-Id": "kushki_public_123" });
    expect(JSON.parse(init.body as string)).toEqual({
      card: { name: "APRO Ruiz", number: "4242424242424242", cvv: "123", expiryMonth: "05", expiryYear: "30" },
      totalAmount: 48000,
      currency: "COP",
    });
  });

  it.each<[BrowserEnvironment, string]>([
    ["production", "https://api.kushkipagos.com/card/v1/tokens"],
    ["simulator", "http://localhost:3000/v1/sim/kushki/card/v1/tokens"],
  ])("uses the catalog URL of %s", async (environment, expected) => {
    const fetchFn = answering(201, { token: "tok" });

    await KushkiTokenizer.tokenize(params({ environment }), fetchFn as unknown as typeof fetch);

    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(expected);
  });

  it("sends the amount with its decimals and the currency it is given", async () => {
    const fetchFn = answering(201, { token: "tok" });

    await KushkiTokenizer.tokenize(params({ amount: "48000.5", currency: "USD" }), fetchFn as unknown as typeof fetch);

    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.totalAmount).toBe(48000.5);
    expect(body.currency).toBe("USD");
  });

  it("keeps a two-digit year and month as they are", async () => {
    const fetchFn = answering(201, { token: "tok" });

    await KushkiTokenizer.tokenize(
      params({ card: { ...validCard, expMonth: "11", expYear: "30" } }),
      fetchFn as unknown as typeof fetch,
    );

    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.card).toMatchObject({ expiryMonth: "11", expiryYear: "30" });
  });

  it.each(["", "   "])("rejects a missing merchant id (%j) without calling Kushki", async (publicKey) => {
    const fetchFn = jest.fn();

    await expect(KushkiTokenizer.tokenize(params({ publicKey }), fetchFn as unknown as typeof fetch)).rejects.toMatchObject({
      code: KitPagosErrorCode.INVALID_CREDENTIALS,
      gateway: Gateway.KUSHKI,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "0", "0.00", "-5", "48000.123", "48.000", "abc"])(
    "rejects the amount %j without calling Kushki, because the token is tied to it",
    async (amount) => {
      const fetchFn = jest.fn();

      await expect(KushkiTokenizer.tokenize(params({ amount }), fetchFn as unknown as typeof fetch)).rejects.toMatchObject({
        code: KitPagosErrorCode.INVALID_REQUEST,
        gateway: Gateway.KUSHKI,
        message: expect.stringContaining("monto"),
      });
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each<[string, Partial<CardData>]>([
    ["without number", { number: "" }],
    ["without cvc", { cvc: "" }],
    ["without holder", { cardHolder: "" }],
    ["with month 13", { expMonth: "13" }],
    ["with month 0", { expMonth: "0" }],
    ["with month 1a", { expMonth: "1a" }],
    ["with a three-digit year", { expYear: "203" }],
  ])("rejects a card %s without calling Kushki", async (_case, change) => {
    const fetchFn = jest.fn();

    await expect(
      KushkiTokenizer.tokenize(params({ card: { ...validCard, ...change } }), fetchFn as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: KitPagosErrorCode.INVALID_REQUEST, gateway: Gateway.KUSHKI });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a missing card without calling Kushki", async () => {
    const fetchFn = jest.fn();

    await expect(
      KushkiTokenizer.tokenize(params({ card: null as unknown as CardData }), fetchFn as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: KitPagosErrorCode.INVALID_REQUEST });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects an unknown environment without calling Kushki", async () => {
    const fetchFn = jest.fn();

    await expect(
      KushkiTokenizer.tokenize(
        params({ environment: "constructor" as unknown as BrowserEnvironment }),
        fetchFn as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: KitPagosErrorCode.INVALID_REQUEST });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reads K004, measured for a merchant id that does not exist, as bad credentials despite its 400", async () => {
    const fetchFn = answering(400, { message: "ID de comercio o credencial no válido", code: "K004" });

    await expect(KushkiTokenizer.tokenize(params(), fetchFn as unknown as typeof fetch)).rejects.toMatchObject({
      code: KitPagosErrorCode.INVALID_CREDENTIALS,
      gateway: Gateway.KUSHKI,
      message: "Kushki rechazó la tokenización: ID de comercio o credencial no válido (K004).",
    });
  });

  it("keeps Kushki's message and code on any other 400", async () => {
    const fetchFn = answering(400, { code: "K001", message: "Cuerpo de la petición inválido." });

    await expect(KushkiTokenizer.tokenize(params(), fetchFn as unknown as typeof fetch)).rejects.toMatchObject({
      code: KitPagosErrorCode.INVALID_REQUEST,
      message: "Kushki rechazó la tokenización: Cuerpo de la petición inválido. (K001).",
      originalPayload: { code: "K001", message: "Cuerpo de la petición inválido." },
    });
  });

  it.each<[number, KitPagosErrorCode]>([
    [401, KitPagosErrorCode.INVALID_CREDENTIALS],
    [403, KitPagosErrorCode.INVALID_CREDENTIALS],
    [404, KitPagosErrorCode.RESOURCE_NOT_FOUND],
    [408, KitPagosErrorCode.GATEWAY_TIMEOUT],
    [429, KitPagosErrorCode.RATE_LIMIT_EXCEEDED],
    [500, KitPagosErrorCode.GATEWAY_SERVER_ERROR],
    [599, KitPagosErrorCode.GATEWAY_SERVER_ERROR],
    [422, KitPagosErrorCode.INVALID_REQUEST],
  ])("maps HTTP %i to %s", async (status, code) => {
    const fetchFn = answering(status, "<html>no es JSON</html>");

    await expect(KushkiTokenizer.tokenize(params(), fetchFn as unknown as typeof fetch)).rejects.toMatchObject({
      code,
      message: `Kushki rechazó la tokenización: estado HTTP ${status}.`,
      originalPayload: { raw: "<html>no es JSON</html>" },
    });
  });

  it.each([{}, { token: "" }, { token: 123 }])("fails with MALFORMED_RESPONSE on a success without a token (%j)", async (body) => {
    const fetchFn = answering(201, body);

    await expect(KushkiTokenizer.tokenize(params(), fetchFn as unknown as typeof fetch)).rejects.toMatchObject({
      code: KitPagosErrorCode.MALFORMED_RESPONSE,
      gateway: Gateway.KUSHKI,
    });
  });

  it("uses the global fetch when none is injected", async () => {
    const originalFetch = globalThis.fetch;
    const fetchFn = answering(201, { token: "tok_global" });
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    try {
      await expect(KushkiTokenizer.tokenize(params())).resolves.toMatchObject({ token: "tok_global" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
