import { buildApp } from "../src/app";
import {
  kushkiTransfers,
  mercadopagoOrders,
  rapydCheckouts,
  resetSimulatorState,
} from "../src/store/GatewayStores";

/**
 * El escenario se resuelve al **crear** el cobro, no al consultarlo (issue #124).
 *
 * La regla tiene dos mitades y las dos importan:
 *
 *   1. Un escenario de negocio fija el desenlace en la creación. Si envías `DECLINED`,
 *      el cobro termina declinado, y preguntarlo después no lo cambia.
 *   2. Un escenario **técnico** no crea ni muta estado. Si envías `TIMEOUT`, la llamada
 *      falla y no queda ningún cobro: el error no es un cobro en estado de error.
 *
 * Estas pruebas cubren las dos, en las cuatro pasarelas, sobre el punto donde antes el
 * escenario se aceptaba con `201` y se ignoraba.
 */

const H = (s: string) => ({ "x-simulator-scenario": s });

const MP_ORDER = {
  type: "online",
  total_amount: "10000",
  external_reference: "ORD-ESCENARIO-MPO",
  payer: { email: "comprador@example.com" },
  transactions: {
    payments: [
      {
        amount: "10000",
        payment_method: {
          id: "pse",
          type: "bank_transfer",
          financial_institution: "1051",
        },
      },
    ],
  },
};

const PSE_RAPYD = {
  amount: 100,
  currency: "COP",
  merchant_reference_id: "ORD-ESCENARIO-1",
  customer: "cus_123",
  payment_method: { type: "co_pse_bancolombia_bank" },
};

const KUSHKI_INIT = {
  subtotalIva0: 10000,
  subtotalIva: 0,
  iva: 0,
  ice: 0,
  currency: "COP",
};

const CHECKOUT_RAPYD = {
  amount: "10000.00",
  currency: "COP",
  country: "CO",
  merchant_reference_id: "ORD-ESCENARIO-CHK",
  payment_method_type_categories: ["card"],
};

const WOMPI_CARD = {
  amount_in_cents: 1000000,
  currency: "COP",
  reference: "ORD-ESCENARIO-W",
  customer_email: "comprador@example.com",
  payment_method: { type: "CARD", token: "tok_test_fake" },
};

const PSE_WOMPI = {
  amount_in_cents: 1000000,
  currency: "COP",
  reference: "ORD-ESCENARIO-WPSE",
  customer_email: "comprador@example.com",
  redirect_url: "https://comercio.example.com/retorno",
  payment_method: {
    type: "PSE",
    user_type: 0,
    user_legal_id_type: "CC",
    user_legal_id: "1099888777",
    financial_institution_code: "1",
    payment_description: "Pago ORD-ESCENARIO-WPSE",
  },
};

const MP_PAYMENT = {
  transaction_amount: 10000,
  description: "ORD-ESCENARIO-MP",
  external_reference: "ORD-ESCENARIO-MP",
  token: "a1b2c3d4e5f6",
  installments: 1,
  payer: { email: "comprador@example.com" },
};

const KUSHKI_CHARGE = {
  token: "tok_kushki_escenario",
  trackingCode: "ORD-ESCENARIO-K",
  amount: KUSHKI_INIT,
  contactDetails: { email: "comprador@example.com" },
};

/** Lo que manda el SDK al pedir el token de PSE (`buildTransferTokenPayload`). */
const TOKEN_KUSHKI = {
  bankId: "007",
  callbackUrl: "https://comercio.example.com/retorno",
  paymentDescription: "ORD-ESCENARIO-KPSE",
  email: "comprador@example.com",
  amount: KUSHKI_INIT,
};

type App = ReturnType<typeof buildApp>;

const withScenario = (scenario: string) => (scenario === "" ? {} : H(scenario));

/**
 * Un recurso cobrable, con lo que hay que hacer para crearlo y para consultarlo.
 *
 * `crear` incluye lo que haría el pagador después de crear: publicar la URL del banco en
 * Wompi, visitar la página en Rapyd o iniciar la transferencia en Kushki. Devuelve el
 * identificador con el que se consulta.
 *
 * `consultar` devuelve el estado junto con el monto y la referencia del comercio, en los
 * campos de los que los lee el SDK: un estado correcto con la referencia perdida le
 * entrega al comercio una orden que no puede conciliar. `monto` y `referencia` son los
 * que el recurso envió al crearse.
 */
