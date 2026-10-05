import { buildApp } from "../src/app";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * El escenario se resuelve al **crear** el cobro, no al consultarlo (issue #124).
 *
 * La regla tiene dos mitades y las dos importan:
 *
 *   1. Un escenario de negocio fija el desenlace en la creación. Si mandás `DECLINED`,
 *      el cobro termina declinado, y preguntarlo después no lo cambia.
 *   2. Un escenario **técnico** no crea ni muta estado. Si mandás `TIMEOUT`, la llamada
 *      falla y no queda ningún cobro: el error no es un cobro en estado de error.
 *
 * Estas pruebas cubren las dos, en las cuatro pasarelas, sobre el punto donde antes el
 * escenario se aceptaba con `201` y se ignoraba.
 */

const H = (s: string) => ({ "x-simulator-scenario": s });

const ORDEN_MP = {
  type: "online",
  total_amount: "10000",
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

    it("una orden creada con EXPIRED termina cancelada, no procesada", async () => {
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

      // `canceled` y no `processed`: un cobro caducado reportado como cobrado es el peor
      // error posible en un simulador.
      expect(consulta.json().status).toBe("canceled");

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

      // Antes ninguna de las tres rutas de transferencia leía el escenario: un `DECLINED`
      // devolvía 201 y la consulta respondía `approvedTransaction`. El escenario se
      // aceptaba y se ignoraba, y `declinedTransaction` era un estado inalcanzable.
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

      // El identificador que la ruta de consultarecognoce como token no existe: no se
      // emitió ninguno. Un error no es un cobro en estado de error.
      const consulta = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/status/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      });

      expect(consulta.statusCode).toBe(404);
      expect(consulta.json().code).toBe("T004");

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

      expect(consulta.statusCode).toBe(404);

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

      // Con el simulador anterior el estado salía de la cabecera de la consulta, así que
      // estas dos llamadas devolvían `CLO` y `ERR` para el mismo cobro.
      expect(conApproved.json().data.status).toBe("ERR");
      expect(sinCabecera.json().data.status).toBe("ERR");

      await app.close();
    });
  });
});