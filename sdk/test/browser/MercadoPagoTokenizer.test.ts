import { MercadoPagoTokenizer } from "../../src-browser/tokenizers/MercadoPagoTokenizer";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { CardData } from "../../src-browser/types";

describe("MercadoPagoTokenizer", () => {
  const validCard: CardData = {
    number: "4013 5406 8274 6260",
    cvc: "123",
    expMonth: "11",
    expYear: "2030",
    cardHolder: "APRO",
    docType: "CC",
    docNumber: "19119119100",
  };

  const mockSuccessResponse = (data: Record<string, unknown> = {}) => {
    return {
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          id: "tok_test_mp_987654",
          status: "active",
          first_six_digits: "401354",
          last_four_digits: "6260",
          expiration_month: 11,
          expiration_year: 2030,
          cardholder: {
            name: "APRO",
            identification: { type: "CC", number: "19119119100" },
          },
          ...data,
        }),
    } as unknown as Response;
  };

  it("tokenizes a card successfully in sandbox by default", async () => {
    let capturedUrl = "";
    let capturedOptions: RequestInit | undefined;

    const mockFetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedOptions = init;
      return mockSuccessResponse();
    });

    const result = await MercadoPagoTokenizer.tokenize(
      {
        gateway: Gateway.MERCADOPAGO,
        publicKey: "TEST-pub-key-123",
        card: validCard,
      },
      mockFetch as unknown as typeof fetch,
    );

    expect(result.token).toBe("tok_test_mp_987654");
    expect(result.gateway).toBe(Gateway.MERCADOPAGO);
    expect(result.lastFour).toBe("6260");
    expect(capturedUrl).toBe("https://api.mercadopago.com/v1/card_tokens?public_key=TEST-pub-key-123");
    expect(capturedOptions?.method).toBe("POST");
    expect(capturedOptions?.headers).toEqual({
      "Content-Type": "application/json",
    });

    const body = JSON.parse(capturedOptions?.body as string);
    expect(body.card_number).toBe("4013540682746260");
    expect(body.security_code).toBe("123");
    expect(body.expiration_month).toBe(11);
    expect(body.expiration_year).toBe(2030);
    expect(body.cardholder.name).toBe("APRO");
    expect(body.cardholder.identification.type).toBe("CC");
    expect(body.cardholder.identification.number).toBe("19119119100");
  });

  it("ensures only the Mercado Pago host is called and no other", async () => {
    const urlsCalled: string[] = [];
    const mockFetch = jest.fn(async (url: string | URL | Request) => {
      urlsCalled.push(String(url));
      return mockSuccessResponse();
    });

    await MercadoPagoTokenizer.tokenize(
      {
        gateway: Gateway.MERCADOPAGO,
        publicKey: "TEST-pub-key-123",
        card: validCard,
      },
      mockFetch as unknown as typeof fetch,
    );

    expect(urlsCalled).toHaveLength(1);
    expect(urlsCalled[0]).toMatch(/^https:\/\/api\.mercadopago\.com\/v1\/card_tokens/);
    expect(urlsCalled[0]).not.toContain("localhost");
    expect(urlsCalled[0]).not.toContain("wompi");
  });

  it("converts a 2-digit year to 4 digits correctly", async () => {
    let capturedOptions: RequestInit | undefined;
    const mockFetch = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedOptions = init;
      return mockSuccessResponse();
    });

    await MercadoPagoTokenizer.tokenize(
      {
        gateway: Gateway.MERCADOPAGO,
        publicKey: "TEST-pub-key-123",
        card: { ...validCard, expYear: "35" },
      },
      mockFetch as unknown as typeof fetch,
    );

    const body = JSON.parse(capturedOptions?.body as string);
    expect(body.expiration_year).toBe(2035);
  });

  it("resolves the base URLs from the closed catalog", () => {
    expect(MercadoPagoTokenizer.resolveBaseUrl("sandbox")).toBe("https://api.mercadopago.com/v1");
    expect(MercadoPagoTokenizer.resolveBaseUrl("production")).toBe("https://api.mercadopago.com/v1");
    expect(MercadoPagoTokenizer.resolveBaseUrl("simulator")).toBe("http://localhost:3000/v1/sim/mercadopago");
  });

  it.each(["prod", "constructor", "toString", "__proto__"])(
    "rejects the '%s' environment without calling fetch: does not fall back to sandbox or build a relative URL",
    async (environment) => {
      const mockFetch = jest.fn();

      await expect(
        MercadoPagoTokenizer.tokenize(
          {
            gateway: Gateway.MERCADOPAGO,
            publicKey: "APP_USR-public-key",
            card: validCard,
            // Simula a quien llama desde JavaScript con un valor fuera del tipo.
            environment: environment as never,
          },
          mockFetch as unknown as typeof fetch,
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          code: KitPagosErrorCode.INVALID_REQUEST,
          gateway: Gateway.MERCADOPAGO,
        }),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it("ignores a URL smuggled in from JavaScript: the host comes only from the catalog", async () => {
    let capturedUrl = "";
    const mockFetch = jest.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return mockSuccessResponse();
    });

    // El tipo ya no tiene baseUrl; esto simula a quien lo pasa igual desde JS.
    await MercadoPagoTokenizer.tokenize(
      {
        gateway: Gateway.MERCADOPAGO,
        publicKey: "TEST-pub-key-123",
        card: validCard,
        baseUrl: "https://mi-backend.com",
      } as unknown as Parameters<typeof MercadoPagoTokenizer.tokenize>[0],
      mockFetch as unknown as typeof fetch,
    );

    expect(capturedUrl).toBe("https://api.mercadopago.com/v1/card_tokens?public_key=TEST-pub-key-123");
  });

  it("fails with INVALID_REQUEST before the network if docType or docNumber is missing", async () => {
    const mockFetch = jest.fn();

    // Sin docType
    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: { ...validCard, docType: "" },
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(KitPagosError);

    // Sin docNumber
    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: { ...validCard, docNumber: "   " },
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_REQUEST,
        message: expect.stringMatching(/docType y docNumber/),
      }),
    );

    // Sin ambos
    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: {
            number: validCard.number,
            cvc: validCard.cvc,
            expMonth: validCard.expMonth,
            expYear: validCard.expYear,
            cardHolder: validCard.cardHolder,
          },
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_REQUEST,
        message: expect.stringMatching(/docType y docNumber/),
      }),
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails with INVALID_REQUEST before the network if card data is missing", async () => {
    const mockFetch = jest.fn();

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: { ...validCard, number: "" },
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_REQUEST,
      }),
    );

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: { ...validCard, cardHolder: "" },
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_REQUEST,
      }),
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails with INVALID_REQUEST if expMonth or expYear are not valid numbers", async () => {
    const mockFetch = jest.fn();

    // Mes inválido
    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: { ...validCard, expMonth: "13" },
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_REQUEST,
        message: expect.stringMatching(/mes de expiración/i),
      }),
    );

    // Mes no numérico
    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: { ...validCard, expMonth: "abc" },
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_REQUEST,
        message: expect.stringMatching(/mes de expiración/i),
      }),
    );

    // Año no numérico
    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: { ...validCard, expYear: "xyz" },
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_REQUEST,
        message: expect.stringMatching(/año de expiración/i),
      }),
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // `parseInt` aceptaba "12abc" como 12 y "2030x" como 2030 (PR #128, primer comentario del
  // issue #122). El mes tiene uno o dos dígitos y el año dos o cuatro, sin nada más.
  it.each([
    ["expMonth", "12abc", /mes de expiración/i],
    ["expMonth", "1.5", /mes de expiración/i],
    ["expMonth", "123", /mes de expiración/i],
    ["expMonth", "0", /mes de expiración/i],
    ["expMonth", "-1", /mes de expiración/i],
    ["expYear", "2030x", /año de expiración/i],
    ["expYear", "203", /año de expiración/i],
    ["expYear", "20301", /año de expiración/i],
    ["expYear", "3e1", /año de expiración/i],
  ])("fails with INVALID_REQUEST if %s is %p, without calling the network", async (field, value, message) => {
    const mockFetch = jest.fn();

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: { ...validCard, [field]: value },
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_REQUEST,
        message: expect.stringMatching(message),
      }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [" 7 ", " 2031 ", 7, 2031],
    ["07", "31", 7, 2031],
    ["12", "2099", 12, 2099],
  ])("accepts expMonth %p and expYear %p and sends %p/%p", async (expMonth, expYear, month, year) => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "tok_ok" }),
    });

    await MercadoPagoTokenizer.tokenize(
      {
        gateway: Gateway.MERCADOPAGO,
        publicKey: "TEST-pub-key-123",
        card: { ...validCard, expMonth, expYear },
      },
      mockFetch as unknown as typeof fetch,
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.expiration_month).toBe(month);
    expect(body.expiration_year).toBe(year);
  });

  it("fails with INVALID_CREDENTIALS if publicKey is not provided", async () => {
    const mockFetch = jest.fn();

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "   ",
          card: validCard,
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_CREDENTIALS,
      }),
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps HTTP 401 and 403 responses to INVALID_CREDENTIALS", async () => {
    const mockFetch401 = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: "Unauthorized", status: 401 }),
    }));

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-invalid-key",
          card: validCard,
        },
        mockFetch401 as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_CREDENTIALS,
        message: expect.stringMatching(/no autorizada o inválida/),
      }),
    );

    const mockFetch403 = jest.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: "Forbidden", status: 403 }),
    }));

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-forbidden-key",
          card: validCard,
        },
        mockFetch403 as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_CREDENTIALS,
      }),
    );
  });

  it("maps HTTP 400 error responses to INVALID_REQUEST with the native cause", async () => {
    const mockFetch400 = jest.fn(async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          message: "Invalid parameter: card_number",
          cause: [{ description: "Invalid parameter card_number" }],
        }),
    }));

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: validCard,
        },
        mockFetch400 as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.INVALID_REQUEST,
        message: expect.stringContaining("Invalid parameter"),
      }),
    );
  });

  it("maps network errors to CONNECTION_FAILED", async () => {
    const mockFetchNetworkError = jest.fn(async () => {
      throw new Error("Failed to fetch");
    });

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: validCard,
        },
        mockFetchNetworkError as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: KitPagosErrorCode.CONNECTION_FAILED,
        message: expect.stringContaining("Failed to fetch"),
      }),
    );
  });

  it("throws GATEWAY_SERVER_ERROR on a Mercado Pago 5xx", async () => {
    const mockFetch500 = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ message: "Internal Server Error", status: 500 }),
    }));

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: validCard,
        },
        mockFetch500 as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.GATEWAY_SERVER_ERROR,
      gateway: Gateway.MERCADOPAGO,
    });
  });

  it("throws RATE_LIMIT_EXCEEDED on a Mercado Pago 429", async () => {
    const mockFetch429 = jest.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ message: "Too Many Requests", status: 429 }),
    }));

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: validCard,
        },
        mockFetch429 as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.RATE_LIMIT_EXCEEDED,
      gateway: Gateway.MERCADOPAGO,
    });
  });

  it("throws MALFORMED_RESPONSE if the response was ok but has no id", async () => {
    const mockFetchNoId = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: "active" }),
    }));

    await expect(
      MercadoPagoTokenizer.tokenize(
        {
          gateway: Gateway.MERCADOPAGO,
          publicKey: "TEST-pub-key-123",
          card: validCard,
        },
        mockFetchNoId as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.MALFORMED_RESPONSE,
      gateway: Gateway.MERCADOPAGO,
    });
  });
});
