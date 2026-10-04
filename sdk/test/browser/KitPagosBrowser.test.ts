import { KitPagosBrowser } from "../../src-browser/KitPagosBrowser";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { BrowserSupportedGateway, CardData } from "../../src-browser/types";

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

  it("lanza UNSUPPORTED_OPERATION para Gateway.MERCADOPAGO (pendiente de issue #127)", async () => {
    await expect(
      KitPagosBrowser.tokenizeCard({
        gateway: Gateway.MERCADOPAGO,
        publicKey: "TEST-pub-mp",
        card: validCard,
      }),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.UNSUPPORTED_OPERATION,
      gateway: Gateway.MERCADOPAGO,
    });
  });

  it("rechaza Gateway.KUSHKI con UNSUPPORTED_OPERATION sin hacer llamadas de red", async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy;

    await expect(
      KitPagosBrowser.tokenizeCard({
        gateway: Gateway.KUSHKI as unknown as BrowserSupportedGateway,
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
        gateway: Gateway.RAPYD as unknown as BrowserSupportedGateway,
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
        gateway: "STRIPE" as unknown as BrowserSupportedGateway,
        publicKey: "pub_stripe",
        card: validCard,
      }),
    ).rejects.toMatchObject({
      code: KitPagosErrorCode.UNSUPPORTED_OPERATION,
      gateway: "STRIPE",
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