interface QueryResult {
  status: string;
  amount: unknown;
  reference: unknown;
}

interface Resource {
  create: (app: App, scenario: string) => Promise<string>;
  queryStatus: (app: App, id: string) => Promise<QueryResult>;
  amount: unknown;
  reference: string;
}

const queryWompi = async (app: App, id: string): Promise<QueryResult> => {
  const { data } = (
    await app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` })
  ).json();

  return { status: data.status, amount: data.amount_in_cents, reference: data.reference };
};

const queryRapydCheckout = async (app: App, id: string): Promise<QueryResult> => {
  const { data } = (
    await app.inject({ method: "GET", url: `/v1/sim/rapyd/checkout/${id}` })
  ).json();

  return {
    status: `${data.status}/${data.payment.status}`,
    amount: data.payment.amount,
    reference: data.payment.merchant_reference_id,
  };
};

let mpKey = 0;

const RESOURCES: Record<string, Resource> = {
  "Wompi, card": {
    create: async (app, scenario) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/sim/wompi/transactions",
          headers: withScenario(scenario),
          payload: WOMPI_CARD,
        })
      ).json().data.id,
    queryStatus: queryWompi,
    amount: WOMPI_CARD.amount_in_cents,
    reference: WOMPI_CARD.reference,
  },
  "Wompi, PSE": {
    create: async (app, scenario) => {
      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/wompi/transactions",
        headers: withScenario(scenario),
        payload: PSE_WOMPI,
      });
      const id = created.json().data.id;

      // La primera consulta publica la URL del banco: es la que el comercio necesita para
      // redirigir al pagador.
      await app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` });

      return id;
    },
    queryStatus: queryWompi,
    amount: PSE_WOMPI.amount_in_cents,
    reference: PSE_WOMPI.reference,
  },
  "Rapyd, PSE": {
    create: async (app, scenario) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/payments",
          headers: withScenario(scenario),
          payload: PSE_RAPYD,
        })
      ).json().data.id,
    queryStatus: async (app, id) => {
      const { data } = (
        await app.inject({ method: "GET", url: `/v1/sim/rapyd/payments/${id}` })
      ).json();

      return { status: data.status, amount: data.amount, reference: data.merchant_reference_id };
    },
    amount: PSE_RAPYD.amount,
    reference: PSE_RAPYD.merchant_reference_id,
  },
  "Rapyd, visited payment page": {
    create: async (app, scenario) => {
      const created = (
        await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          headers: withScenario(scenario),
          payload: CHECKOUT_RAPYD,
        })
      ).json().data;

      await app.inject({ method: "GET", url: new URL(created.redirect_url).pathname });

      return created.id;
    },
    queryStatus: queryRapydCheckout,
    amount: CHECKOUT_RAPYD.amount,
    reference: CHECKOUT_RAPYD.merchant_reference_id,
  },
  "Rapyd, unvisited payment page": {
    create: async (app, scenario) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          headers: withScenario(scenario),
          payload: CHECKOUT_RAPYD,
        })
      ).json().data.id,
    queryStatus: queryRapydCheckout,
    amount: CHECKOUT_RAPYD.amount,
    reference: CHECKOUT_RAPYD.merchant_reference_id,
  },
  "Mercado Pago, card": {
    create: async (app, scenario) =>
      String(
        (
          await app.inject({
            method: "POST",
            url: "/v1/sim/mercadopago/payments",
            headers: { ...withScenario(scenario), "x-idempotency-key": `mp-${++mpKey}` },
            payload: MP_PAYMENT,
          })
        ).json().id,
      ),
    queryStatus: async (app, id) => {
      const payment = (
        await app.inject({ method: "GET", url: `/v1/sim/mercadopago/payments/${id}` })
      ).json();

      return {
        status: payment.status,
        amount: payment.transaction_amount,
        reference: payment.external_reference,
      };
    },
    amount: MP_PAYMENT.transaction_amount,
    reference: MP_PAYMENT.external_reference,
  },
  "Mercado Pago, PSE order": {
    create: async (app, scenario) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { ...withScenario(scenario), "x-idempotency-key": `mp-${++mpKey}` },
        payload: MP_ORDER,
      });

      // La orden rechazada llega en el `402`, dentro de `data`; las demás, sueltas en el `201`.
      return response.statusCode === 402 ? response.json().data.id : response.json().id;
    },
    queryStatus: async (app, id) => {
      const order = (
        await app.inject({ method: "GET", url: `/v1/sim/mercadopago/orders/${id}` })
      ).json();

      return {
        status: order.status,
        amount: order.total_amount,
        reference: order.external_reference,
      };
    },
    amount: MP_ORDER.total_amount,
    reference: MP_ORDER.external_reference,
  },
  "Kushki, card": {
    create: async (app, scenario) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/sim/kushki/card/v1/charges",
          headers: withScenario(scenario),
          payload: KUSHKI_CHARGE,
        })
      ).json().ticketNumber,
    queryStatus: async (app, id) => {
      const { details } = (
        await app.inject({ method: "GET", url: `/v1/sim/kushki/charges/${id}` })
      ).json();

      return {
        status: details.transactionStatus,
        amount: details.approvedTransactionAmount,
        reference: details.trackingCode,
      };
    },
    amount: KUSHKI_INIT.subtotalIva0,
    reference: KUSHKI_CHARGE.trackingCode,
  },
  "Kushki, transfer": {
    create: async (app, scenario) => {
      const { token } = (
        await app.inject({
          method: "POST",
          url: "/v1/sim/kushki/transfer/v1/tokens",
          headers: withScenario(scenario),
          payload: TOKEN_KUSHKI,
        })
      ).json();

      await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: { token, amount: KUSHKI_INIT },
      });

      return token;
    },
    queryStatus: async (app, id) => {
      const transfer = (
        await app.inject({ method: "GET", url: `/v1/sim/kushki/transfer/v1/status/${id}` })
      ).json();

      return {
        status: transfer.status,
        amount: transfer.amount.subtotalIva0,
        reference: transfer.paymentDescription,
      };
    },
    amount: KUSHKI_INIT.subtotalIva0,
    reference: TOKEN_KUSHKI.paymentDescription,
  },
};

