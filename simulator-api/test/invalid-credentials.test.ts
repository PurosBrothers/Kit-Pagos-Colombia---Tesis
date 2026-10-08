import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * La credencial inválida de cada pasarela (issue #122).
 *
 * Una credencial que contiene `invalid`, `inexistente` o `not_found` produce la respuesta
 * medida contra el sandbox real el 6 de octubre de 2026 (`docs/testing-data/`, secciones de
 * credenciales inválidas). La cabecera de escenario sigue ganando; la credencial gana sobre
 * los datos de prueba y el monto.
 */

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

const WOMPI_CREATE_401 = { error: { type: "INVALID_ACCESS_TOKEN", reason: "Llave no válida" } };
const WOMPI_QUERY_403 = {
  error: { type: "INVALID_ACCESS_TOKEN", reason: "El token no tiene suficientes permisos" },
};
const WOMPI_NOT_FOUND = { error: { type: "NOT_FOUND_ERROR", reason: "La entidad solicitada no existe" } };
const MP_CREATE_401 = { code: "unauthorized", message: "user not found" };
const MP_QUERY_401 = { code: "unauthorized", message: "invalid access token" };
const MP_PAYMENT_METHODS_401 = { message: "invalid_token", error: "not_found", status: 401, cause: [] };
const KUSHKI_TRANSFER_403 = {
  Message:
    "User is not authorized to access this resource because no identity-based policy allows the execute-api:Invoke action",
};
const KUSHKI_CARD_K004 = { message: "ID de comercio o credencial no válido", code: "K004" };
const RAPYD_401_STATUS = {
  error_code: "UNAUTHENTICATED_API_CALL",
  status: "ERROR",
  message:
    "The request was rejected due to an authentication issue. Corrective action: Check the status of your account in the 'Account Details' page of the Client Portal.",
  response_code: "UNAUTHENTICATED_API_CALL",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const KUSHKI_TOKEN_32 = "a".repeat(32);

let app: FastifyInstance;
const testEnv: Record<string, string | undefined> = { ...SERVER_CREDENTIALS };

beforeAll(async () => {
  const credentialResolver = new CredentialResolver(testEnv);
  app = buildApp({
    logger: false,
    credentialResolver,
    kitPagosProvider: new KitPagosProvider(credentialResolver, testEnv),
  });
  testEnv.SIMULATOR_SDK_BASE_URL = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await app.close();
  resetSimulatorState();
});

let sequence = 0;
const nextRef = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

type Headers = Record<string, string>;

const wompiCharge = (headers: Headers, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/v1/sim/wompi/transactions",
    headers,
    payload: {
      amount_in_cents: 5000000,
      currency: "COP",
      reference: nextRef("W"),
      customer_email: "comprador@example.com",
      payment_method: { type: "CARD", token: "tok_test_wompi_card_123", installments: 1 },
      ...payload,
    },
  });

const mpPayment = (headers: Headers) =>
  app.inject({
    method: "POST",
    url: "/v1/sim/mercadopago/payments",
    headers: { "x-idempotency-key": nextRef("IDEM"), ...headers },
    payload: {
      transaction_amount: 50000,
      token: "tok_test_card_456",
      description: "Compra",
      installments: 1,
      payment_method_id: "visa",
      payer: { email: "comprador@example.com" },
    },
  });

const mpOrder = (headers: Headers) =>
  app.inject({
    method: "POST",
    url: "/v1/sim/mercadopago/orders",
    headers: { "x-idempotency-key": nextRef("IDEM"), ...headers },
    payload: {
      type: "online",
      external_reference: nextRef("MPO"),
      total_amount: "50000",
      processing_mode: "automatic",
      transactions: {
        payments: [{ amount: "50000", payment_method: { id: "pse", type: "bank_transfer" } }],
      },
      payer: { email: "pagador@example.com" },
    },
  });

const kushkiCharge = (headers: Headers, token = "simulated-token") =>
  app.inject({
    method: "POST",
    url: "/v1/sim/kushki/card/v1/charges",
    headers,
    payload: {
      token,
      amount: { subtotalIva0: 50000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
    },
  });

const kushkiTransferToken = (headers: Headers) =>
  app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/tokens",
    headers,
    payload: {
      amount: { subtotalIva0: 50000, subtotalIva: 0, iva: 0 },
      bankId: "0001",
      callbackUrl: "https://comercio.example.com/retorno",
      userType: "0",
      documentType: "CC",
      documentNumber: "1020304050",
      paymentDescription: nextRef("KT"),
      email: "pagador@example.com",
      currency: "COP",
    },
  });

