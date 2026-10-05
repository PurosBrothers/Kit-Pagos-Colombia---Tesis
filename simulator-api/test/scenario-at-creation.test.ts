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

const ORDEN_MP = {
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

const INICIO_KUSHKI = {
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

const TARJETA_WOMPI = {
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

const PAGO_MP = {
  transaction_amount: 10000,
  description: "ORD-ESCENARIO-MP",
  external_reference: "ORD-ESCENARIO-MP",
  token: "a1b2c3d4e5f6",
  installments: 1,
  payer: { email: "comprador@example.com" },
};

const CARGO_KUSHKI = {
  token: "tok_kushki_escenario",
  trackingCode: "ORD-ESCENARIO-K",
  amount: INICIO_KUSHKI,
  contactDetails: { email: "comprador@example.com" },
};

/** Lo que manda el SDK al pedir el token de PSE (`buildTransferTokenPayload`). */
const TOKEN_KUSHKI = {
  bankId: "007",
  callbackUrl: "https://comercio.example.com/retorno",
  paymentDescription: "ORD-ESCENARIO-KPSE",
  email: "comprador@example.com",
  amount: INICIO_KUSHKI,
};

type App = ReturnType<typeof buildApp>;

const conEscenario = (escenario: string) => (escenario === "" ? {} : H(escenario));

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
interface Consulta {
  status: string;
  monto: unknown;
  referencia: unknown;
}

interface Recurso {
  crear: (app: App, escenario: string) => Promise<string>;
  consultar: (app: App, id: string) => Promise<Consulta>;
  monto: unknown;
  referencia: string;
}

const consultarWompi = async (app: App, id: string): Promise<Consulta> => {
  const { data } = (
    await app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` })
  ).json();

  return { status: data.status, monto: data.amount_in_cents, referencia: data.reference };
};

const consultarCheckoutRapyd = async (app: App, id: string): Promise<Consulta> => {
  const { data } = (
    await app.inject({ method: "GET", url: `/v1/sim/rapyd/checkout/${id}` })
  ).json();

  return {
    status: `${data.status}/${data.payment.status}`,
    monto: data.payment.amount,
    referencia: data.payment.merchant_reference_id,
  };
};

let llaveMp = 0;

const RECURSOS: Record<string, Recurso> = {
  "Wompi, tarjeta": {
    crear: async (app, escenario) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/sim/wompi/transactions",
          headers: conEscenario(escenario),
          payload: TARJETA_WOMPI,
        })
      ).json().data.id,
    consultar: consultarWompi,
    monto: TARJETA_WOMPI.amount_in_cents,
    referencia: TARJETA_WOMPI.reference,
  },
  "Wompi, PSE": {
    crear: async (app, escenario) => {
      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/wompi/transactions",
        headers: conEscenario(escenario),
        payload: PSE_WOMPI,
      });
      const id = creado.json().data.id;

      // La primera consulta publica la URL del banco: es la que el comercio necesita para
      // redirigir al pagador.
      await app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` });

      return id;
    },
    consultar: consultarWompi,
    monto: PSE_WOMPI.amount_in_cents,
    referencia: PSE_WOMPI.reference,
  },
  "Rapyd, PSE": {
    crear: async (app, escenario) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/payments",
          headers: conEscenario(escenario),
          payload: PSE_RAPYD,
        })
      ).json().data.id,
    consultar: async (app, id) => {
      const { data } = (
        await app.inject({ method: "GET", url: `/v1/sim/rapyd/payments/${id}` })
      ).json();

      return { status: data.status, monto: data.amount, referencia: data.merchant_reference_id };
    },
    monto: PSE_RAPYD.amount,
    referencia: PSE_RAPYD.merchant_reference_id,
  },
  "Rapyd, página de pago visitada": {
    crear: async (app, escenario) => {
      const creado = (
        await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          headers: conEscenario(escenario),
          payload: CHECKOUT_RAPYD,
        })
      ).json().data;

      await app.inject({ method: "GET", url: new URL(creado.redirect_url).pathname });

      return creado.id;
    },
    consultar: consultarCheckoutRapyd,
    monto: CHECKOUT_RAPYD.amount,
    referencia: CHECKOUT_RAPYD.merchant_reference_id,
  },
  "Rapyd, página de pago sin visitar": {
    crear: async (app, escenario) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          headers: conEscenario(escenario),
          payload: CHECKOUT_RAPYD,
        })
      ).json().data.id,
    consultar: consultarCheckoutRapyd,
    monto: CHECKOUT_RAPYD.amount,
    referencia: CHECKOUT_RAPYD.merchant_reference_id,
  },
  "Mercado Pago, tarjeta": {
    crear: async (app, escenario) =>
      String(
        (
          await app.inject({
            method: "POST",
            url: "/v1/sim/mercadopago/payments",
            headers: { ...conEscenario(escenario), "x-idempotency-key": `mp-${++llaveMp}` },
            payload: PAGO_MP,
          })
        ).json().id,
      ),
    consultar: async (app, id) => {
      const pago = (
        await app.inject({ method: "GET", url: `/v1/sim/mercadopago/payments/${id}` })
      ).json();

      return {
        status: pago.status,
        monto: pago.transaction_amount,
        referencia: pago.external_reference,
      };
    },
    monto: PAGO_MP.transaction_amount,
    referencia: PAGO_MP.external_reference,
  },
  "Mercado Pago, orden de PSE": {
    crear: async (app, escenario) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/sim/mercadopago/orders",
          headers: { ...conEscenario(escenario), "x-idempotency-key": `mp-${++llaveMp}` },
          payload: ORDEN_MP,
        })
      ).json().id,
    consultar: async (app, id) => {
      const orden = (
        await app.inject({ method: "GET", url: `/v1/sim/mercadopago/orders/${id}` })
      ).json();

      return {
        status: orden.status,
        monto: orden.total_amount,
        referencia: orden.external_reference,
      };
    },
    monto: ORDEN_MP.total_amount,
    referencia: ORDEN_MP.external_reference,
  },
  "Kushki, tarjeta": {
    crear: async (app, escenario) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/sim/kushki/card/v1/charges",
          headers: conEscenario(escenario),
          payload: CARGO_KUSHKI,
        })
      ).json().ticketNumber,
    consultar: async (app, id) => {
      const { details } = (
        await app.inject({ method: "GET", url: `/v1/sim/kushki/charges/${id}` })
      ).json();

      return {
        status: details.transactionStatus,
        monto: details.approvedTransactionAmount,
        referencia: details.trackingCode,
      };
    },
    monto: INICIO_KUSHKI.subtotalIva0,
    referencia: CARGO_KUSHKI.trackingCode,
  },
  "Kushki, transferencia": {
    crear: async (app, escenario) => {
      const { token } = (
        await app.inject({
          method: "POST",
          url: "/v1/sim/kushki/transfer/v1/tokens",
          headers: conEscenario(escenario),
          payload: TOKEN_KUSHKI,
        })
      ).json();

      await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: { token, amount: INICIO_KUSHKI },
      });

      return token;
    },
    consultar: async (app, id) => {
      const transferencia = (
        await app.inject({ method: "GET", url: `/v1/sim/kushki/transfer/v1/status/${id}` })
      ).json();

      return {
        status: transferencia.status,
        monto: transferencia.amount.subtotalIva0,
        referencia: transferencia.paymentDescription,
      };
    },
    monto: INICIO_KUSHKI.subtotalIva0,
    referencia: TOKEN_KUSHKI.paymentDescription,
  },
};

