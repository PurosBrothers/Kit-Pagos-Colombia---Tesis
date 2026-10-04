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

  it("tokeniza una tarjeta exitosamente en sandbox por defecto", async () => {
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

  it("garantiza que solo se llama al host de Mercado Pago y a ningún otro", async () => {
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

  it("convierte año de 2 dígitos a 4 dígitos correctamente", async () => {
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

  it("resuelve las URLs base según el catálogo cerrado", () => {
    expect(MercadoPagoTokenizer.resolveBaseUrl("sandbox")).toBe("https://api.mercadopago.com/v1");
    expect(MercadoPagoTokenizer.resolveBaseUrl("production")).toBe("https://api.mercadopago.com/v1");
    expect(MercadoPagoTokenizer.resolveBaseUrl("simulator")).toBe("http://localhost:3000/v1/sim/mercadopago");
  });

  it("ignora una URL colada desde JavaScript: el host sale solo del catálogo", async () => {
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

  it("falla con INVALID_REQUEST antes de la red si falta docType o docNumber", async () => {
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

  it("falla con INVALID_REQUEST antes de la red si faltan datos de tarjeta", async () => {
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

  it("falla con INVALID_CREDENTIALS si no se proporciona publicKey", async () => {
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

  it("traduce respuestas HTTP 401 y 403 a INVALID_CREDENTIALS", async () => {
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

  it("traduce respuestas de error HTTP 400 a INVALID_REQUEST con la causa nativa", async () => {
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

  it("traduce errores de red a CONNECTION_FAILED", async () => {
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

  it("lanza GATEWAY_SERVER_ERROR ante un 5xx de Mercado Pago", async () => {
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

  it("lanza RATE_LIMIT_EXCEEDED ante un 429 de Mercado Pago", async () => {
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

  it("lanza MALFORMED_RESPONSE si la respuesta fue ok pero no incluye id", async () => {
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