const rapydCheckout = (headers: Headers) =>
  app.inject({
    method: "POST",
    url: "/v1/sim/rapyd/checkout",
    headers,
    payload: { amount: "50000.00", currency: "COP", country: "CO", merchant_reference_id: nextRef("R") },
  });

describe("/v1/sim: a credential with an invalid marker", () => {
  describe("Wompi", () => {
    it.each(["prv_test_invalid", "prv_test_inexistente", "prv_test_not_found", "pub_test_invalid"])(
      "POST /transactions with %s answers the measured 401",
      async (key) => {
        const res = await wompiCharge({ authorization: `Bearer ${key}` });

        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual(WOMPI_CREATE_401);
      },
    );

    it("POST /transactions without payment_method answers 422 first, as measured with body {}", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/sim/wompi/transactions",
        headers: { authorization: "Bearer prv_test_invalid" },
        payload: {},
      });

      expect(res.statusCode).toBe(422);
    });

    it("the credential wins over the reserved amount and over card 4111", async () => {
      const tokenized = await app.inject({
        method: "POST",
        url: "/v1/sim/wompi/tokens/cards",
        headers: { authorization: "Bearer pub_test_abc" },
        payload: { number: "4111111111111111", cvc: "123", exp_month: "12", exp_year: "30", card_holder: "Pedro Perez" },
      });
      const headers = { authorization: "Bearer prv_test_invalid" };

      const byAmount = await wompiCharge(headers, { amount_in_cents: 10100 * 100 });
      const byCard = await wompiCharge(headers, {
        payment_method: { type: "CARD", token: tokenized.json().data.id, installments: 1 },
      });

      expect(byAmount.statusCode).toBe(401);
      expect(byCard.statusCode).toBe(401);
    });

    it("a scenario header wins over the credential", async () => {
      const res = await wompiCharge({
        authorization: "Bearer prv_test_invalid",
        "x-simulator-scenario": "APPROVED",
      });

      expect(res.statusCode).toBe(201);
    });

    it("the header INVALID_CREDENTIALS gives the same 401 with an ordinary key", async () => {
      const res = await wompiCharge({
        authorization: "Bearer prv_test_ordinary",
        "x-simulator-scenario": "INVALID_CREDENTIALS",
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(WOMPI_CREATE_401);
    });

    it("GET /transactions/:id answers 403 to a private marker and 200 to a public one, as measured", async () => {
      const id = (await wompiCharge({})).json().data.id;
      const url = `/v1/sim/wompi/transactions/${id}`;
      const get = (headers: Headers = {}) => app.inject({ method: "GET", url, headers });

      const privateMarker = await get({ authorization: "Bearer prv_test_invalid" });
      const publicMarker = await get({ authorization: "Bearer pub_test_invalid" });
      const none = await get();
      const ordinary = await get({ authorization: "Bearer pub_test_abc" });

      expect(privateMarker.statusCode).toBe(403);
      expect(privateMarker.json()).toEqual(WOMPI_QUERY_403);
      expect(publicMarker.statusCode).toBe(200);
      expect(publicMarker.json().data.id).toBe(id);
      expect(none.statusCode).toBe(200);
      expect(ordinary.statusCode).toBe(200);
    });

    it("GET /transactions/:id with the header INVALID_CREDENTIALS answers 403 only to a private key", async () => {
      const id = (await wompiCharge({})).json().data.id;
      const get = (key: string) =>
        app.inject({
          method: "GET",
          url: `/v1/sim/wompi/transactions/${id}`,
          headers: { authorization: `Bearer ${key}`, "x-simulator-scenario": "INVALID_CREDENTIALS" },
        });

      expect((await get("prv_test_ordinary")).statusCode).toBe(403);
      expect((await get("pub_test_ordinary")).statusCode).toBe(200);
    });

    it("GET /merchants/:key with a marker answers the measured 404, with or without Authorization", async () => {
      const merchant = (key: string, headers: Headers = {}) =>
        app.inject({ method: "GET", url: `/v1/sim/wompi/merchants/${key}`, headers });

      const withAuth = await merchant("pub_test_invalid", { authorization: "Bearer pub_test_invalid" });
      const withoutAuth = await merchant("pub_test_inexistente");
      const byHeader = await merchant("pub_test_ordinary", { "x-simulator-scenario": "INVALID_CREDENTIALS" });
      const ordinary = await merchant("pub_test_ordinary");

      for (const res of [withAuth, withoutAuth, byHeader]) {
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual(WOMPI_NOT_FOUND);
      }
      expect(ordinary.statusCode).toBe(200);
    });

    it.each(["pub_test_invalid", "prv_test_invalid"])(
      "GET /pse/financial_institutions with %s still answers the three banks, as measured",
      async (key) => {
        const res = await app.inject({
          method: "GET",
          url: "/v1/sim/wompi/pse/financial_institutions",
          headers: { authorization: `Bearer ${key}` },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().data).toHaveLength(3);
      },
    );

    it("tokens/cards keeps its measured 404 MERCHANT_NOT_FOUND", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/sim/wompi/tokens/cards",
        headers: { authorization: "Bearer pub_test_invalid" },
        payload: { number: "4242424242424242", cvc: "123", exp_month: "12", exp_year: "30", card_holder: "Pedro" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("MERCHANT_NOT_FOUND");
    });
  });

  describe("Wompi card 4111, measured on 6 Oct 2026", () => {
    it("is read back DECLINED with the sandbox status_message; 4242 is APPROVED without one", async () => {
      const tokenize = (number: string) =>
        app.inject({
          method: "POST",
          url: "/v1/sim/wompi/tokens/cards",
          headers: { authorization: "Bearer pub_test_abc" },
          payload: { number, cvc: "123", exp_month: "12", exp_year: "30", card_holder: "Pedro Perez" },
        });
      const charge = async (number: string) => {
        const token = (await tokenize(number)).json().data.id;
        const created = await wompiCharge({}, { payment_method: { type: "CARD", token, installments: 1 } });
        return app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${created.json().data.id}` });
      };

      const declined = (await charge("4111111111111111")).json().data;
      const approved = (await charge("4242424242424242")).json().data;

      expect(declined.status).toBe("DECLINED");
      expect(declined.status_message).toBe("La transacción fue rechazada (Sandbox)");
      expect(approved.status).toBe("APPROVED");
      expect(approved.status_message).toBeUndefined();
    });
  });

  describe("Mercado Pago", () => {
    const invalid = { authorization: "Bearer APP_USR-invalid-token" };

    it("POST /payments answers the measured 401 user not found", async () => {
      const res = await mpPayment(invalid);

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(MP_CREATE_401);
    });

    it("GET /payments/:id answers the measured 401 invalid access token", async () => {
      const id = (await mpPayment({})).json().id;

      const res = await app.inject({ method: "GET", url: `/v1/sim/mercadopago/payments/${id}`, headers: invalid });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(MP_QUERY_401);
    });

    it("POST /orders and GET /orders/:id both answer the measured 401 invalid access token", async () => {
      const created = await mpOrder({});
      expect(created.statusCode).toBe(201);

      const create = await mpOrder(invalid);
      const query = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/orders/${created.json().id}`,
        headers: invalid,
      });

      expect(create.statusCode).toBe(401);
      expect(create.json()).toEqual(MP_QUERY_401);
      expect(query.statusCode).toBe(401);
      expect(query.json()).toEqual(MP_QUERY_401);
    });

    it("GET /payment_methods answers the measured 401 invalid_token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/sim/mercadopago/payment_methods", headers: invalid });
      const ordinary = await app.inject({
        method: "GET",
        url: "/v1/sim/mercadopago/payment_methods",
        headers: { authorization: "Bearer APP_USR-test-mp-token" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(MP_PAYMENT_METHODS_401);
      expect(ordinary.statusCode).toBe(200);
    });

    it("the credential wins over the cardholder name OTHE", async () => {
      const tokenized = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
        payload: {
          card_number: "5254133674403564",
          expiration_month: 11,
          expiration_year: 2030,
          security_code: "123",
          cardholder: { name: "OTHE", identification: { type: "CC", number: "123456789" } },
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/payments",
        headers: { "x-idempotency-key": nextRef("IDEM"), ...invalid },
        payload: {
          transaction_amount: 50000,
          token: tokenized.json().id,
          description: "Compra",
          installments: 1,
          payment_method_id: "master",
          payer: { email: "comprador@example.com" },
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("Kushki", () => {
    it("GET transfer/v1/bankList with an invalid Public-Merchant-Id answers the measured 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/bankList",
        headers: { "public-merchant-id": "kushki_invalid_public" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(KUSHKI_TRANSFER_403);
    });

    it("POST transfer/v1/tokens answers the measured 403", async () => {
      const res = await kushkiTransferToken({ "public-merchant-id": "kushki_invalid_public" });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(KUSHKI_TRANSFER_403);
    });

    it("POST transfer/v1/init answers the measured 403 and does not move the transfer", async () => {
      const token = (await kushkiTransferToken({})).json().token;

      const res = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        headers: { "private-merchant-id": "kushki_invalid_private" },
        payload: { token, amount: { subtotalIva0: 50000, subtotalIva: 0, iva: 0 } },
      });
      const status = await app.inject({ method: "GET", url: `/v1/sim/kushki/transfer/v1/status/${token}` });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(KUSHKI_TRANSFER_403);
      expect(status.json().status).toBe("requestedToken");
    });

    it("GET transfer/v1/status/:token answers the measured 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${KUSHKI_TOKEN_32}`,
        headers: { "private-merchant-id": "kushki_invalid_private" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(KUSHKI_TRANSFER_403);
    });

    it("POST card/v1/charges answers 400 K004, checked before the K001 of a malformed token", async () => {
      const res = await kushkiCharge({ "private-merchant-id": "kushki_invalid_private" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual(KUSHKI_CARD_K004);
    });

    it("the credential wins over the reserved amount on the card charge", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "private-merchant-id": "kushki_not_found" },
        payload: {
          token: "tok_kushki_valid",
          amount: { subtotalIva0: 10100, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("K004");
    });
  });

  describe("Rapyd", () => {
    const invalid = { access_key: "rapyd_invalid_access_key" };

    async function routes() {
      const payment = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: invalid,
        payload: { amount: "50000.00", currency: "COP", payment_method: { type: "co_pse_bancolombia_bank" } },
      });
      const checkout = await rapydCheckout(invalid);
      const existingCheckout = (await rapydCheckout({})).json().data.id;
      const checkoutQuery = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/checkout/${existingCheckout}`,
        headers: invalid,
      });
      const paymentQuery = await app.inject({
        method: "GET",
        url: "/v1/sim/rapyd/payments/payment_whatever",
        headers: invalid,
      });
      const customer = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/customers",
        headers: invalid,
        payload: { name: "Felipe Ruiz", email: "pagador@example.com" },
      });
      const banks = await app.inject({
        method: "GET",
        url: "/v1/sim/rapyd/payment_methods/country?country=CO&currency=COP",
        headers: invalid,
      });
      return { payment, checkout, checkoutQuery, paymentQuery, customer, banks };
    }

    it("every route answers the measured 401 UNAUTHENTICATED_API_CALL with a fresh operation_id", async () => {
      const responses = await routes();

      for (const [route, res] of Object.entries(responses)) {
        expect([route, res.statusCode]).toEqual([route, 401]);
        const { operation_id, ...status } = res.json().status;
        expect(status).toEqual(RAPYD_401_STATUS);
        expect(operation_id).toMatch(UUID);
      }
      expect(responses.payment.json().status.operation_id).not.toBe(
        responses.checkout.json().status.operation_id,
      );
    });

    it("a scenario header wins over the credential", async () => {
      const res = await rapydCheckout({ ...invalid, "x-simulator-scenario": "APPROVED" });

      expect(res.statusCode).toBe(200);
    });
  });
});

describe("/v1/api: the invalid credential as the SDK reports it", () => {
  const clientKeys = (publicKey: string, privateKey: string) => ({
    "x-gateway-public-key": publicKey,
    "x-gateway-private-key": privateKey,
  });

  const PSE_PAYER = {
    email: "pagador.pse@example.com",
    fullName: "Felipe Ruiz",
    firstName: "Felipe",
    lastName: "Ruiz",
    documentType: "CC",
    documentNumber: "1020304050",
    phone: "3001234567",
    phoneAreaCode: "57",
  };

  const card = (gateway: string, token: string) => ({
    gateway,
    amount: "50000.00",
    currency: "COP",
    orderReference: nextRef(gateway.toUpperCase()),
    payer: { email: "comprador@example.com", fullName: "Laura Martinez" },
    paymentMethod: { type: "CARD", token, installments: 1 },
  });

  const PAYLOADS: Record<string, () => Record<string, unknown>> = {
    wompi: () => card("wompi", "tok_test_wompi_card_123"),
    mercadopago: () => card("mercadopago", "tok_test_card_456"),
    rapyd: () => ({
      gateway: "rapyd",
      amount: "50000.00",
      currency: "COP",
      orderReference: nextRef("RAPYD"),
      payer: { email: "comprador@example.com", fullName: "Daniel Ochoa" },
    }),
    kushki: () => card("kushki", `tok_kushki_${nextRef("K")}`),
    "kushki pse": () => ({
      gateway: "kushki",
      amount: "50000.00",
      currency: "COP",
      orderReference: nextRef("KPSE"),
      payer: PSE_PAYER,
      paymentMethod: { type: "PSE", bankCode: "0001" },
      returnUrlConfig: { returnUrl: "https://comercio.example.com/retorno" },
    }),
  };

  /** La llave que lleva la marca es la que cada adaptador manda a esa ruta. */
  const INVALID_KEYS: Record<string, Headers> = {
    // Con el secreto de integridad: sin él, el SDK rechaza la configuración antes de llamar
    // a la pasarela, y la prueba pasaría sin que el simulador respondiera nada.
    wompi: {
      ...clientKeys("pub_test_invalid", "prv_test_invalid"),
      "x-gateway-integrity-secret": "test_integrity_secret_789",
    },
    mercadopago: clientKeys("TEST-invalid-public", "APP_USR-invalid-token"),
    rapyd: clientKeys("rapyd_invalid_access_key", "rapyd_secret_key"),
    kushki: clientKeys("kushki_invalid_public", "kushki_invalid_private"),
    "kushki pse": clientKeys("kushki_invalid_public", "kushki_invalid_private"),
  };

  const create = (path: string, headers: Headers = {}) =>
    app.inject({ method: "POST", url: "/v1/api/payments", headers, payload: PAYLOADS[path]() });

  function createdIdOf(created: Awaited<ReturnType<typeof create>>): string {
    expect(created.statusCode).toBe(201);
    const body = created.json();
    return (body.transaction ?? body.redirect).gatewayTransactionId;
  }

  it.each(["mercadopago", "rapyd", "kushki pse", "kushki", "wompi"])(
    "%s: POST /v1/api/payments arrives as INVALID_CREDENTIALS",
    async (path) => {
      const res = await create(path, INVALID_KEYS[path]);

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("INVALID_CREDENTIALS");
    },
  );

  // El SDK consulta con la llave pública, y Wompi lee la transacción con una pública
  // inexistente (medido el 6 de octubre de 2026).
  it("wompi: GET /v1/api/payments/:id with the invalid public key succeeds, as measured", async () => {
    const id = createdIdOf(await create("wompi"));

    const res = await app.inject({
      method: "GET",
      url: `/v1/api/payments/${id}?gateway=wompi`,
      headers: INVALID_KEYS.wompi,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().transaction.gatewayTransactionId).toBe(id);
  });

  // Wompi entrega la lista de bancos a una llave pública inexistente (medido el 6 de octubre).
  it("wompi: GET /v1/api/pse-banks with the invalid public key succeeds, as measured", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/api/pse-banks?gateway=wompi", headers: INVALID_KEYS.wompi });

    expect(res.statusCode).toBe(200);
  });

  it("mercadopago: GET /v1/api/pse-banks with the invalid token arrives as INVALID_CREDENTIALS", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/api/pse-banks?gateway=mercadopago",
      headers: INVALID_KEYS.mercadopago,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("INVALID_CREDENTIALS");
  });

  it.each(["mercadopago", "rapyd", "kushki", "kushki pse"])(
    "%s: GET /v1/api/payments/:id with the invalid key arrives as INVALID_CREDENTIALS",
    async (path) => {
      const id = createdIdOf(await create(path));
      const gateway = String(PAYLOADS[path]().gateway);

      const res = await app.inject({
        method: "GET",
        url: `/v1/api/payments/${id}?gateway=${gateway}`,
        headers: INVALID_KEYS[path],
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("INVALID_CREDENTIALS");
    },
  );
});