async function flujoKushki(app: ReturnType<typeof buildApp>, escenario: string) {
  const emitido = await app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/tokens",
    headers: escenario === "" ? {} : H(escenario),
    payload: { bankId: "007", callbackUrl: "https://comercio.example.com/retorno" },
  });

  if (emitido.statusCode !== 201) {
    return { emitido: emitido.statusCode };
  }

  const { token } = emitido.json();

  await app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/init",
    payload: { token, amount: INICIO_KUSHKI },
  });

  const consulta = await app.inject({
    method: "GET",
    url: `/v1/sim/kushki/transfer/v1/status/${token}`,
  });

  return { emitido: 201, status: consulta.json().status };
}

describe("el escenario fija el desenlace al crear", () => {
  beforeEach(() => {
    resetSimulatorState();
  });

  afterEach(() => {
    resetSimulatorState();
  });

  describe("Rapyd, pago de PSE", () => {
    it("un pago creado con DECLINED nace declinado y se consulta declinado", async () => {
      const app = buildApp();

      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("DECLINED"),
        payload: PSE_RAPYD,
      });

      const id = creado.json().data.id;

      // Nace en el estado final, no pendiente: un pago declinado no tiene nada que
      // resolver después.
      expect(creado.json().data.status).toBe("ERR");

      const consulta = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
      });

      expect(consulta.json().data.status).toBe("ERR");
      expect(consulta.json().data.paid).toBe(false);

      await app.close();
    });

    it("un pago creado con EXPIRED nace expirado", async () => {
      const app = buildApp();

      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("EXPIRED"),
        payload: PSE_RAPYD,
      });

      expect(creado.json().data.status).toBe("EXP");

      const consulta = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${creado.json().data.id}`,
      });

      expect(consulta.json().data.status).toBe("EXP");

      await app.close();
    });

    it("sin escenario el pago de PSE se aprueba al consultarlo", async () => {
      const app = buildApp();

      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: PSE_RAPYD,
      });

      const id = creado.json().data.id;
      expect(creado.json().data.status).toBe("ACT");

      const consulta = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
      });

      expect(consulta.json().data.status).toBe("CLO");
      expect(consulta.json().data.paid).toBe(true);

      await app.close();
    });
  });

  describe("Mercado Pago, orden de PSE", () => {
    it("un PSE rechazado responde 402 con la orden en failed, como la API real", async () => {
      const app = buildApp();

      // No nace una orden: la API real responde 402 y la orden entera queda en `failed`.
      // Por eso esta ruta no necesita registrar ningún desenlace: no hay consulta que
      // responder.
      const respuesta = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { ...H("DECLINED"), "x-idempotency-key": "escenario-mp" },
        payload: ORDEN_MP,
      });

      expect(respuesta.statusCode).toBe(402);
      expect(respuesta.json().errors[0].code).toBe("failed");

      await app.close();
    });

    it("una orden creada con EXPIRED termina expired, no procesada", async () => {
      const app = buildApp();

      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { ...H("EXPIRED"), "x-idempotency-key": "escenario-mp-2" },
        payload: ORDEN_MP,
      });

      expect(creado.statusCode).toBe(201);
      const id = creado.json().id;
      expect(creado.json().status).toBe("action_required");

      const consulta = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/orders/${id}`,
      });

      // `expired | expired`, el par de la tabla oficial de estados de la orden, que tiene
      // `expired` y `canceled` como estados distintos. Lo que no puede ser es `processed`:
      // un cobro caducado reportado como cobrado.
      expect(consulta.json().status).toBe("expired");
      expect(consulta.json().status_detail).toBe("expired");

      await app.close();
    });

    it("acepta las dos cabeceras de escenario", async () => {
      const app = buildApp();

      // `x-simulate-scenario` y `x-simulator-scenario` se reconocen por igual. Antes la ruta de
      // órdenes solo leía la primera, así que mandar la segunda devolvía 201 con una orden
      // en `action_required` en vez del 402.
      for (const cabecera of ["x-simulator-scenario", "x-simulate-scenario"]) {
        resetSimulatorState();

        const respuesta = await app.inject({
          method: "POST",
          url: "/v1/sim/mercadopago/orders",
          headers: { [cabecera]: "DECLINED", "x-idempotency-key": `k-${cabecera}` },
          payload: ORDEN_MP,
        });

        expect(respuesta.statusCode).toBe(402);
      }

      await app.close();
    });
  });

  describe("Kushki, transferencia", () => {
    it("una transferencia creada con DECLINED termina declinada", async () => {
      const app = buildApp();

      // Antes el token y el `init` ignoraban el escenario: un `DECLINED` devolvía 201 y la
      // consulta sin cabecera respondía `approvedTransaction`. Solo se llegaba a
      // `declinedTransaction` enviando el escenario en la consulta.
      const resultado = await flujoKushki(app, "DECLINED");

      expect(resultado).toEqual({ emitido: 201, status: "declinedTransaction" });

      await app.close();
    });

    it("sin escenario la transferencia termina aprobada", async () => {
      const app = buildApp();

      const resultado = await flujoKushki(app, "");

      expect(resultado).toEqual({ emitido: 201, status: "approvedTransaction" });

      await app.close();
    });

    it("una transferencia con EXPIRED se rechaza con 501 y no deja token", async () => {
      const app = buildApp();

      // `expiredTransaction` solo aplica a México según la referencia de Kushki. Antes
      // `EXPIRED` no registraba nada y la transferencia terminaba `approvedTransaction`.
      const resultado = await flujoKushki(app, "EXPIRED");

      expect(resultado).toEqual({ emitido: 501 });
      expect(kushkiTransfers.size()).toBe(0);

      await app.close();
    });

    it("el escenario de la creación manda sobre el de una consulta posterior", async () => {
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
        payload: { token, amount: INICIO_KUSHKI },
      });

      // La consulta pide APPROVED, pero el desenlace ya lo decidió la creación.
      const consulta = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
        headers: H("APPROVED"),
      });

      expect(consulta.json().status).toBe("declinedTransaction");

      await app.close();
    });
  });

  describe("una falla técnica no crea ni muta estado", () => {
    it("Kushki: un TIMEOUT al emitir el token no deja transferencia", async () => {
      const app = buildApp();

      const emitido = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/tokens",
        headers: H("TIMEOUT"),
        payload: { bankId: "007", callbackUrl: "https://comercio.example.com/retorno" },
      });

      expect(emitido.statusCode).toBe(504);
      expect(kushkiTransfers.size()).toBe(0);

      // Un identificador con forma de token que nadie emitió: la consulta responde lo
      // mismo que Kushki ante una transferencia que no existe. Un error no es un cobro en
      // estado de error.
      const consulta = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/status/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      });

      expect(consulta.statusCode).toBe(400);
      expect(consulta.json().code).toBe("T004");

      await app.close();
    });

    it("Rapyd: un TIMEOUT al crear la página de pago no deja checkout", async () => {
      const app = buildApp();

      // Antes la ruta de checkout no tenía cadena de fallas técnicas: un TIMEOUT creaba
      // la página con 200 y la guardaba.
      const respuesta = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/checkout",
        headers: H("TIMEOUT"),
        payload: CHECKOUT_RAPYD,
      });

      expect(respuesta.statusCode).toBe(504);
      expect(rapydCheckouts.size()).toBe(0);

      await app.close();
    });

    it("Mercado Pago: un TIMEOUT al crear la orden no deja orden", async () => {
      const app = buildApp();

      // Antes solo la ruta de pagos tenía la cadena: un TIMEOUT en `POST /orders`
      // respondía 201 y guardaba la orden.
      const respuesta = await app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { ...H("TIMEOUT"), "x-idempotency-key": "escenario-mp-timeout" },
        payload: ORDEN_MP,
      });

      expect(respuesta.statusCode).toBe(504);
      expect(mercadopagoOrders.size()).toBe(0);

      await app.close();
    });

    it("Rapyd: un SERVER_ERROR al crear no deja pago consultable", async () => {
      const app = buildApp();

      const respuesta = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("SERVER_ERROR"),
        payload: PSE_RAPYD,
      });

      expect(respuesta.statusCode).toBe(500);

      const consulta = await app.inject({
        method: "GET",
        url: "/v1/sim/rapyd/payments/payment_9f8e7d6c5b4a39281706123456789abc",
      });

      expect(consulta.statusCode).toBe(400);
      expect(consulta.json().status.error_code).toBe("ERROR_GET_PAYMENT");

      await app.close();
    });

    it("un escenario técnico en la consulta no mueve un cobro ya creado", async () => {
      const app = buildApp();

      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: PSE_RAPYD,
      });

      const id = creado.json().data.id;

      // La consulta pide un 504. El cobro ya existía, así que la consulta lo responde: una
      // falla de transporte al consultar no deshace el cobro. Y el estado sigue el de la
      // creación.
      const consulta = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
        headers: H("TIMEOUT"),
      });

      expect(consulta.statusCode).toBe(200);
      expect(consulta.json().data.status).toBe("CLO");

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
   * Lo que falta es a propósito. La orden de Mercado Pago rechazada no nace (la API real
   * responde `402`, cubierto arriba). La página de Rapyd pendiente no tiene escenario: es la
   * que nadie visitó, que es lo medido.
   */
  describe("criterio 1: el estado de la creación es el de cada consulta", () => {
    const CASOS: { recurso: string; escenario: string; esperado: string }[] = [
      { recurso: "Wompi, tarjeta", escenario: "", esperado: "APPROVED" },
      { recurso: "Wompi, tarjeta", escenario: "DECLINED", esperado: "DECLINED" },
      { recurso: "Wompi, tarjeta", escenario: "PENDING", esperado: "PENDING" },
      { recurso: "Wompi, PSE", escenario: "", esperado: "APPROVED" },
      { recurso: "Wompi, PSE", escenario: "DECLINED", esperado: "DECLINED" },
      { recurso: "Wompi, PSE", escenario: "PENDING", esperado: "PENDING" },
      { recurso: "Rapyd, PSE", escenario: "", esperado: "CLO" },
      { recurso: "Rapyd, PSE", escenario: "DECLINED", esperado: "ERR" },
      { recurso: "Rapyd, PSE", escenario: "PENDING", esperado: "ACT" },
      { recurso: "Rapyd, página de pago visitada", escenario: "", esperado: "DON/CLO" },
      { recurso: "Rapyd, página de pago visitada", escenario: "DECLINED", esperado: "DON/ERR" },
      { recurso: "Rapyd, página de pago sin visitar", escenario: "", esperado: "NEW/null" },
      { recurso: "Mercado Pago, tarjeta", escenario: "", esperado: "approved" },
      { recurso: "Mercado Pago, tarjeta", escenario: "DECLINED", esperado: "rejected" },
      { recurso: "Mercado Pago, tarjeta", escenario: "PENDING", esperado: "in_process" },
      { recurso: "Mercado Pago, orden de PSE", escenario: "", esperado: "processed" },
      { recurso: "Mercado Pago, orden de PSE", escenario: "PENDING", esperado: "action_required" },
      { recurso: "Kushki, tarjeta", escenario: "", esperado: "APPROVAL" },
      { recurso: "Kushki, tarjeta", escenario: "DECLINED", esperado: "DECLINED" },
      { recurso: "Kushki, tarjeta", escenario: "PENDING", esperado: "INITIALIZED" },
      { recurso: "Kushki, transferencia", escenario: "", esperado: "approvedTransaction" },
      { recurso: "Kushki, transferencia", escenario: "DECLINED", esperado: "declinedTransaction" },
      { recurso: "Kushki, transferencia", escenario: "PENDING", esperado: "initializedTransaction" },
    ];

    it.each(CASOS)(
      "$recurso con escenario '$escenario' se consulta $esperado dos veces, con su monto y su referencia",
      async ({ recurso, escenario, esperado }) => {
        const app = buildApp();
        const { crear, consultar, monto, referencia } = RECURSOS[recurso];

        const id = await crear(app, escenario);
        const primera = await consultar(app, id);
        const segunda = await consultar(app, id);

        const creado = { status: esperado, monto, referencia };
        expect([primera, segunda]).toEqual([creado, creado]);

        await app.close();
      },
    );

    it("el pago que nace de una página declinada se consulta declinado en /payments", async () => {
      // Es la segunda consulta del SDK con tarjeta de Rapyd: primero el checkout, después
      // el pago por su id. Las dos tienen que decir lo mismo, y el `failure_code` es el que
      // hace que el normalizador lo lea como rechazo y no como error.
      const app = buildApp();
      const creado = (
        await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          headers: H("DECLINED"),
          payload: CHECKOUT_RAPYD,
        })
      ).json().data;

      const visita = await app.inject({
        method: "GET",
        url: new URL(creado.redirect_url).pathname,
      });

      expect(visita.json().paid).toBe(false);

      const pago = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${visita.json().payment_id}`,
      });

      expect(pago.json().data.status).toBe("ERR");
      expect(pago.json().data.paid).toBe(false);
      expect(pago.json().data.failure_code).toMatch(/^ERROR_PROCESSING_CARD/);

      await app.close();
    });

    it.each([["PENDING"], ["EXPIRED"]])(
      "una página de pago de Rapyd con %s responde 501 y no se guarda",
      async (escenario) => {
        // Aceptar el escenario sin aplicarlo dejaría pagar la página igual, que es el defecto
        // de la ronda anterior: el rechazo pedido terminaba en un pago cobrado.
        const app = buildApp();

        const respuesta = await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/checkout",
          headers: H(escenario),
          payload: CHECKOUT_RAPYD,
        });

        expect(respuesta.statusCode).toBe(501);
        expect(rapydCheckouts.size()).toBe(0);

        await app.close();
      },
    );

    it("un pago de tarjeta de Rapyd con PENDING responde 501", async () => {
      // `PENDING` solo existe para PSE en `/payments`: con tarjeta el pago nace cerrado.
      const app = buildApp();

      const respuesta = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("PENDING"),
        payload: { ...PSE_RAPYD, payment_method: { type: "co_visa_card" } },
      });

      expect(respuesta.statusCode).toBe(501);

      await app.close();
    });
  });

  /*
   * La regla de las rutas de creación: una falla técnica sale por `technicalFailure`, un
   * desenlace declarado por su destino, y cualquier otro escenario responde `501` sin
   * guardar nada. Antes la orden de Mercado Pago y el token de Kushki aceptaban `FOO` o
   * `FLAPPING` con `201` y el cobro terminaba aprobado.
   */
  describe("un escenario que la creación no sabe producir responde 501", () => {
    const crearOrden = (app: App, escenario: string) =>
      app.inject({
        method: "POST",
        url: "/v1/sim/mercadopago/orders",
        headers: { ...H(escenario), "x-idempotency-key": `mp-${++llaveMp}` },
        payload: ORDEN_MP,
      });

    const emitirToken = (app: App, escenario: string) =>
      app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/tokens",
        headers: H(escenario),
        payload: TOKEN_KUSHKI,
      });

    it.each(["FOO", "DUPLICATE_PAYMENT"])(
      "Mercado Pago: una orden con %s responde 501 y no deja orden",
      async (escenario) => {
        const app = buildApp();

        const respuesta = await crearOrden(app, escenario);

        expect(respuesta.statusCode).toBe(501);
        expect(respuesta.json().error).toContain(escenario);
        expect(mercadopagoOrders.size()).toBe(0);

        await app.close();
      },
    );

    it.each(["FOO", "DUPLICATE_PAYMENT"])(
      "Kushki: un token de PSE con %s responde 501 y no deja transferencia",
      async (escenario) => {
        const app = buildApp();

        const respuesta = await emitirToken(app, escenario);

        expect(respuesta.statusCode).toBe(501);
        expect(respuesta.json().error).toContain(escenario);
        expect(kushkiTransfers.size()).toBe(0);

        await app.close();
      },
    );

    it("Mercado Pago: una orden con FLAPPING falla dos veces y después se crea", async () => {
      const app = buildApp();

      const primera = await crearOrden(app, "FLAPPING");
      const segunda = await crearOrden(app, "FLAPPING");
      expect([primera.statusCode, segunda.statusCode]).toEqual([503, 503]);
      expect(mercadopagoOrders.size()).toBe(0);

      const tercera = await crearOrden(app, "FLAPPING");
      expect(tercera.statusCode).toBe(201);

      const consulta = await app.inject({
        method: "GET",
        url: `/v1/sim/mercadopago/orders/${tercera.json().id}`,
      });
      expect(consulta.json().status).toBe("processed");

      await app.close();
    });

    it("Kushki: un token de PSE con FLAPPING falla dos veces y después se emite", async () => {
      const app = buildApp();

      const primera = await emitirToken(app, "FLAPPING");
      const segunda = await emitirToken(app, "FLAPPING");
      expect([primera.statusCode, segunda.statusCode]).toEqual([503, 503]);
      expect(kushkiTransfers.size()).toBe(0);

      const tercera = await emitirToken(app, "FLAPPING");
      expect(tercera.statusCode).toBe(201);
      const { token } = tercera.json();

      await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: { token, amount: INICIO_KUSHKI },
      });
      const consulta = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
      });
      expect(consulta.json().status).toBe("approvedTransaction");

      await app.close();
    });
  });

  describe("el estado de un cobro no depende de cómo se lo consulta", () => {
    it("preguntar el mismo cobro dos veces con cabeceras distintas da el mismo estado", async () => {
      const app = buildApp();

      const creado = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        headers: H("DECLINED"),
        payload: PSE_RAPYD,
      });

      const id = creado.json().data.id;

      const conApproved = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
        headers: H("APPROVED"),
      });

      const sinCabecera = await app.inject({
        method: "GET",
        url: `/v1/sim/rapyd/payments/${id}`,
      });

      // Con el simulador anterior la consulta no miraba ni la cabecera ni el pago creado:
      // devolvía `CLO` con `paid: true` y `amount: "0"` para cualquier identificador, así
      // que este pago declinado se reportaba cobrado.
      expect(conApproved.json().data.status).toBe("ERR");
      expect(sinCabecera.json().data.status).toBe("ERR");

      await app.close();
    });
  });
});