async function kushkiFlow(app: ReturnType<typeof buildApp>, scenario: string) {
  const issued = await app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/tokens",
    headers: scenario === "" ? {} : H(scenario),
    payload: { bankId: "007", callbackUrl: "https://comercio.example.com/retorno" },
  });

  if (issued.statusCode !== 201) {
    return { issued: issued.statusCode };
  }

  const { token } = issued.json();

  await app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/init",
    payload: { token, amount: KUSHKI_INIT },
  });

  const queryResponse = await app.inject({
    method: "GET",
    url: `/v1/sim/kushki/transfer/v1/status/${token}`,
  });

  return { issued: 201, status: queryResponse.json().status };
}

describe("the scenario fixes the outcome at creation", () => {
  beforeEach(() => {
    resetSimulatorState();
  });

  afterEach(() => {
    resetSimulatorState();
  });

  describe("Rapyd, PSE payment", () => {
    it("a payment created with DECLINED is born declined and is queried declined", async () => {
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("DECLINED"),
        payload: PSE_RAPYD,
      });

      const id = created.json().data.id;

      // Nace en el estado final, no pendiente: un pago declinado no tiene nada que
      // resolver después.
      expect(created.json().data.status).toBe("ERR");

      const queryResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
      });

      expect(queryResponse.json().data.status).toBe("ERR");
      expect(queryResponse.json().data.paid).toBe(false);

      await app.close();
    });

    it("a payment created with EXPIRED is born expired", async () => {
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("EXPIRED"),
        payload: PSE_RAPYD,
      });

      expect(created.json().data.status).toBe("EXP");

      const queryResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${created.json().data.id}`,
      });

      expect(queryResponse.json().data.status).toBe("EXP");

      await app.close();
    });

    it("without a scenario the PSE payment is approved when queried", async () => {
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: PSE_RAPYD,
      });

      const id = created.json().data.id;
      expect(created.json().data.status).toBe("ACT");

      const queryResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
      });

      expect(queryResponse.json().data.status).toBe("CLO");
      expect(queryResponse.json().data.paid).toBe(true);

      await app.close();
    });
  });

  describe("Mercado Pago, PSE order", () => {
    it("a declined PSE answers 402 with the order in failed, like the real API", async () => {
      const app = buildApp();

      // La orden nace ya en `failed`: la API real responde 402 con la orden en `data`. No
      // hace falta registrar un desenlace, porque `failed` no tiene transición de salida.
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { ...H("DECLINED"), "x-idempotency-key": "escenario-mp" },
        payload: MP_ORDER,
      });

      expect(response.statusCode).toBe(402);
      expect(response.json().errors[0].code).toBe("failed");

      await app.close();
    });

    it("an order created with EXPIRED ends expired, not processed", async () => {
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { ...H("EXPIRED"), "x-idempotency-key": "escenario-mp-2" },
        payload: MP_ORDER,
      });

      expect(created.statusCode).toBe(201);
      const id = created.json().id;
      expect(created.json().status).toBe("action_required");

      const queryResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/orders/${id}`,
      });

      // `expired | expired`, el par de la tabla oficial de estados de la orden, que tiene
      // `expired` y `canceled` como estados distintos. Lo que no puede ser es `processed`:
      // un cobro caducado reportado como cobrado.
      expect(queryResponse.json().status).toBe("expired");
      expect(queryResponse.json().status_detail).toBe("expired");

      await app.close();
    });

    it("accepts both scenario headers", async () => {
      const app = buildApp();

      // `x-simulate-scenario` y `x-simulator-scenario` se reconocen por igual. Antes la ruta de
      // órdenes solo leía la primera, así que mandar la segunda devolvía 201 con una orden
      // en `action_required` en vez del 402.
      for (const header of ["x-simulator-scenario", "x-simulate-scenario"]) {
        resetSimulatorState();

        const response = await app.inject({
          method: "POST",
          url: "/v1/sim/mercadopago/orders",
          headers: { [header]: "DECLINED", "x-idempotency-key": `k-${header}` },
          payload: MP_ORDER,
        });

        expect(response.statusCode).toBe(402);
      }

      await app.close();
    });
  });

  describe("Kushki, transfer", () => {
    it("a transfer created with DECLINED ends declined", async () => {
      const app = buildApp();

      // Antes el token y el `init` ignoraban el escenario: un `DECLINED` devolvía 201 y la
      // consulta sin cabecera respondía `approvedTransaction`. Solo se llegaba a
      // `declinedTransaction` enviando el escenario en la consulta.
      const result = await kushkiFlow(app, "DECLINED");

      expect(result).toEqual({ issued: 201, status: "declinedTransaction" });

      await app.close();
    });

    it("without a scenario the transfer ends approved", async () => {
      const app = buildApp();

      const result = await kushkiFlow(app, "");

      expect(result).toEqual({ issued: 201, status: "approvedTransaction" });

      await app.close();
    });

    it("a transfer with EXPIRED is rejected with 501 and leaves no token", async () => {
      const app = buildApp();

      // `expiredTransaction` solo aplica a México según la referencia de Kushki. Antes
      // `EXPIRED` no registraba nada y la transferencia terminaba `approvedTransaction`.
      const result = await kushkiFlow(app, "EXPIRED");

      expect(result).toEqual({ issued: 501 });
      expect(kushkiTransfers.size()).toBe(0);

      await app.close();
    });

    it("the creation scenario prevails over the one of a later query", async () => {
      const app = buildApp();

      const { token } = await app
        .inject({
          method: "POST",
          url: "/v1/sim/kushki/transfer/v1/tokens",
          headers: H("DECLINED"),
          payload: { bankId: "007", callbackUrl: "https://comercio.example.com/retorno" },
        })
        .then((r) => r.json());

      await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: { token, amount: KUSHKI_INIT },
      });

      // La consulta pide APPROVED, pero el desenlace ya lo decidió la creación.
      const queryResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
        headers: H("APPROVED"),
      });

      expect(queryResponse.json().status).toBe("declinedTransaction");

      await app.close();
    });
  });

  describe("a technical failure neither creates nor mutates state", () => {
    it("Kushki: a TIMEOUT when issuing the token leaves no transfer", async () => {
      const app = buildApp();

      const issued = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/tokens",
        headers: H("TIMEOUT"),
        payload: { bankId: "007", callbackUrl: "https://comercio.example.com/retorno" },
      });

      expect(issued.statusCode).toBe(504);
      expect(kushkiTransfers.size()).toBe(0);

      // Un identificador con forma de token que nadie emitió: la consulta responde lo
      // mismo que Kushki ante una transferencia que no existe. Un error no es un cobro en
      // estado de error.
      const queryResponse = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/status/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      });

      expect(queryResponse.statusCode).toBe(400);
      expect(queryResponse.json().code).toBe("T004");

      await app.close();
    });

    it("Rapyd: a TIMEOUT when creating the payment page leaves no checkout", async () => {
      const app = buildApp();

      // Antes la ruta de checkout no tenía cadena de fallas técnicas: un TIMEOUT creaba
      // la página con 200 y la guardaba.
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/checkout",
        headers: H("TIMEOUT"),
        payload: CHECKOUT_RAPYD,
      });

      expect(response.statusCode).toBe(504);
      expect(rapydCheckouts.size()).toBe(0);

      await app.close();
    });

    it("Mercado Pago: a TIMEOUT when creating the order leaves no order", async () => {
      const app = buildApp();

      // Antes solo la ruta de pagos tenía la cadena: un TIMEOUT en `POST /orders`
      // respondía 201 y guardaba la orden.
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { ...H("TIMEOUT"), "x-idempotency-key": "escenario-mp-timeout" },
        payload: MP_ORDER,
      });

      expect(response.statusCode).toBe(504);
      expect(mercadopagoOrders.size()).toBe(0);

      await app.close();
    });

    it("Rapyd: a SERVER_ERROR when creating leaves no queryable payment", async () => {
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("SERVER_ERROR"),
        payload: PSE_RAPYD,
      });

      expect(response.statusCode).toBe(500);

      const queryResponse = await app.inject({
        method: "GET",
        url: "/v1/sim/rapyd/payments/payment_9f8e7d6c5b4a39281706123456789abc",
      });

      expect(queryResponse.statusCode).toBe(400);
      expect(queryResponse.json().status.error_code).toBe("ERROR_GET_PAYMENT");

      await app.close();
    });

    it("a technical scenario in the query does not move an already created charge", async () => {
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: PSE_RAPYD,
      });

      const id = created.json().data.id;

      // La consulta pide un 504. El cobro ya existía, así que la consulta lo responde: una
      // falla de transporte al consultar no deshace el cobro. Y el estado sigue el de la
      // creación.
      const queryResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
        headers: H("TIMEOUT"),
      });

      expect(queryResponse.statusCode).toBe(200);
      expect(queryResponse.json().data.status).toBe("CLO");

      await app.close();
    });
  });

  /**
   * El criterio 1 del issue, tal como está escrito: en las cuatro pasarelas, un cobro
   * creado aprobado, rechazado o pendiente se consulta después con ese mismo estado.
   *
   * Cada fila crea el cobro, hace lo que haría el pagador y consulta **dos veces**. La
   * segunda consulta es la que importa: es la que detecta una tabla que mueve un estado
   * que debería quedarse.
   *
   * La orden de Mercado Pago rechazada sí nace: la creación responde `402` con la orden en
   * `data`, y la consulta la devuelve en `failed` (medido el 7 de octubre de 2026). Lo que
   * falta es a propósito: la página de Rapyd pendiente no tiene escenario, es la que nadie
   * visitó, que es lo medido.
   */
  describe("criterion 1: the creation status is the status of every query", () => {
    const CASES: { resource: string; scenario: string; expected: string }[] = [
      { resource: "Wompi, card", scenario: "", expected: "APPROVED" },
      { resource: "Wompi, card", scenario: "DECLINED", expected: "DECLINED" },
      { resource: "Wompi, card", scenario: "PENDING", expected: "PENDING" },
      { resource: "Wompi, PSE", scenario: "", expected: "APPROVED" },
      { resource: "Wompi, PSE", scenario: "DECLINED", expected: "DECLINED" },
      { resource: "Wompi, PSE", scenario: "PENDING", expected: "PENDING" },
      { resource: "Rapyd, PSE", scenario: "", expected: "CLO" },
      { resource: "Rapyd, PSE", scenario: "DECLINED", expected: "ERR" },
      { resource: "Rapyd, PSE", scenario: "PENDING", expected: "ACT" },
      { resource: "Rapyd, visited payment page", scenario: "", expected: "DON/CLO" },
      { resource: "Rapyd, visited payment page", scenario: "DECLINED", expected: "DON/ERR" },
      { resource: "Rapyd, unvisited payment page", scenario: "", expected: "NEW/null" },
      { resource: "Mercado Pago, card", scenario: "", expected: "approved" },
      { resource: "Mercado Pago, card", scenario: "DECLINED", expected: "rejected" },
      { resource: "Mercado Pago, card", scenario: "PENDING", expected: "in_process" },
      { resource: "Mercado Pago, PSE order", scenario: "", expected: "processed" },
      { resource: "Mercado Pago, PSE order", scenario: "PENDING", expected: "action_required" },
      { resource: "Mercado Pago, PSE order", scenario: "DECLINED", expected: "failed" },
      { resource: "Kushki, card", scenario: "", expected: "APPROVAL" },
      { resource: "Kushki, card", scenario: "DECLINED", expected: "DECLINED" },
      { resource: "Kushki, card", scenario: "PENDING", expected: "INITIALIZED" },
      { resource: "Kushki, transfer", scenario: "", expected: "approvedTransaction" },
      { resource: "Kushki, transfer", scenario: "DECLINED", expected: "declinedTransaction" },
      { resource: "Kushki, transfer", scenario: "PENDING", expected: "initializedTransaction" },
    ];

    it.each(CASES)(
      "$resource with scenario '$scenario' is queried $expected twice, with its amount and its reference",
      async ({ resource, scenario, expected }) => {
        const app = buildApp();
        const { create, queryStatus, amount, reference } = RESOURCES[resource];

        const id = await create(app, scenario);
        const first = await queryStatus(app, id);
        const second = await queryStatus(app, id);

        const created = { status: expected, amount, reference };
        expect([first, second]).toEqual([created, created]);

        await app.close();
      },
    );

    it("the payment born from a declined page is queried declined in /payments", async () => {
      // Es la segunda consulta del SDK con tarjeta de Rapyd: primero el checkout, después
      // el pago por su id. Las dos tienen que decir lo mismo, y el `failure_code` es el que
      // hace que el normalizador lo lea como rechazo y no como error.
      const app = buildApp();
      const created = (
        await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          headers: H("DECLINED"),
          payload: CHECKOUT_RAPYD,
        })
      ).json().data;

      const visit = await app.inject({
        method: "GET",
        url: new URL(created.redirect_url).pathname,
      });

      expect(visit.json().paid).toBe(false);

      const payment = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${visit.json().payment_id}`,
      });

      expect(payment.json().data.status).toBe("ERR");
      expect(payment.json().data.paid).toBe(false);
      expect(payment.json().data.failure_code).toMatch(/^ERROR_PROCESSING_CARD/);

      await app.close();
    });

    it.each([["PENDING"], ["EXPIRED"]])(
      "a Rapyd payment page with %s answers 501 and is not saved",
      async (scenario) => {
        // Aceptar el escenario sin aplicarlo dejaría pagar la página igual, que es el defecto
        // de la ronda anterior: el rechazo pedido terminaba en un pago cobrado.
        const app = buildApp();

        const response = await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          headers: H(scenario),
          payload: CHECKOUT_RAPYD,
        });

        expect(response.statusCode).toBe(501);
        expect(rapydCheckouts.size()).toBe(0);

        await app.close();
      },
    );

    it("a Rapyd card payment with PENDING answers 501", async () => {
      // `PENDING` solo existe para PSE en `/payments`: con tarjeta el pago nace cerrado.
      const app = buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("PENDING"),
        payload: { ...PSE_RAPYD, payment_method: { type: "co_visa_card" } },
      });

      expect(response.statusCode).toBe(501);

      await app.close();
    });
  });

  /*
   * La regla de las rutas de creación: una falla técnica sale por `technicalFailure`, un
   * desenlace declarado por su destino, y cualquier otro escenario responde `501` sin
   * guardar nada. Antes la orden de Mercado Pago y el token de Kushki aceptaban `FOO` o
   * `FLAPPING` con `201` y el cobro terminaba aprobado.
   */
  describe("a scenario the creation cannot produce answers 501", () => {
    const createOrder = (app: App, scenario: string) =>
      app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { ...H(scenario), "x-idempotency-key": `mp-${++mpKey}` },
        payload: MP_ORDER,
      });

    const issueToken = (app: App, scenario: string) =>
      app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/tokens",
        headers: H(scenario),
        payload: TOKEN_KUSHKI,
      });

    it.each(["FOO", "DUPLICATE_PAYMENT"])(
      "Mercado Pago: an order with %s answers 501 and leaves no order",
      async (scenario) => {
        const app = buildApp();

        const response = await createOrder(app, scenario);

        expect(response.statusCode).toBe(501);
        expect(response.json().error).toContain(scenario);
        expect(mercadopagoOrders.size()).toBe(0);

        await app.close();
      },
    );

    it.each(["FOO", "DUPLICATE_PAYMENT"])(
      "Kushki: a PSE token with %s answers 501 and leaves no transfer",
      async (scenario) => {
        const app = buildApp();

        const response = await issueToken(app, scenario);

        expect(response.statusCode).toBe(501);
        expect(response.json().error).toContain(scenario);
        expect(kushkiTransfers.size()).toBe(0);

        await app.close();
      },
    );

    it("Mercado Pago: an order with FLAPPING fails twice and is then created", async () => {
      const app = buildApp();

      const first = await createOrder(app, "FLAPPING");
      const second = await createOrder(app, "FLAPPING");
      expect([first.statusCode, second.statusCode]).toEqual([503, 503]);
      expect(mercadopagoOrders.size()).toBe(0);

      const third = await createOrder(app, "FLAPPING");
      expect(third.statusCode).toBe(201);

      const queryResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/orders/${third.json().id}`,
      });
      expect(queryResponse.json().status).toBe("processed");

      await app.close();
    });

    it("Kushki: a PSE token with FLAPPING fails twice and is then issued", async () => {
      const app = buildApp();

      const first = await issueToken(app, "FLAPPING");
      const second = await issueToken(app, "FLAPPING");
      expect([first.statusCode, second.statusCode]).toEqual([503, 503]);
      expect(kushkiTransfers.size()).toBe(0);

      const third = await issueToken(app, "FLAPPING");
      expect(third.statusCode).toBe(201);
      const { token } = third.json();

      await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: { token, amount: KUSHKI_INIT },
      });
      const queryResponse = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
      });
      expect(queryResponse.json().status).toBe("approvedTransaction");

      await app.close();
    });
  });

  describe("the status of a charge does not depend on how it is queried", () => {
    it("asking for the same charge twice with different headers gives the same status", async () => {
      const app = buildApp();

      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("DECLINED"),
        payload: PSE_RAPYD,
      });

      const id = created.json().data.id;

      const withApproved = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
        headers: H("APPROVED"),
      });

      const withoutHeader = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
      });

      // Con el simulador anterior la consulta no miraba ni la cabecera ni el pago creado:
      // devolvía `CLO` con `paid: true` y `amount: "0"` para cualquier identificador, así
      // que este pago declinado se reportaba cobrado.
      expect(withApproved.json().data.status).toBe("ERR");
      expect(withoutHeader.json().data.status).toBe("ERR");

      await app.close();
    });
  });
});