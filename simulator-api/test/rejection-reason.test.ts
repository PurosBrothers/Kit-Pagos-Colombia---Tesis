import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * El motivo de un rechazo, tal como sale por `/v1/api` (issue #109).
 *
 * `fast-json-stringify` serializa la respuesta con el esquema de la ruta y descarta lo que el
 * esquema no declara. Con `code`, `category` y `message` en el esquema y `rejectionCode` y
 * `rejectionCategory` en el `RejectionReason` del SDK, el motivo llegaba como `{}` a cualquier
 * cliente. Por eso la prueba pasa por la ruta real y por el SDK instalado, y no por
 * `serializeTransaction()` sola.
 */

/** Sin `...process.env`, por la misma razón que en `payments.test.ts`. */
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

let app: FastifyInstance;
const testEnv: Record<string, string | undefined> = { ...SERVER_CREDENTIALS };

beforeAll(async () => {
  const credentialResolver = new CredentialResolver(testEnv);
  app = buildApp({
    logger: false,
    credentialResolver,
    kitPagosProvider: new KitPagosProvider(credentialResolver, testEnv),
  });
  // La misma app sirve de simulador: el SDK le cobra por /v1/sim.
  testEnv.SIMULATOR_SDK_BASE_URL = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await app.close();
  resetSimulatorState();
});

let sequence = 0;

async function mercadoPagoCardToken(cardholderName: string): Promise<string> {
  const tokenized = await app.inject({
    method: "POST",
    url: `/v1/sim/mercadopago/card_tokens?public_key=${SERVER_CREDENTIALS.MERCADOPAGO_PUBLIC_KEY}`,
    payload: {
      card_number: "5254133674403564",
      expiration_month: 11,
      expiration_year: 2030,
      security_code: "123",
      cardholder: { name: cardholderName, identification: { type: "CC", number: "123456789" } },
    },
  });
  return tokenized.json().id;
}

function chargeMercadoPagoCard(token: string) {
  return app.inject({
    method: "POST",
    url: "/v1/api/payments",
    payload: {
      gateway: "mercadopago",
      amount: "50000.00",
      currency: "COP",
      orderReference: `MP-REJECTION-${Date.now()}-${++sequence}`,
      payer: { email: "comprador@example.com", fullName: "Laura Martinez" },
      paymentMethod: { type: "CARD", token, installments: 1 },
    },
  });
}

/*
 * El titular decide el rechazo en el simulador (docs/02-arquitectura/3-api-de-simulacion.md,
 * «Los datos de prueba de cada pasarela»), y el SDK 0.6 lo normaliza con su categoría (punto 96).
 */
describe.each([
  ["OTHE Ruiz", "rejected_by_issuer", "UNKNOWN"],
  ["FUND Ruiz", "insufficient_amount", "INSUFFICIENT_FUNDS"],
])("a Mercado Pago card declined for cardholder %s", (cardholder, rejectionCode, rejectionCategory) => {
  it("POST /v1/api/payments returns the SDK's rejectionCode and rejectionCategory", async () => {
    const created = await chargeMercadoPagoCard(await mercadoPagoCardToken(cardholder));

    expect(created.statusCode).toBe(201);
    expect(created.json().transaction.status).toBe("DECLINED");
    expect(created.json().transaction.rejectionReason).toEqual({ rejectionCode, rejectionCategory });
  });

  it("GET /v1/api/payments/:id returns the same rejection reason", async () => {
    const created = await chargeMercadoPagoCard(await mercadoPagoCardToken(cardholder));
    const id = created.json().transaction.gatewayTransactionId;

    const read = await app.inject({ method: "GET", url: `/v1/api/payments/${id}?gateway=mercadopago` });

    expect(read.statusCode).toBe(200);
    expect(read.json().transaction.status).toBe("DECLINED");
    expect(read.json().transaction.rejectionReason).toEqual({ rejectionCode, rejectionCategory });
  });
});

it("an approved transaction has no rejectionReason", async () => {
  const created = await chargeMercadoPagoCard(await mercadoPagoCardToken("APRO Ruiz"));

  expect(created.json().transaction.status).toBe("APPROVED");
  expect(created.json().transaction).not.toHaveProperty("rejectionReason");
});
