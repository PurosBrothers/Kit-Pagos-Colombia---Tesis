import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";
import { resetSimulatorState } from "../src/store/GatewayStores";

const env: Record<string, string | undefined> = {
  KUSHKI_PUBLIC_MERCHANT_ID: "test_kushki_public_key",
  KUSHKI_PRIVATE_MERCHANT_ID: "test_kushki_private_key",
};

/**
 * El `400 K220` de Kushki llega a `/v1/api` con su código y su motivo (issue #153, punto 107).
 *
 * Medido contra Kushki UAT el 17 de octubre de 2026: un token emitido por 48 000 y cobrado por
 * 50 000. Hasta el SDK 0.6.0-rc.4 el mensaje decía solo «Kushki gateway returned an HTTP error
 * status 400»; desde la rc.5 trae el detalle del cuerpo nativo, y el código sigue siendo
 * `INVALID_REQUEST`.
 */
describe("Kushki K220 through /v1/api", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const credentialResolver = new CredentialResolver(env);
    app = buildApp({ logger: false, credentialResolver, kitPagosProvider: new KitPagosProvider(credentialResolver, env) });
    env.SIMULATOR_SDK_BASE_URL = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  beforeEach(() => resetSimulatorState());

  afterAll(async () => {
    await app.close();
  });

  it("should answer INVALID_REQUEST with the native code and reason when the token is charged for another amount", async () => {
    const token = await app.inject({
      method: "POST",
      url: "/v1/sim/kushki/card/v1/tokens",
      headers: { "public-merchant-id": "test_kushki_public_key" },
      payload: {
        card: { name: "APRO Ruiz", number: "4242424242424242", cvv: "123", expiryMonth: "11", expiryYear: "30" },
        totalAmount: 48000,
        currency: "COP",
      },
    });
    expect(token.statusCode).toBe(201);

    const res = await app.inject({
      method: "POST",
      url: "/v1/api/payments",
      payload: {
        gateway: "kushki",
        amount: "50000.00",
        currency: "COP",
        orderReference: `ORDER-K220-${Date.now()}`,
        payer: { email: "pagador.c@example.com", fullName: "Felipe Ruiz" },
        paymentMethod: { type: "CARD", token: token.json().token, installments: 1 },
        returnUrlConfig: { returnUrl: "https://comercio.example.com/?retorno=1" },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: "INVALID_REQUEST",
      message:
        "Kushki gateway returned an HTTP error status 400 " +
        "(K220: Monto de la transacción es diferente al monto de la venta inicial)",
    });
  });
});
