import { KitPagosBrowser } from "../../src-browser/KitPagosBrowser";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { CardData } from "../../src-browser/types";

describe("KitPagosBrowser", () => {
  const validCard: CardData = {
    number: "4242424242424242",
    cvc: "123",
    expMonth: "12",
    expYear: "2030",
    cardHolder: "Juan Perez",
  };

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("delega la tokenización a WompiTokenizer para Gateway.WOMPI", async () => {
    globalThis.fetch = jest.fn(async () => {
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            status: "CREATED",
            data: {
              id: "tok_test_wompi_success",
              brand: "VISA",
              last_four: "4242",
            },
          }),
      } as unknown as Response;
    });

    const result = await KitPagosBrowser.tokenizeCard({
      gateway: Gateway.WOMPI,
      publicKey: "pub_test_wompi",
      card: validCard,
      environment: "sandbox",
    });

    expect(result.token).toBe("tok_test_wompi_success");
    expect(result.gateway).toBe(Gateway.WOMPI);
    expect(result.lastFour).toBe("4242");
    expect(result.brand).toBe("VISA");
  });

  it("delega la tokenización a MercadoPagoTokenizer para Gateway.MERCADOPAGO", async () => {
    globalThis.fetch = jest.fn(async () => {
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            id: "tok_test_mp_success",
            status: "active",
            last_four_digits: "4242",
            cardholder: {
              name: "APRO",
              identification: { type: "CC", number: "19119119100" },
            },
          }),
      } as unknown as Response;
    });

    const result = await KitPagosBrowser.tokenizeCard({
      gateway: Gateway.MERCADOPAGO,
      publicKey: "TEST-pub-mp",
      card: {
        ...validCard,
        docType: "CC",
        docNumber: "19119119100",
      },
      environment: "sandbox",
    });

    expect(result.token).toBe("tok_test_mp_success");
    expect(result.gateway).toBe(Gateway.MERCADOPAGO);
    expect(result.lastFour).toBe("4242");
  });

  it("permite que el mismo formulario del comercio tokenice en Wompi y en Mercado Pago cambiando solo la pasarela", async () => {
    const unifiedFormCard: CardData = {
      number: "4013540682746260",
      cvc: "123",
      expMonth: "11",
      expYear: "2030",
      cardHolder: "APRO",
      docType: "CC",
      docNumber: "19119119100",
    };

    globalThis.fetch = jest.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("wompi.co")) {
        return {
          ok: true,
          status: 201,
          text: async () =>
            JSON.stringify({
              status: "CREATED",
              data: { id: "tok_wompi_unified", last_four: "6260", brand: "VISA" },
            }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            id: "tok_mp_unified",
            status: "active",
            last_four_digits: "6260",
          }),
      } as unknown as Response;
    });

    // Tokenización contra Wompi con el formulario unificado
    const wompiResult = await KitPagosBrowser.tokenizeCard({
      gateway: "wompi",
      publicKey: "pub_test_wompi",
      card: unifiedFormCard,
    });
    expect(wompiResult.token).toBe("tok_wompi_unified");
    expect(wompiResult.gateway).toBe(Gateway.WOMPI);

    // Tokenización contra Mercado Pago con exactamente el mismo formulario
    const mpResult = await KitPagosBrowser.tokenizeCard({
      gateway: "mercadopago",
      publicKey: "TEST-pub-mp",
      card: unifiedFormCard,
    });
    expect(mpResult.token).toBe("tok_mp_unified");
    expect(mpResult.gateway).toBe(Gateway.MERCADOPAGO);
  });

  it("rechaza Gateway.KUSHKI con UNSUPPORTED_OPERATION sin hacer llamadas de red", async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy;

    await expect(
      KitPagosBrowser.tokenizeCard({
        gateway: Gateway.KUSHKI,
        publicKey: "pub_kushki",
        card: validCard,
      }),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.UNSUPPORTED_OPERATION,
      gateway: Gateway.KUSHKI,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza Gateway.RAPYD con UNSUPPORTED_OPERATION sin hacer llamadas de red", async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy;

    await expect(
      KitPagosBrowser.tokenizeCard({
        gateway: Gateway.RAPYD,
        publicKey: "pub_rapyd",
        card: validCard,
      }),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.UNSUPPORTED_OPERATION,
      gateway: Gateway.RAPYD,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza pasarelas desconocidas con UNSUPPORTED_OPERATION", async () => {
    await expect(
      KitPagosBrowser.tokenizeCard({
        gateway: "STRIPE" as unknown as Gateway,
        publicKey: "pub_stripe",
        card: validCard,
      }),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.UNSUPPORTED_OPERATION,
    });
  });

  it("valida que publicKey esté presente", async () => {
    await expect(
      KitPagosBrowser.tokenizeCard({
        gateway: Gateway.WOMPI,
        publicKey: "   ",
        card: validCard,
      }),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.INVALID_CREDENTIALS,
      gateway: Gateway.WOMPI,
    });
  });

  it("valida que card esté presente", async () => {
    await expect(
      KitPagosBrowser.tokenizeCard({
        gateway: Gateway.WOMPI,
        publicKey: "pub_test_wompi",
        card: null as unknown as CardData,
      }),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.INVALID_REQUEST,
      gateway: Gateway.WOMPI,
    });
  });
});
