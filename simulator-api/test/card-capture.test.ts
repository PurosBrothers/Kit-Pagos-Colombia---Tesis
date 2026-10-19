import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";
import { CARD_CAPTURE_VALUES, cardCaptureByGateway } from "../src/kit-pagos-api/card-capture";
import { SUPPORTED_GATEWAYS } from "../src/kit-pagos-api/gateway-param";

const SERVER_CREDENTIALS = {
  WOMPI_PUBLIC_KEY: "pub_test_wompi_key_123",
  WOMPI_PRIVATE_KEY: "prv_test_wompi_key_456",
  WOMPI_INTEGRITY_SECRET: "test_integrity_secret_789",
  MERCADOPAGO_PUBLIC_KEY: "TEST-mp-public-key",
  MERCADOPAGO_ACCESS_TOKEN: "APP_USR-test-mp-token",
  RAPYD_API_ACCESS_KEY: "test_rapyd_access_key",
  RAPYD_API_SECRET_KEY: "test_rapyd_secret_key",
  KUSHKI_PUBLIC_MERCHANT_ID: "test_kushki_public_key",
  KUSHKI_PRIVATE_MERCHANT_ID: "test_kushki_private_key",
};

/** Qué dice `/v1/api/gateways` de la tarjeta de cada pasarela, y que sea verdad (punto 106). */
describe("cardCapture in GET /v1/api/gateways", () => {
  let app: FastifyInstance;
  const env: Record<string, string | undefined> = { ...SERVER_CREDENTIALS };

  beforeAll(async () => {
    const credentialResolver = new CredentialResolver(env);
    app = buildApp({ logger: false, credentialResolver, kitPagosProvider: new KitPagosProvider(credentialResolver, env) });
    env.SIMULATOR_SDK_BASE_URL = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
  });

  function cardWithoutToken(gateway: string) {
    return app.inject({
      method: "POST",
      url: "/v1/api/payments",
      payload: {
        gateway,
        amount: "48000.00",
        currency: "COP",
        orderReference: `ORDER-CAPTURE-${gateway}-${Date.now()}`,
        payer: { email: "pagador.c@example.com", fullName: "Felipe Ruiz" },
        paymentMethod: { type: "CARD", installments: 1 },
        returnUrlConfig: { returnUrl: "https://comercio.example.com/?retorno=1" },
      },
    });
  }

  it("should say, for each of the four gateways, how it takes the card", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/api/gateways" });

    expect(res.statusCode).toBe(200);
    expect(res.json().cardCapture).toEqual({
      wompi: "BROWSER_TOKEN",
      mercadopago: "BROWSER_TOKEN",
      kushki: "BROWSER_TOKEN",
      rapyd: "HOSTED_PAGE",
    });
  });

  it("should declare a mode for every gateway it lists, and only known modes", () => {
    const capture = cardCaptureByGateway();

    expect(Object.keys(capture).sort()).toEqual([...SUPPORTED_GATEWAYS].sort());
    for (const mode of Object.values(capture)) {
      expect(CARD_CAPTURE_VALUES).toContain(mode);
    }
  });

  it.each(Object.entries(cardCaptureByGateway()).filter(([, mode]) => mode === "HOSTED_PAGE"))(
    "should redirect %s to its hosted page when the card comes without a token",
    async (gateway) => {
      const res = await cardWithoutToken(gateway);

      expect(res.statusCode).toBe(201);
      expect(res.json().outcome).toBe("REDIRECT_REQUIRED");
      expect(res.json().redirect.redirectUrl).toBeTruthy();
    },
  );

  it.each(Object.entries(cardCaptureByGateway()).filter(([, mode]) => mode === "BROWSER_TOKEN"))(
    "should reject a card without a token in %s, which needs one from the browser",
    async (gateway) => {
      const res = await cardWithoutToken(gateway);

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_REQUEST");
    },
  );
});
