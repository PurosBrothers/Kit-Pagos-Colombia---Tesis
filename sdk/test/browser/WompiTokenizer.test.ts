import { WompiTokenizer } from "../../src-browser/tokenizers/WompiTokenizer";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { CardData } from "../../src-browser/types";

describe("WompiTokenizer", () => {
  const validCard: CardData = {
    number: "4242 4242 4242 4242",
    cvc: "123",
    expMonth: "5",
    expYear: "2030",
    cardHolder: "Juan Perez",
  };

  const mockSuccessResponse = (data: Record<string, unknown> = {}) => {
    return {
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          status: "CREATED",
          data: {
            id: "tok_stag_test123",
            brand: "VISA",
            last_four: "4242",
            ...data,
          },
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

    const result = await WompiTokenizer.tokenize(
      {
        gateway: Gateway.WOMPI,
        publicKey: "pub_test_123456",
        card: validCard,
      },
      mockFetch as unknown as typeof fetch,
    );

    expect(result.token).toBe("tok_stag_test123");
    expect(result.gateway).toBe(Gateway.WOMPI);
    expect(result.lastFour).toBe("4242");
    expect(result.brand).toBe("VISA");
    expect(capturedUrl).toBe("https://sandbox.wompi.co/v1/tokens/cards");
    expect(capturedOptions?.method).toBe("POST");
    expect(capturedOptions?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer pub_test_123456",
    });

    const parsedBody = JSON.parse(capturedOptions?.body as string);
    expect(parsedBody).toEqual({
      number: "4242424242424242", // Espacios eliminados
      cvc: "123",
      exp_month: "05", // Padded a 2 dígitos
      exp_year: "30", // Formateado a 2 dígitos
      card_holder: "Juan Perez",
    });
  });

  it("uses the production URL when that environment is configured", async () => {
    let capturedUrl = "";
    const mockFetch = jest.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return mockSuccessResponse();
    });

    await WompiTokenizer.tokenize(
      {
        gateway: Gateway.WOMPI,
        publicKey: "pub_prod_123456",
        card: validCard,
        environment: "production",
      },
      mockFetch as unknown as typeof fetch,
    );

    expect(capturedUrl).toBe("https://production.wompi.co/v1/tokens/cards");
  });

  it("uses the local simulator URL when environment: simulator is configured", async () => {
    let capturedUrl = "";
    const mockFetch = jest.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return mockSuccessResponse();
    });

    await WompiTokenizer.tokenize(
      {
        gateway: Gateway.WOMPI,
        publicKey: "pub_sim_123456",
        card: validCard,
        environment: "simulator",
      },
      mockFetch as unknown as typeof fetch,
    );

    expect(capturedUrl).toBe("http://localhost:3000/v1/sim/wompi/tokens/cards");
  });

  it.each(["prod", "constructor", "toString", "__proto__"])(
    "rejects the '%s' environment without calling fetch: does not fall back to sandbox or build a relative URL",
    async (environment) => {
      const mockFetch = jest.fn();

      await expect(
        WompiTokenizer.tokenize(
          {
            gateway: Gateway.WOMPI,
            publicKey: "pub_prod_123456",
            card: validCard,
            // Simula a quien llama desde JavaScript con un valor fuera del tipo.
            environment: environment as never,
          },
          mockFetch as unknown as typeof fetch,
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          code: KitPagosErrorCode.INVALID_REQUEST,
          gateway: Gateway.WOMPI,
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
    await WompiTokenizer.tokenize(
      {
        gateway: Gateway.WOMPI,
        publicKey: "pub_test_123",
        card: validCard,
        baseUrl: "https://mi-backend.com",
      } as unknown as Parameters<typeof WompiTokenizer.tokenize>[0],
      mockFetch as unknown as typeof fetch,
    );

    expect(capturedUrl).toBe("https://sandbox.wompi.co/v1/tokens/cards");
  });

  it("fails if required card fields are missing", async () => {
    const incompleteCard = { ...validCard, cvc: "" };

    await expect(
      WompiTokenizer.tokenize({
        gateway: Gateway.WOMPI,
        publicKey: "pub_test_123",
        card: incompleteCard,
      }),
    ).rejects.toThrow(KitPagosError);

    await expect(
      WompiTokenizer.tokenize({
        gateway: Gateway.WOMPI,
        publicKey: "pub_test_123",
        card: incompleteCard,
      }),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.INVALID_REQUEST,
      gateway: Gateway.WOMPI,
    });
  });

  it("fails if the public key is empty", async () => {
    await expect(
      WompiTokenizer.tokenize({
        gateway: Gateway.WOMPI,
        publicKey: "   ",
        card: validCard,
      }),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.INVALID_CREDENTIALS,
      gateway: Gateway.WOMPI,
    });
  });

  it("throws CONNECTION_FAILED when fetch throws a network error", async () => {
    const mockFetch = jest.fn(async () => {
      throw new Error("Failed to fetch / Network disconnected");
    });

    await expect(
      WompiTokenizer.tokenize(
        {
          gateway: Gateway.WOMPI,
          publicKey: "pub_test_123",
          card: validCard,
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.CONNECTION_FAILED,
      gateway: Gateway.WOMPI,
    });
  });

  /** Respuesta de error con status y cuerpo dados. */
  const errorResponse = (status: number, body: unknown) =>
    jest.fn(async () => ({
      ok: false,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    })) as unknown as typeof fetch;

  it("throws INVALID_CREDENTIALS for a nonexistent key, which Wompi answers with 404 MERCHANT_NOT_FOUND (measured 2026-10-03)", async () => {
    const mockFetch = errorResponse(404, {
      error: {
        type: "NOT_FOUND",
        reason: "Comercio con llave pub_test_inexistente no encontrado",
        code: "MERCHANT_NOT_FOUND",
      },
    });

    await expect(
      WompiTokenizer.tokenize(
        { gateway: Gateway.WOMPI, publicKey: "pub_test_inexistente", card: validCard },
        mockFetch,
      ),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.INVALID_CREDENTIALS,
      gateway: Gateway.WOMPI,
    });
  });

  it("names the failing field on the invalid-number 422, which has no reason (measured 2026-10-03)", async () => {
    const mockFetch = errorResponse(422, {
      error: {
        type: "INPUT_VALIDATION_ERROR",
        // El patrón exacto quedó truncado en la medición; se conserva solo el prefijo.
        messages: { number: ["debe coincidir con el patron …"] },
      },
    });

    const error = await WompiTokenizer.tokenize(
      { gateway: Gateway.WOMPI, publicKey: "pub_test_123", card: validCard },
      mockFetch,
    ).catch((e: KitPagosError) => e);

    expect(error).toMatchObject({ code: KitPagosErrorCode.INVALID_REQUEST, gateway: Gateway.WOMPI });
    expect((error as KitPagosError).message).toContain("number");
    expect((error as KitPagosError).message).toContain("debe coincidir con el patron");
  });

  it("throws GATEWAY_SERVER_ERROR on a 5xx, even if the body is not JSON", async () => {
    await expect(
      WompiTokenizer.tokenize(
        { gateway: Gateway.WOMPI, publicKey: "pub_test_123", card: validCard },
        errorResponse(502, "Bad Gateway Error from proxy"),
      ),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.GATEWAY_SERVER_ERROR,
      gateway: Gateway.WOMPI,
    });
  });

  it("throws RATE_LIMIT_EXCEEDED on a 429", async () => {
    await expect(
      WompiTokenizer.tokenize(
        { gateway: Gateway.WOMPI, publicKey: "pub_test_123", card: validCard },
        errorResponse(429, { error: { type: "TOO_MANY_REQUESTS" } }),
      ),
    ).rejects.toMatchObject({ code: KitPagosErrorCode.RATE_LIMIT_EXCEEDED });
  });

  it("throws INVALID_CREDENTIALS on a generic 401", async () => {
    const mockFetch = errorResponse(401, { error: { type: "UNAUTHORIZED" } });

    await expect(
      WompiTokenizer.tokenize(
        {
          gateway: Gateway.WOMPI,
          publicKey: "pub_test_invalid",
          card: validCard,
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.INVALID_CREDENTIALS,
      gateway: Gateway.WOMPI,
    });
  });

  it("throws MALFORMED_RESPONSE if the response was ok but has no data.id", async () => {
    const mockFetch = jest.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: {} }),
      } as unknown as Response;
    });

    await expect(
      WompiTokenizer.tokenize(
        {
          gateway: Gateway.WOMPI,
          publicKey: "pub_test_123",
          card: validCard,
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.MALFORMED_RESPONSE,
      gateway: Gateway.WOMPI,
    });
  });
});
