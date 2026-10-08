import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * Los escenarios por datos de prueba vistos desde el SDK (issue #122, pasos 1 y 2).
 *
 * Ninguna petición lleva cabecera de escenario: el comercio solo elige un monto, una
 * tarjeta o un documento, como lo haría contra el sandbox real. Lo que se comprueba es el
 * código de `KitPagosErrorCode` que llega a `POST /v1/api/payments` y a
 * `GET /v1/api/payments/:id`, producido por el SDK instalado.
 *
 * Fuera de este archivo, a propósito: `GATEWAY_TIMEOUT` por el límite de tiempo del cliente,
 * que se prueba contra un servidor propio en `sdk/src/infrastructure/facade/KitPagos.timeout.test.ts`.
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

/** `RetryHandler` espera alrededor de 1 s y 2 s entre los tres intentos del flapping. */
const RETRY_TIMEOUT_MS = 15000;

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
const nextRef = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

const PSE_PAYER = {
  email: "pagador.pse@example.com",
  fullName: "Felipe Ruiz",
  firstName: "Felipe",
  lastName: "Ruiz",
  documentType: "CC",
  documentNumber: "1020304050",
  phone: "3001234567",
  phoneAreaCode: "57",
  address: {
    streetName: "Carrera 7",
    streetNumber: "71-21",
    city: "Bogota",
    zipCode: "110221",
    neighborhood: "Chapinero",
  },
};

const RETURN_URL = { returnUrl: "https://comercio.example.com/retorno" };

/** El cuerpo de `POST /v1/api/payments` de cada camino, con el monto en pesos. */
const PAYMENTS: Record<string, (pesos: number, ref: string) => Record<string, unknown>> = {
  "wompi card": (pesos, ref) => ({
    gateway: "wompi",
    amount: `${pesos}.00`,
    currency: "COP",
    orderReference: ref,
    payer: { email: "comprador@example.com", fullName: "Carlos Gomez" },
    paymentMethod: { type: "CARD", token: "tok_test_wompi_card_123", installments: 1 },
  }),
  "mercadopago card": (pesos, ref) => ({
    gateway: "mercadopago",
    amount: `${pesos}.00`,
    currency: "COP",
    orderReference: ref,
    payer: { email: "comprador@example.com", fullName: "Laura Martinez" },
    paymentMethod: { type: "CARD", token: "tok_test_card_456", installments: 1 },
  }),
  "rapyd card": (pesos, ref) => ({
    gateway: "rapyd",
    amount: `${pesos}.00`,
    currency: "COP",
    orderReference: ref,
    payer: { email: "comprador@example.com", fullName: "Daniel Ochoa" },
  }),
  "kushki card": (pesos, ref) => ({
    gateway: "kushki",
    amount: `${pesos}.00`,
    currency: "COP",
    orderReference: ref,
    payer: { email: "comprador@example.com", fullName: "Laura Martinez" },
    paymentMethod: { type: "CARD", token: `tok_kushki_${ref}`, installments: 1 },
  }),
  "wompi pse": (pesos, ref) => ({
    gateway: "wompi",
    amount: `${pesos}.00`,
    currency: "COP",
    orderReference: ref,
    payer: PSE_PAYER,
    paymentMethod: { type: "PSE", bankCode: "1", payerKind: "NATURAL" },
  }),
  "mercadopago pse": (pesos, ref) => ({
    gateway: "mercadopago",
    amount: `${pesos}.00`,
    currency: "COP",
    orderReference: ref,
    payer: PSE_PAYER,
    paymentMethod: { type: "PSE", bankCode: "1022", payerKind: "NATURAL" },
    returnUrlConfig: RETURN_URL,
    ipAddress: "186.84.90.12",
  }),
  "rapyd pse": (pesos, ref) => ({
    gateway: "rapyd",
    amount: `${pesos}.00`,
    currency: "COP",
    orderReference: ref,
    payer: PSE_PAYER,
    paymentMethod: { type: "PSE", bankCode: "co_pse_bancolombia_bank", payerKind: "NATURAL" },
    returnUrlConfig: RETURN_URL,
  }),
  "kushki pse": (pesos, ref) => ({
    gateway: "kushki",
    amount: `${pesos}.00`,
    currency: "COP",
    orderReference: ref,
    payer: PSE_PAYER,
    paymentMethod: { type: "PSE", bankCode: "0001" },
    returnUrlConfig: RETURN_URL,
  }),
};

const PATHS = Object.keys(PAYMENTS);

function pay(path: string, pesos: number, ref = nextRef(path.replace(" ", "-").toUpperCase())) {
  return app.inject({ method: "POST", url: "/v1/api/payments", payload: PAYMENTS[path](pesos, ref) });
}

function statusOf(gateway: string, id: string) {
  return app.inject({ method: "GET", url: `/v1/api/payments/${id}?gateway=${gateway}` });
}

/** El identificador nativo que devolvió el SDK, venga como transacción o como redirección. */
function createdId(body: {
  transaction?: { gatewayTransactionId: string };
  redirect?: { gatewayTransactionId: string };
}): string {
  return (body.transaction ?? body.redirect)!.gatewayTransactionId;
}

describe("POST /v1/api/payments with a reserved amount and no scenario header", () => {
  const ERROR_ROWS: Array<[number, string, string, number]> = [
    [10429, "RATE_LIMIT", "RATE_LIMIT_EXCEEDED", 429],
    [10500, "SERVER_ERROR, alias INTERNAL_ERROR", "GATEWAY_SERVER_ERROR", 502],
    [10502, "BAD_GATEWAY", "GATEWAY_SERVER_ERROR", 502],
    [10503, "SERVICE_UNAVAILABLE", "GATEWAY_SERVER_ERROR", 502],
    [10504, "TIMEOUT, an immediate 504", "GATEWAY_SERVER_ERROR", 502],
    [10001, "NETWORK_ERROR, alias CONNECTION_ERROR", "CONNECTION_FAILED", 502],
    [10002, "FLAPPING, creation is not retried", "GATEWAY_SERVER_ERROR", 502],
    [10004, "MALFORMED_JSON", "MALFORMED_RESPONSE", 502],
  ];

  const errorCases = PATHS.flatMap((path) =>
    ERROR_ROWS.map(([amount, scenario, code, status]) => [path, amount, scenario, code, status] as const),
  );

  it.each(errorCases)("%s: %d (%s) arrives as %s", async (path, amount, _scenario, code, status) => {
    const res = await pay(path, amount);

    expect(res.statusCode).toBe(status);
    expect(res.json().code).toBe(code);
  });

  /*
   * El cuerpo sin campos llega como `MALFORMED_RESPONSE` en los caminos que normalizan o
   * extraen algo de la respuesta de creación. Wompi PSE y Mercado Pago PSE quedan aparte: ver
   * las dos pruebas siguientes.
   */
  it.each(["wompi card", "mercadopago card", "rapyd card", "kushki card", "rapyd pse", "kushki pse"])(
    "%s: 10005 (MALFORMED_BODY) arrives as MALFORMED_RESPONSE",
    async (path) => {
      const res = await pay(path, 10005);

      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("MALFORMED_RESPONSE");
    },
  );

  /*
   * Wompi PSE no lee nada de la creación: sondea `GET /transactions/{id}` hasta que aparezca
   * la URL del banco, y sin `data.id` el sondeo pide `/transactions/undefined`, que no existe.
   */
  it("wompi pse: 10005 (MALFORMED_BODY) arrives as RESOURCE_NOT_FOUND, from the creation poll", async () => {
    const res = await pay("wompi pse", 10005);

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("RESOURCE_NOT_FOUND");
  });

  it("mercadopago pse: 10005 (MALFORMED_BODY) arrives as MALFORMED_RESPONSE, for the missing bank URL", async () => {
    const res = await pay("mercadopago pse", 10005);

    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("MALFORMED_RESPONSE");
  });

  it.each(PATHS)("%s: 10006 (HTML_ERROR) arrives as GATEWAY_SERVER_ERROR", async (path) => {
    const res = await pay(path, 10006);

    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("GATEWAY_SERVER_ERROR");
  });

  /*
   * Wompi publica la URL del banco junto con el rechazo (medido el 6 de octubre de 2026). Desde
   * la 0.4.0, el SDK mira el estado y solo trata como redirección un `PENDING` con URL.
   */
  it("wompi pse: 10100 (DECLINED) arrives as a DECLINED transaction", async () => {
    const res = await pay("wompi pse", 10100);

    expect(res.statusCode).toBe(201);
    expect(res.json().outcome).toBe("TRANSACTION");
    expect(res.json().transaction.status).toBe("DECLINED");
  });

  describe("10003 (SLOW)", () => {
    const previous = process.env.SIMULATOR_SLOW_RESPONSE_MS;
    beforeAll(() => {
      process.env.SIMULATOR_SLOW_RESPONSE_MS = "30";
    });
    afterAll(() => {
      process.env.SIMULATOR_SLOW_RESPONSE_MS = previous;
    });

    it.each(PATHS)("%s: the late 504 arrives as GATEWAY_SERVER_ERROR", async (path) => {
      const res = await pay(path, 10003);

      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("GATEWAY_SERVER_ERROR");
    });
  });

  it.each(byGateway([10100, 10101, 10102]).filter(([path, amount]) => !(path === "rapyd card" && amount === 10102)))(
    "card: the business amounts arrive as a transaction or a redirect, not as an error (%s)",
    async (path, amount) => {
      const res = await pay(path, amount);

      expect(res.statusCode).toBe(201);
    },
  );

  /*
   * Las rutas que no saben producir el desenlace conservan su `501`, igual que con la
   * cabecera, y el SDK lo traduce como cualquier 5xx.
   */
  it.each([
    ["rapyd card", 10102],
    ["kushki pse", 10102],
  ])("%s: %d keeps the route's 501 and arrives as GATEWAY_SERVER_ERROR", async (path, amount) => {
    const res = await pay(path, amount);

    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("GATEWAY_SERVER_ERROR");
  });

  it("mercadopago pse: 10100 gets the order's native 402, which SDK 0.4 normalizes as DECLINED", async () => {
    const res = await pay("mercadopago pse", 10100);

    expect(res.statusCode).toBe(201);
    expect(res.json().outcome).toBe("TRANSACTION");
    expect(res.json().transaction.status).toBe("DECLINED");
  });

  it.each([
    ["wompi card", 10100, "DECLINED"],
    ["wompi card", 10101, "PENDING"],
    ["wompi card", 10102, "VOIDED"],
    ["mercadopago card", 10100, "DECLINED"],
    ["mercadopago card", 10101, "PENDING"],
    ["mercadopago card", 10102, "VOIDED"],
    ["kushki card", 10100, "DECLINED"],
    ["kushki card", 10101, "PENDING"],
  ])("%s: %d is normalized as %s", async (path, amount, status) => {
    const res = await pay(path, amount);

    expect(res.statusCode).toBe(201);
    expect(res.json().transaction.status).toBe(status);
  });

  it("10409 (DUPLICATE_PAYMENT): the second charge with the same reference gets the native 409", async () => {
    const ref = nextRef("DUP");

    const first = await pay("wompi card", 10409, ref);
    const second = await pay("wompi card", 10409, ref);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(400);
    expect(second.json().code).toBe("INVALID_REQUEST");
  });
});

describe("GET /v1/api/payments/:id with a query failure chosen at creation", () => {
  it.each(PATHS)(
    "%s: 10602 fails twice and RetryHandler ends with the transaction",
    async (path) => {
      const created = await pay(path, 10602);
      expect(created.statusCode).toBe(201);

      const gateway = String(PAYMENTS[path](0, "").gateway);
      const res = await statusOf(gateway, createdId(created.json()));

      expect(res.statusCode).toBe(200);
      expect(res.json().transaction.gatewayTransactionId).toBeDefined();
    },
    RETRY_TIMEOUT_MS,
  );
});

describe("GET /v1/api/pse-banks with a marked credential", () => {
  it.each(["wompi", "mercadopago", "rapyd", "kushki"])(
    "%s: sim_flapping fails twice and RetryHandler ends with the list",
    async (gateway) => {
      // En Rapyd la llave privada es el `secret_key` con que el SDK firma, y el simulador
      // verifica con el de su perfil (punto 86): la marca va solo en la llave pública.
      const privateKey =
        gateway === "rapyd" ? SERVER_CREDENTIALS.RAPYD_API_SECRET_KEY : "prv_test_sim_flapping";
      const res = await app.inject({
        method: "GET",
        url: `/v1/api/pse-banks?gateway=${gateway}`,
        headers: {
          "x-gateway-public-key": "pub_test_sim_flapping",
          "x-gateway-private-key": privateKey,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().pseBanks[0].banks.length).toBeGreaterThan(0);
    },
    RETRY_TIMEOUT_MS,
  );
});

describe("GET /v1/api/payments/:id with a query failure that does not recover", () => {
  /*
   * Una pasarela por camino de consulta: el mecanismo es el mismo en las cuatro, y cada
   * caso espera los tres reintentos de `RetryHandler` (alrededor de 7 s).
   */
  it.each(["wompi card", "mercadopago pse", "rapyd card", "kushki pse"])(
    "%s: 10600 answers 500 every time and arrives as MAX_RETRIES_EXCEEDED",
    async (path) => {
      const created = await pay(path, 10600);
      expect(created.statusCode).toBe(201);

      const gateway = String(PAYMENTS[path](0, "").gateway);
      const res = await statusOf(gateway, createdId(created.json()));

      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("MAX_RETRIES_EXCEEDED");
    },
    RETRY_TIMEOUT_MS,
  );

  it(
    "mercadopago card: 10604 answers SLOW (a late 504) and arrives as MAX_RETRIES_EXCEEDED",
    async () => {
      const previous = process.env.SIMULATOR_SLOW_RESPONSE_MS;
      process.env.SIMULATOR_SLOW_RESPONSE_MS = "30";
      const created = await pay("mercadopago card", 10604);
      expect(created.statusCode).toBe(201);

      const res = await statusOf("mercadopago", createdId(created.json()));
      process.env.SIMULATOR_SLOW_RESPONSE_MS = previous;

      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("MAX_RETRIES_EXCEEDED");
    },
    RETRY_TIMEOUT_MS,
  );
});

describe("business outcomes read back through GET /v1/api/payments/:id", () => {
  it.each([
    ["wompi pse", 10101, "PENDING"],
    ["mercadopago pse", 10101, "PENDING"],
    ["mercadopago pse", 10102, "EXPIRED"],
    ["rapyd pse", 10100, "DECLINED"],
    ["rapyd pse", 10101, "PENDING"],
    ["rapyd pse", 10102, "EXPIRED"],
    ["kushki pse", 10100, "DECLINED"],
    ["kushki pse", 10101, "PENDING"],
    ["wompi card", 10100, "DECLINED"],
    ["mercadopago card", 10100, "DECLINED"],
    ["kushki card", 10100, "DECLINED"],
    ["rapyd card", 10101, "PENDING"],
  ])("%s: %d is read back as %s", async (path, amount, status) => {
    const created = await pay(path, amount);
    expect(created.statusCode).toBe(201);

    const gateway = String(PAYMENTS[path](0, "").gateway);
    const res = await statusOf(gateway, createdId(created.json()));

    expect(res.statusCode).toBe(200);
    expect(res.json().transaction.status).toBe(status);
  });
});

describe("gateway test data through the SDK, without a scenario header", () => {
  it("Wompi: a token of card 4111111111111111 is created PENDING and read back DECLINED", async () => {
    const tokenized = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: { authorization: `Bearer ${SERVER_CREDENTIALS.WOMPI_PUBLIC_KEY}` },
      payload: { number: "4111111111111111", cvc: "123", exp_month: "12", exp_year: "30", card_holder: "Pedro Perez" },
    });
    const payload = PAYMENTS["wompi card"](50000, nextRef("W4111"));
    payload.paymentMethod = { type: "CARD", token: tokenized.json().data.id, installments: 1 };

    const created = await app.inject({ method: "POST", url: "/v1/api/payments", payload });
    const read = await statusOf("wompi", createdId(created.json()));

    expect(created.json().transaction.status).toBe("PENDING");
    expect(read.json().transaction.status).toBe("DECLINED");
  });

  it("Mercado Pago: a token with cardholder OTHE is charged DECLINED", async () => {
    const tokenized = await app.inject({
      method: "POST",
      url: `/v1/sim/mercadopago/card_tokens?public_key=${SERVER_CREDENTIALS.MERCADOPAGO_PUBLIC_KEY}`,
      payload: {
        card_number: "5254133674403564",
        expiration_month: 11,
        expiration_year: 2030,
        security_code: "123",
        cardholder: { name: "OTHE", identification: { type: "CC", number: "123456789" } },
      },
    });
    const payload = PAYMENTS["mercadopago card"](50000, nextRef("MPOTHE"));
    payload.paymentMethod = { type: "CARD", token: tokenized.json().id, installments: 1 };

    const created = await app.inject({ method: "POST", url: "/v1/api/payments", payload });

    expect(created.statusCode).toBe(201);
    expect(created.json().transaction.status).toBe("DECLINED");
  });

  it("Kushki PSE: payer document 100000002 is read back DECLINED", async () => {
    const payload = PAYMENTS["kushki pse"](50000, nextRef("KDOC"));
    payload.payer = { ...PSE_PAYER, documentNumber: "100000002" };

    const created = await app.inject({ method: "POST", url: "/v1/api/payments", payload });
    const read = await statusOf("kushki", createdId(created.json()));

    expect(created.statusCode).toBe(201);
    expect(read.json().transaction.status).toBe("DECLINED");
  });
});

function byGateway(amounts: number[]): Array<[string, number]> {
  return ["wompi card", "mercadopago card", "rapyd card", "kushki card"].flatMap((path) =>
    amounts.map((amount) => [path, amount] as [string, number]),
  );
}
