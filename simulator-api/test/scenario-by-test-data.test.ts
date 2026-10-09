import { buildSignedApp as buildApp } from "./helpers/signedRequests";
import * as credentialResolver from "../src/auth/CredentialResolver";
import { slowResponseDelayMs } from "../src/scenarios/technicalFailure";
import { cardTokenOutcomeFor } from "../src/store/CardTokenOutcomes";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * El escenario se elige con los datos del cobro, sin cabecera (issue #122, pasos 1 y 2).
 *
 * El orden es: cabecera > dato de prueba de la pasarela > monto reservado > `APPROVED`.
 * Estas pruebas recorren `/v1/sim` con `app.inject`; las que pasan por el SDK están en
 * `scenario-through-sdk.test.ts`.
 */

type App = ReturnType<typeof buildApp>;
type Res = Awaited<ReturnType<App["inject"]>>;
type Headers = Record<string, string>;

const H = (scenario: string): Headers => ({ "x-simulator-scenario": scenario });

/** Un monto que no está en ninguna tabla. */
const NEUTRAL_PESOS = 10000;

let sequence = 0;
const nextRef = (prefix: string) => `${prefix}-${++sequence}`;

const kushkiAmount = (pesos: number) => ({
  subtotalIva0: pesos,
  subtotalIva: 0,
  iva: 0,
  ice: 0,
  currency: "COP",
});

/** Un camino de creación y consulta de una pasarela, tal como lo recorre el SDK. */
interface Flow {
  name: string;
  /** Crea el cobro. `ref` permite repetir la misma referencia de negocio. */
  create(app: App, pesos: number, headers?: Headers, ref?: string): Promise<Res>;
  /** El identificador con el que se consulta, o `undefined` si la respuesta no lo trae. */
  idOf(body: unknown): string | undefined;
  /** Lo que hace el SDK entre la creación y la primera consulta del comercio. */
  prepareQuery?(app: App, id: string): Promise<void>;
  /** La consulta de estado. */
  query(app: App, id: string): Promise<Res>;
  /** El estado nativo final, después de recorrer el ciclo completo. */
  settle(app: App, id: string): Promise<string>;
}

const wompiCard: Flow = {
  name: "Wompi card",
  create: (app, pesos, headers = {}, ref = nextRef("W")) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers,
      payload: {
        amount_in_cents: pesos * 100,
        currency: "COP",
        reference: ref,
        customer_email: "comprador@example.com",
        payment_method: { type: "CARD", token: "tok_test_fake", installments: 1 },
      },
    }),
  idOf: (body) => (body as { data?: { id?: string } })?.data?.id,
  query: (app, id) => app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` }),
  settle: async (app, id) => (await wompiCard.query(app, id)).json().data.status,
};

const wompiPse: Flow = {
  name: "Wompi PSE",
  create: (app, pesos, headers = {}, ref = nextRef("WPSE")) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers,
      payload: {
        amount_in_cents: pesos * 100,
        currency: "COP",
        reference: ref,
        customer_email: "comprador@example.com",
        redirect_url: "https://comercio.example.com/retorno",
        payment_method: {
          type: "PSE",
          user_type: 0,
          user_legal_id_type: "CC",
          user_legal_id: "1099888777",
          financial_institution_code: "1",
          payment_description: `Pago ${ref}`,
        },
      },
    }),
  idOf: wompiCard.idOf,
  // El SDK consulta una vez al crear, para obtener la URL del banco (`resolvePendingRedirect`).
  prepareQuery: async (app, id) => {
    await wompiCard.query(app, id);
  },
  query: wompiCard.query,
  settle: async (app, id) => {
    await wompiCard.query(app, id);
    return (await wompiCard.query(app, id)).json().data.status;
  },
};

let idempotency = 0;
const mpHeaders = (headers: Headers) => ({ ...headers, "x-idempotency-key": `idem-${++idempotency}` });

const mercadoPagoCard: Flow = {
  name: "Mercado Pago card",
  create: (app, pesos, headers = {}, ref = nextRef("MP")) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/payments",
      headers: mpHeaders(headers),
      payload: {
        transaction_amount: pesos,
        description: ref,
        external_reference: ref,
        token: "a1b2c3d4e5f6",
        installments: 1,
        payer: { email: "comprador@example.com" },
      },
    }),
  idOf: (body) => {
    const id = (body as { id?: number | string })?.id;
    return id === undefined ? undefined : String(id);
  },
  query: (app, id) => app.inject({ method: "GET", url: `/v1/sim/mercadopago/payments/${id}` }),
  settle: async (app, id) => (await mercadoPagoCard.query(app, id)).json().status,
};

const mercadoPagoPse: Flow = {
  name: "Mercado Pago PSE",
  create: (app, pesos, headers = {}, ref = nextRef("MPO")) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/orders",
      headers: mpHeaders(headers),
      payload: {
        type: "online",
        total_amount: String(pesos),
        external_reference: ref,
        payer: { email: "comprador@example.com" },
        transactions: {
          payments: [
            {
              amount: String(pesos),
              payment_method: { id: "pse", type: "bank_transfer", financial_institution: "1051" },
            },
          ],
        },
      },
    }),
  idOf: (body) => (body as { id?: string })?.id,
  query: (app, id) => app.inject({ method: "GET", url: `/v1/sim/mercadopago/orders/${id}` }),
  settle: async (app, id) => (await mercadoPagoPse.query(app, id)).json().status,
};

const rapydCard: Flow = {
  name: "Rapyd card",
  create: (app, pesos, headers = {}, ref = nextRef("RCHK")) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/rapyd/checkout",
      headers,
      payload: {
        amount: pesos.toFixed(2),
        currency: "COP",
        country: "CO",
        merchant_reference_id: ref,
        payment_method_type_categories: ["card"],
      },
    }),
  idOf: (body) => (body as { data?: { id?: string } })?.data?.id,
  query: (app, id) => app.inject({ method: "GET", url: `/v1/sim/rapyd/checkout/${id}` }),
  settle: async (app, id) => {
    const visit = await app.inject({ method: "GET", url: `/v1/sim/rapyd/checkout/${id}/pay` });
    const payment = await app.inject({
      method: "GET",
      url: `/v1/sim/rapyd/payments/${visit.json().payment_id}`,
    });
    return payment.json().data.status;
  },
};

const rapydPse: Flow = {
  name: "Rapyd PSE",
  create: (app, pesos, headers = {}, ref = nextRef("RPSE")) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/rapyd/payments",
      headers,
      payload: {
        amount: pesos,
        currency: "COP",
        merchant_reference_id: ref,
        customer: "cus_123",
        payment_method: { type: "co_pse_bancolombia_bank" },
      },
    }),
  idOf: (body) => (body as { data?: { id?: string } })?.data?.id,
  query: (app, id) => app.inject({ method: "GET", url: `/v1/sim/rapyd/payments/${id}` }),
  settle: async (app, id) => (await rapydPse.query(app, id)).json().data.status,
};

const kushkiCard: Flow = {
  name: "Kushki card",
  create: (app, pesos, headers = {}, ref = nextRef("K")) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/kushki/card/v1/charges",
      headers,
      payload: {
        token: `tok_kushki_${ref}`,
        trackingCode: ref,
        amount: kushkiAmount(pesos),
        contactDetails: { email: "comprador@example.com" },
      },
    }),
  idOf: (body) => (body as { ticketNumber?: string })?.ticketNumber,
  query: (app, id) => app.inject({ method: "GET", url: `/v1/sim/kushki/charges/${id}` }),
  settle: async (app, id) => (await kushkiCard.query(app, id)).json().details.transactionStatus,
};

const kushkiTransferToken = (
  app: App,
  pesos: number,
  headers: Headers = {},
  ref = nextRef("KPSE"),
  documentNumber = "1020304050",
) =>
  app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/tokens",
    headers,
    payload: {
      bankId: "007",
      callbackUrl: "https://comercio.example.com/retorno",
      userType: "0",
      documentType: "CC",
      documentNumber,
      email: "comprador@example.com",
      currency: "COP",
      paymentDescription: ref,
      amount: kushkiAmount(pesos),
    },
  });

const kushkiInit = (app: App, token: string, headers: Headers = {}) =>
  app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/init",
    headers,
    payload: { token, amount: kushkiAmount(NEUTRAL_PESOS) },
  });

const kushkiPse: Flow = {
  name: "Kushki PSE",
  create: (app, pesos, headers, ref) => kushkiTransferToken(app, pesos, headers, ref),
  idOf: (body) => (body as { token?: string })?.token,
  prepareQuery: async (app, id) => {
    await kushkiInit(app, id);
  },
  query: (app, id) => app.inject({ method: "GET", url: `/v1/sim/kushki/transfer/v1/status/${id}` }),
  settle: async (app, id) => {
    await kushkiInit(app, id);
    return (await kushkiPse.query(app, id)).json().status;
  },
};

const FLOWS: Flow[] = [
  wompiCard,
  wompiPse,
  mercadoPagoCard,
  mercadoPagoPse,
  rapydCard,
  rapydPse,
  kushkiCard,
  kushkiPse,
];

const byName = FLOWS.map((flow) => [flow.name, flow] as const);

const isSuccess = (res: Res) => res.statusCode === 200 || res.statusCode === 201;

let app: App;

beforeEach(() => {
  resetSimulatorState();
  app = buildApp();
});

afterEach(async () => {
  await app.close();
  resetSimulatorState();
});

describe("reserved amounts at creation, without a scenario header", () => {
  /*
   * Un desenlace de negocio pedido por monto tiene que ser exactamente el que ya produce la
   * cabecera, en las ocho rutas de creación: mismo código HTTP y mismo estado final. Rapyd
   * tarjeta con `PENDING` es la excepción y tiene su propia prueba más abajo.
   */
  const BUSINESS_ROWS: Array<[number, string]> = [
    [10100, "DECLINED"],
    [10101, "PENDING"],
    [10102, "EXPIRED"],
  ];

  const businessCases = byName.flatMap(([name, flow]) =>
    BUSINESS_ROWS.filter(([amount]) => !(flow === rapydCard && amount === 10101)).map(
      ([amount, scenario]) => [name, amount, scenario, flow] as const,
    ),
  );

  it.each(businessCases)(
    "%s: amount %d produces the same outcome as the header %s",
    async (_name, amount, scenario, flow) => {
      const viaHeader = await flow.create(app, NEUTRAL_PESOS, H(scenario));
      const viaAmount = await flow.create(app, amount);

      expect(viaAmount.statusCode).toBe(viaHeader.statusCode);

      if (isSuccess(viaHeader)) {
        const expected = await flow.settle(app, flow.idOf(viaHeader.json())!);
        expect(await flow.settle(app, flow.idOf(viaAmount.json())!)).toBe(expected);
      }
    },
  );

  it("Rapyd card: 10101 creates the hosted page, which stays NEW until someone pays it", async () => {
    // El pendiente nativo de una página alojada es la página que nadie visitó (medido: se
    // queda en `NEW`). Por cabecera `PENDING` sigue respondiendo 501.
    const created = await rapydCard.create(app, 10101);

    expect(created.statusCode).toBe(200);
    const first = await rapydCard.query(app, rapydCard.idOf(created.json())!);
    const second = await rapydCard.query(app, rapydCard.idOf(created.json())!);
    expect(first.json().data.status).toBe("NEW");
    expect(second.json().data.status).toBe("NEW");
  });

  const TECHNICAL_ROWS: Array<[number, string, number]> = [
    [10429, "RATE_LIMIT", 429],
    [10500, "SERVER_ERROR", 500],
    [10502, "BAD_GATEWAY", 502],
    [10503, "SERVICE_UNAVAILABLE", 503],
    [10504, "TIMEOUT", 504],
    [10001, "NETWORK_ERROR", 500],
  ];

  const technicalCases = byName.flatMap(([name, flow]) =>
    TECHNICAL_ROWS.map(([amount, scenario, status]) => [name, amount, scenario, status, flow] as const),
  );

  it.each(technicalCases)(
    "%s: amount %d (%s) answers HTTP %d and leaves nothing to query",
    async (_name, amount, _scenario, status, flow) => {
      const res = await flow.create(app, amount);

      expect(res.statusCode).toBe(status);
      expect(flow.idOf(safeJson(res))).toBeUndefined();
    },
  );

  it.each([
    ["INTERNAL_ERROR", 10500],
    ["BAD_GATEWAY", 10502],
    ["SERVICE_UNAVAILABLE", 10503],
    ["CONNECTION_ERROR", 10001],
  ])("the header alias %s answers the same as the reserved amount %d", async (alias, amount) => {
    for (const flow of FLOWS) {
      const viaHeader = await flow.create(app, NEUTRAL_PESOS, H(alias));
      const viaAmount = await flow.create(app, amount);
      expect([flow.name, viaAmount.statusCode]).toEqual([flow.name, viaHeader.statusCode]);
    }
  });

  it.each(byName)("%s: amount 10002 (FLAPPING) fails twice and then creates", async (_name, flow) => {
    const ref = nextRef("FLAP");

    const first = await flow.create(app, 10002, {}, ref);
    const second = await flow.create(app, 10002, {}, ref);
    const third = await flow.create(app, 10002, {}, ref);

    expect([first.statusCode, second.statusCode]).toEqual([503, 503]);
    expect(isSuccess(third)).toBe(true);
  });

  it.each(byName)("%s: amount 10004 (MALFORMED_JSON) answers 200 with a body that is not JSON", async (_name, flow) => {
    const res = await flow.create(app, 10004);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(() => JSON.parse(res.body)).toThrow(SyntaxError);
  });

  it.each(byName)(
    "%s: amount 10005 (MALFORMED_BODY) answers 200 with JSON that lacks the transaction id",
    async (_name, flow) => {
      const res = await flow.create(app, 10005);

      expect(res.statusCode).toBe(200);
      expect(flow.idOf(res.json())).toBeUndefined();
    },
  );

  it.each(byName)("%s: amount 10006 (HTML_ERROR) answers 502 with an HTML page", async (_name, flow) => {
    const res = await flow.create(app, 10006);

    expect(res.statusCode).toBe(502);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<html");
    expect(() => JSON.parse(res.body)).toThrow(SyntaxError);
  });

  describe("10003 (SLOW) waits SIMULATOR_SLOW_RESPONSE_MS and then answers the native 504", () => {
    const previous = process.env.SIMULATOR_SLOW_RESPONSE_MS;

    beforeAll(() => {
      process.env.SIMULATOR_SLOW_RESPONSE_MS = "40";
    });

    afterAll(() => {
      if (previous === undefined) {
        delete process.env.SIMULATOR_SLOW_RESPONSE_MS;
      } else {
        process.env.SIMULATOR_SLOW_RESPONSE_MS = previous;
      }
    });

    it.each(byName)("%s", async (_name, flow) => {
      const started = Date.now();
      const res = await flow.create(app, 10003);

      expect(res.statusCode).toBe(504);
      expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    });
  });

  it("the default slow delay exceeds a 30 s client timeout, and a bad value falls back to it", () => {
    expect(slowResponseDelayMs({})).toBe(35000);
    expect(slowResponseDelayMs({ SIMULATOR_SLOW_RESPONSE_MS: "abc" })).toBe(35000);
    expect(slowResponseDelayMs({ SIMULATOR_SLOW_RESPONSE_MS: "-5" })).toBe(35000);
    expect(slowResponseDelayMs({ SIMULATOR_SLOW_RESPONSE_MS: "250" })).toBe(250);
  });

  it("reads the slow delay through loadServerEnv, so the root .env applies like the webhook variables", () => {
    const loader = jest
      .spyOn(credentialResolver, "loadServerEnv")
      .mockReturnValue({ SIMULATOR_SLOW_RESPONSE_MS: "123" });
    try {
      expect(slowResponseDelayMs()).toBe(123);
      expect(loader).toHaveBeenCalled();
    } finally {
      loader.mockRestore();
    }
  });

  describe("10409 (DUPLICATE_PAYMENT)", () => {
    const modelled = [wompiCard, wompiPse, mercadoPagoCard, rapydPse, kushkiCard];
    const notModelled = [mercadoPagoPse, rapydCard, kushkiPse];

    it.each(modelled.map((flow) => [flow.name, flow] as const))(
      "%s: the first charge is created and the second with the same reference answers 409",
      async (_name, flow) => {
        const ref = nextRef("DUP");

        const first = await flow.create(app, 10409, {}, ref);
        const second = await flow.create(app, 10409, {}, ref);

        expect(isSuccess(first)).toBe(true);
        expect(second.statusCode).toBe(409);
      },
    );

    it.each(notModelled.map((flow) => [flow.name, flow] as const))(
      "%s: answers 501, as the header does, because there is no measured 409 for this route",
      async (_name, flow) => {
        const res = await flow.create(app, 10409);

        expect(res.statusCode).toBe(501);
      },
    );
  });

  it.each(byName)("%s: an amount with cents never matches the table", async (_name, flow) => {
    // 10100,50 no es 10 100: solo los pesos enteros eligen escenario.
    if (flow === wompiCard || flow === wompiPse) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/sim/wompi/transactions",
        payload: {
          amount_in_cents: 1010050,
          currency: "COP",
          reference: nextRef("CENTS"),
          customer_email: "comprador@example.com",
          payment_method: { type: "CARD", token: "tok_test_fake" },
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.status).toBe("PENDING");
      return;
    }

    const res = await flow.create(app, 10100.5);
    expect(isSuccess(res)).toBe(true);
  });
});

describe("query failures chosen at creation and applied by the status GET", () => {
  async function createForQuery(flow: Flow, amount: number): Promise<string> {
    const created = await flow.create(app, amount);
    expect(isSuccess(created)).toBe(true);
    const id = flow.idOf(created.json())!;
    await flow.prepareQuery?.(app, id);
    return id;
  }

  it.each(byName)("%s: amount 10600 answers 500 on every query", async (_name, flow) => {
    const id = await createForQuery(flow, 10600);

    const codes = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      codes.push((await flow.query(app, id)).statusCode);
    }

    expect(codes).toEqual([500, 500, 500, 500]);
  });

  it.each(byName)("%s: amount 10602 fails twice and then answers the transaction", async (_name, flow) => {
    const id = await createForQuery(flow, 10602);

    const first = await flow.query(app, id);
    const second = await flow.query(app, id);
    const third = await flow.query(app, id);

    expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([503, 503, 200]);
  });

  describe("amount 10604 answers SLOW on the query", () => {
    const previous = process.env.SIMULATOR_SLOW_RESPONSE_MS;

    beforeAll(() => {
      process.env.SIMULATOR_SLOW_RESPONSE_MS = "40";
    });

    afterAll(() => {
      if (previous === undefined) {
        delete process.env.SIMULATOR_SLOW_RESPONSE_MS;
      } else {
        process.env.SIMULATOR_SLOW_RESPONSE_MS = previous;
      }
    });

    it.each(byName)("%s", async (_name, flow) => {
      const id = await createForQuery(flow, 10604);

      const started = Date.now();
      const res = await flow.query(app, id);

      expect(res.statusCode).toBe(504);
      expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    });
  });

  it("Wompi PSE: the first query, the one the SDK makes to get the bank URL, is not failed", async () => {
    const created = await wompiPse.create(app, 10600);
    const id = wompiPse.idOf(created.json())!;

    const first = await wompiPse.query(app, id);

    expect(first.statusCode).toBe(200);
    expect(first.json().data.payment_method.extra.async_payment_url).toBeDefined();
    expect((await wompiPse.query(app, id)).statusCode).toBe(500);
  });
});

describe("PSE bank lists fail by a mark in the credential the SDK sends", () => {
  const BANK_LISTS: Array<[string, string, (mark: string) => Headers]> = [
    ["Wompi", "/v1/sim/wompi/pse/financial_institutions", (mark) => ({ authorization: `Bearer pub_test_${mark}` })],
    ["Mercado Pago", "/v1/sim/mercadopago/payment_methods", (mark) => ({ authorization: `Bearer APP_USR-${mark}` })],
    ["Rapyd", "/v1/sim/rapyd/payment_methods/country?country=CO", (mark) => ({ access_key: `rak_${mark}` })],
    ["Kushki", "/v1/sim/kushki/transfer/v1/bankList", (mark) => ({ "public-merchant-id": `pub_${mark}` })],
  ];

  const list = (url: string, headers: Headers) => app.inject({ method: "GET", url, headers });

  it.each(BANK_LISTS)("%s: sim_flapping fails twice and then answers the list", async (_name, url, headersFor) => {
    const codes = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      codes.push((await list(url, headersFor("sim_flapping"))).statusCode);
    }

    expect(codes).toEqual([503, 503, 200]);
  });

  it.each(BANK_LISTS)("%s: sim_server_error answers 500 every time", async (_name, url, headersFor) => {
    const codes = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      codes.push((await list(url, headersFor("sim_server_error"))).statusCode);
    }

    expect(codes).toEqual([500, 500, 500, 500]);
  });

  it.each(BANK_LISTS)("%s: any other credential answers the list as before", async (_name, url, headersFor) => {
    expect((await list(url, headersFor("ordinary"))).statusCode).toBe(200);
    expect((await list(url, {})).statusCode).toBe(200);
  });
});

describe("gateway test data, the same the real sandbox uses", () => {
  async function wompiToken(number: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: { authorization: "Bearer pub_test_abc" },
      payload: { number, cvc: "123", exp_month: "12", exp_year: "30", card_holder: "Pedro Perez" },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.id;
  }

  const wompiCharge = (token: string, pesos = NEUTRAL_PESOS, headers: Headers = {}) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      headers,
      payload: {
        amount_in_cents: pesos * 100,
        currency: "COP",
        reference: nextRef("WTOK"),
        customer_email: "comprador@example.com",
        payment_method: { type: "CARD", token, installments: 1 },
      },
    });

  describe("Wompi: the tokenized card number", () => {
    it("4111 1111 1111 1111 is created PENDING and the first query resolves it DECLINED", async () => {
      // Sin espacios: Wompi los rechaza con el `422` del patrón (medido el 6 de octubre de 2026).
      const token = await wompiToken("4111111111111111");

      const created = await wompiCharge(token);
      expect(created.statusCode).toBe(201);
      expect(created.json().data.status).toBe("PENDING");

      const id = created.json().data.id;
      expect((await wompiCard.query(app, id)).json().data.status).toBe("DECLINED");
      expect((await wompiCard.query(app, id)).json().data.status).toBe("DECLINED");
    });

    it("4242 4242 4242 4242 keeps resolving APPROVED, as before", async () => {
      const token = await wompiToken("4242424242424242");

      const created = await wompiCharge(token);

      expect((await wompiCard.query(app, created.json().data.id)).json().data.status).toBe("APPROVED");
    });

    it("remembers the derived outcome per token, never the card number", async () => {
      const token = await wompiToken("4111111111111111");

      const remembered = cardTokenOutcomeFor("wompi", token);

      expect(remembered).toEqual({ scenario: "PENDING_THEN_DECLINED" });
      expect(JSON.stringify(remembered)).not.toContain("4111");
    });

    it("an unknown token behaves as before", async () => {
      const created = await wompiCharge("tok_never_issued");

      expect((await wompiCard.query(app, created.json().data.id)).json().data.status).toBe("APPROVED");
    });
  });

  async function mercadoPagoToken(name: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/card_tokens?public_key=TEST-pub-key",
      payload: {
        card_number: "5254133674403564",
        expiration_month: 11,
        expiration_year: 2030,
        security_code: "123",
        cardholder: { name, identification: { type: "CC", number: "123456789" } },
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  const mercadoPagoCharge = (token: string, pesos = NEUTRAL_PESOS, headers: Headers = {}) =>
    app.inject({
      method: "POST",
      url: "/v1/sim/mercadopago/payments",
      headers: mpHeaders(headers),
      payload: {
        transaction_amount: pesos,
        description: nextRef("MPTOK"),
        token,
        installments: 1,
        payer: { email: "comprador@example.com" },
      },
    });

  describe("Mercado Pago: the cardholder name sent to card_tokens", () => {
    it.each([
      ["APRO", "approved", "accredited"],
      ["CONT", "in_process", "pending_contingency"],
      ["OTHE", "rejected", "cc_rejected_other_reason"],
      ["CALL", "rejected", "cc_rejected_call_for_authorize"],
      ["FUND", "rejected", "cc_rejected_insufficient_amount"],
      ["SECU", "rejected", "cc_rejected_bad_filled_security_code"],
      ["EXPI", "rejected", "cc_rejected_bad_filled_date"],
      ["FORM", "rejected", "cc_rejected_bad_filled_other"],
    ])("%s charges %s / %s, and the query answers the same", async (name, status, statusDetail) => {
      const token = await mercadoPagoToken(name);

      const created = await mercadoPagoCharge(token);

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ status, status_detail: statusDetail });
      const queried = await mercadoPagoCard.query(app, String(created.json().id));
      expect(queried.json()).toMatchObject({ status, status_detail: statusDetail });
    });

    it("a name outside the table behaves as before", async () => {
      const token = await mercadoPagoToken("Pedro Perez");

      const created = await mercadoPagoCharge(token);

      expect(created.json()).toMatchObject({ status: "approved", status_detail: "accredited" });
    });
  });

  describe("Kushki: the payer document number sent to transfer/v1/tokens", () => {
    it.each([
      ["123456789", "approvedTransaction"],
      ["999999990", "initializedTransaction"],
      ["100000002", "declinedTransaction"],
    ])("%s ends in %s", async (documentNumber, expected) => {
      const created = await kushkiTransferToken(app, NEUTRAL_PESOS, {}, undefined, documentNumber);
      expect(created.statusCode).toBe(201);

      expect(await kushkiPse.settle(app, created.json().token)).toBe(expected);
    });
  });

  describe("precedence: header > gateway data > reserved amount", () => {
    it("a header wins over a reserved amount", async () => {
      const res = await mercadoPagoCard.create(app, 10100, H("APPROVED"));

      expect(res.json().status).toBe("approved");
    });

    it("a header wins over the gateway test data", async () => {
      const token = await mercadoPagoToken("OTHE");

      const res = await mercadoPagoCharge(token, NEUTRAL_PESOS, H("APPROVED"));

      expect(res.json()).toMatchObject({ status: "approved", status_detail: "accredited" });
    });

    it("Mercado Pago: the cardholder name wins over a reserved amount", async () => {
      const token = await mercadoPagoToken("OTHE");

      const res = await mercadoPagoCharge(token, 10101);

      expect(res.json()).toMatchObject({ status: "rejected", status_detail: "cc_rejected_other_reason" });
    });

    it("Wompi: the 4111 card wins over a reserved amount", async () => {
      const token = await wompiToken("4111111111111111");

      const created = await wompiCharge(token, 10102);

      expect(created.json().data.status).toBe("PENDING");
      expect((await wompiCard.query(app, created.json().data.id)).json().data.status).toBe("DECLINED");
    });

    it("Kushki: the document number wins over a reserved amount", async () => {
      const created = await kushkiTransferToken(app, 10101, {}, undefined, "100000002");

      expect(await kushkiPse.settle(app, created.json().token)).toBe("declinedTransaction");
    });

    it("a header wins over the Kushki document number", async () => {
      const created = await kushkiTransferToken(app, NEUTRAL_PESOS, H("APPROVED"), undefined, "100000002");

      expect(await kushkiPse.settle(app, created.json().token)).toBe("approvedTransaction");
    });
  });
});

describe("Kushki transfer/v1/init applies business scenarios instead of ignoring them", () => {
  async function tokenWith(headers: Headers = {}): Promise<string> {
    const created = await kushkiTransferToken(app, NEUTRAL_PESOS, headers);
    expect(created.statusCode).toBe(201);
    return created.json().token;
  }

  const status = async (token: string) => (await kushkiPse.query(app, token)).json().status;

  it.each([
    ["DECLINED", "declinedTransaction"],
    ["REJECTED", "declinedTransaction"],
    ["PENDING", "initializedTransaction"],
    ["APPROVED", "approvedTransaction"],
  ])("an init with %s ends the transfer in %s", async (scenario, expected) => {
    const token = await tokenWith();

    const init = await kushkiInit(app, token, H(scenario));

    expect(init.statusCode).toBe(201);
    expect(await status(token)).toBe(expected);
  });

  it("an init without a header keeps the outcome registered with the token", async () => {
    const token = await tokenWith(H("DECLINED"));

    await kushkiInit(app, token);

    expect(await status(token)).toBe("declinedTransaction");
  });

  it.each(["EXPIRED", "FOO"])("an init with %s answers 501 and does not start the transfer", async (scenario) => {
    const token = await tokenWith();

    const init = await kushkiInit(app, token, H(scenario));

    expect(init.statusCode).toBe(501);
    expect(await status(token)).toBe("requestedToken");
  });
});

describe("Wompi 422 for an invalid card number", () => {
  it("answers the measured prefix without a literal ellipsis", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sim/wompi/tokens/cards",
      headers: { authorization: "Bearer pub_test_abc" },
      payload: { number: "1234", cvc: "123", exp_month: "12", exp_year: "30", card_holder: "Pedro" },
    });

    expect(res.statusCode).toBe(422);
    const [message] = res.json().error.messages.number;
    expect(message).toMatch(/^debe coincidir con el patron/);
    expect(message).not.toContain("…");
  });
});

function safeJson(res: Res): unknown {
  try {
    return res.json();
  } catch {
    return undefined;
  }
}
