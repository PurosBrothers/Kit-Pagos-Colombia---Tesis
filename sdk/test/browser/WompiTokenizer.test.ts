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

  it("tokeniza una tarjeta exitosamente en sandbox por defecto", async () => {
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

  it("utiliza la URL de production cuando se configura dicho entorno", async () => {
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

  it("utiliza la URL del simulador local cuando se configura environment: simulator", async () => {
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

  it("permite sobreescribir la URL base con customBaseUrl", async () => {
    let capturedUrl = "";
    const mockFetch = jest.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return mockSuccessResponse();
    });

    await WompiTokenizer.tokenize(
      {
        gateway: Gateway.WOMPI,
        publicKey: "pub_test_123",
        card: validCard,
        baseUrl: "http://custom-host:8080/v1",
      },
      mockFetch as unknown as typeof fetch,
    );

    expect(capturedUrl).toBe("http://custom-host:8080/v1/tokens/cards");
  });

  it("falla si faltan campos obligatorios en card", async () => {
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

  it("falla si la clave pública está vacía", async () => {
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

  it("lanza CONNECTION_FAILED cuando fetch lanza un error de red", async () => {
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

  it("lanza INVALID_CREDENTIALS cuando Wompi responde HTTP 401", async () => {
    const mockFetch = jest.fn(async () => {
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { type: "UNAUTHORIZED", reason: "Invalid pub key" } }),
      } as unknown as Response;
    });

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

  it("lanza INVALID_REQUEST con el reason devuelto por Wompi ante un 422", async () => {
    const mockFetch = jest.fn(async () => {
      return {
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify({
            error: {
              type: "INPUT_VALIDATION_ERROR",
              reason: "El número de tarjeta no es válido",
            },
          }),
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
      code: KitPagosErrorCode.INVALID_REQUEST,
      gateway: Gateway.WOMPI,
      message: "El número de tarjeta no es válido",
    });
  });

  it("maneja respuestas de error con formato no-JSON limpiamente", async () => {
    const mockFetch = jest.fn(async () => {
      return {
        ok: false,
        status: 502,
        text: async () => "Bad Gateway Error from proxy",
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
      code: KitPagosErrorCode.INVALID_REQUEST,
      gateway: Gateway.WOMPI,
      message: "Wompi rechazó la tokenización con estado HTTP 502.",
    });
  });

  it("lanza INVALID_REQUEST si la respuesta fue ok pero no incluye data.id", async () => {
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
      code: KitPagosErrorCode.INVALID_REQUEST,
      gateway: Gateway.WOMPI,
    });
  });
});
