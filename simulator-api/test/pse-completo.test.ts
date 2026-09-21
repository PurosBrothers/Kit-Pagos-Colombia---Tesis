import Fastify, { FastifyInstance } from "fastify";
import { wompiRoutes } from "../src/routes/wompi";
import { mercadopagoRoutes } from "../src/routes/mercadopago";
import { rapydRoutes } from "../src/routes/rapyd";
import { kushkiRoutes } from "../src/routes/kushki";

/**
 * Endpoints que PSE agrego a las cuatro pasarelas: la lista de bancos en las cuatro,
 * la secuencia de dos llamadas de Rapyd y el Transfer In de Kushki.
 *
 * Las formas replican lo medido contra las APIs reales el 18 de septiembre de 2026,
 * salvo las de Kushki, donde no hubo credenciales de API y vienen de su referencia.
 */
describe("PSE en las cuatro pasarelas", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(wompiRoutes);
    await app.register(mercadopagoRoutes);
    await app.register(rapydRoutes);
    await app.register(kushkiRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("lista de bancos", () => {
    /**
     * Los tres bancos de prueba de Wompi no son bancos: sus codigos fuerzan cada
     * desenlace, y los nombres lo dicen. El mock los devuelve tal cual porque
     * disimularlos le esconderia al comercio contra que entorno apunta.
     */
    it("Wompi devuelve los tres bancos de prueba con sus nombres reales", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/wompi/pse/financial_institutions",
      });

      expect(response.statusCode).toBe(200);
      const { data } = response.json();
      expect(data).toHaveLength(3);
      expect(data[0]).toEqual({
        financial_institution_code: "1",
        financial_institution_name: "Banco que aprueba",
      });
      expect(data[1].financial_institution_name).toContain("declina");
    });

    /**
     * Mercado Pago no tiene endpoint de bancos: los anida en la entrada `pse` de su
     * catalogo de metodos. El mock incluye un metodo que **no** es PSE a proposito,
     * para que una prueba del filtro no pueda pasar sin filtrar.
     */
    it("Mercado Pago anida los bancos dentro del catalogo de metodos", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/mercadopago/payment_methods",
      });

      expect(response.statusCode).toBe(200);
      const methods = response.json();
      const pse = methods.find((m: { id: string }) => m.id === "pse");

      expect(pse).toBeDefined();
      expect(pse.payment_type_id).toBe("bank_transfer");
      expect(pse.financial_institutions.length).toBeGreaterThan(0);
      expect(pse.financial_institutions[0]).toHaveProperty("description");
      // El monto minimo medido, que el SDK todavia no lee.
      expect(pse.min_allowed_amount).toBe(1600);
      expect(methods.some((m: { id: string }) => m.id !== "pse")).toBe(true);
    });

    it("Rapyd mezcla los 47 metodos de PSE con el resto del catalogo del pais", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/rapyd/payment_methods/country?country=CO",
      });

      expect(response.statusCode).toBe(200);
      const { data } = response.json();
      const pse = data.filter((m: { type: string }) => m.type.startsWith("co_pse_"));

      expect(pse.length).toBeGreaterThan(0);
      expect(pse[0].category).toBe("bank_redirect");
      // La entrada que hay que descartar: sin ella el filtro no se prueba.
      expect(data.some((m: { type: string }) => !m.type.startsWith("co_pse_"))).toBe(true);
    });

    it("Kushki devuelve la lista en su propia ruta", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/bankList",
      });

      expect(response.statusCode).toBe(200);
      const banks = response.json();
      expect(banks.length).toBeGreaterThan(0);
      expect(banks[0]).toHaveProperty("code");
      expect(banks[0]).toHaveProperty("name");
    });
  });

  describe("Rapyd: las dos llamadas de PSE", () => {
    it("crea el cliente con el prefijo cus_", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/customers",
        payload: {
          name: "Jaime Pavlich Mariscal",
          email: "cliente@example.com",
          phone_number: "3001234567",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.id).toMatch(/^cus_[0-9a-f]{32}$/);
    });

    it("rechaza el cliente sin nombre con el codigo propio de Rapyd", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/customers",
        payload: { email: "cliente@example.com" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().status.error_code).toBe("INVALID_CUSTOMER_NAME");
    });

    /**
     * El rechazo del pago sin cliente es lo que hace que la secuencia sea
     * verificable: si el adaptador se saltara la primera llamada, el mock lo delata
     * con el mismo codigo que devolvio el sandbox real.
     */
    it("rechaza el pago de PSE sin cliente previo", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: {
          amount: "150000.00",
          currency: "COP",
          merchant_reference_id: "ord-1",
          payment_method: { type: "co_pse_bancolombia_bank" },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().status.error_code).toContain("CUSTOMER");
    });

    /**
     * La diferencia con tarjeta esta en tres campos a la vez: `ACT` en vez de `CLO`,
     * `paid: false` en vez de `true`, y una `redirect_url` que en tarjeta no existe.
     */
    it("devuelve ACT, sin pagar, y con la redireccion en la misma respuesta", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: {
          amount: "150000.00",
          currency: "COP",
          merchant_reference_id: "ord-1",
          customer: "cus_01f2f7ddace1fc8aa19ae9c535d7fb57",
          payment_method: { type: "co_pse_bancolombia_bank" },
          complete_payment_url: "https://comercio.example.com/exito",
          error_payment_url: "https://comercio.example.com/error",
        },
      });

      expect(response.statusCode).toBe(201);
      const { data } = response.json();
      expect(data.status).toBe("ACT");
      expect(data.paid).toBe(false);
      expect(data.next_action).toBe("pending_confirmation");
      expect(data.redirect_url).toContain("complete-bank-payment");
    });

    /**
     * Rapyd incrusta las dos URL del comercio dentro de la de redireccion. Es la
     * unica evidencia observable de que el SDK las envio, asi que el mock la
     * reproduce.
     */
    it("incrusta las URL de retorno del comercio en la redireccion", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: {
          amount: "150000.00",
          currency: "COP",
          merchant_reference_id: "ord-1",
          customer: "cus_abc",
          payment_method: { type: "co_pse_bancolombia_bank" },
          complete_payment_url: "https://comercio.example.com/exito",
          error_payment_url: "https://comercio.example.com/error",
        },
      });

      const url = response.json().data.redirect_url;
      expect(url).toContain(encodeURIComponent("https://comercio.example.com/exito"));
      expect(url).toContain(encodeURIComponent("https://comercio.example.com/error"));
    });

    it("el camino de tarjeta sigue devolviendo CLO y pagado", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/rapyd/payments",
        payload: {
          amount: "150000.00",
          currency: "COP",
          merchant_reference_id: "ord-1",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.status).toBe("CLO");
      expect(response.json().data.paid).toBe(true);
    });
  });

  describe("Kushki: los tres pasos de Transfer In", () => {
    it("emite un token de 32 caracteres", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/tokens",
        payload: {
          bankId: "007",
          callbackUrl: "https://comercio.example.com/retorno",
          documentType: "CC",
          documentNumber: "1099888777",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().token).toMatch(/^[0-9a-f]{32}$/);
    });

    /**
     * Los dos campos sin los que el paso del token no tendria sentido: el banco que
     * el pagador eligio y la URL a la que volver. Si el adaptador dejara de mandar
     * cualquiera de los dos, el mock lo dice.
     */
    it.each([
      ["bankId", { callbackUrl: "https://comercio.example.com/retorno" }],
      ["callbackUrl", { bankId: "007" }],
    ])("rechaza el token sin %s", async (_campo, payload) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/tokens",
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    /**
     * Responde 201 y sin campo de estado, que es la forma medida contra la API UAT:
     * `bankId`, `bankName`, `redirectUrl`, `transactionReference` y `trazabilityCode`.
     */
    it("inicia la transferencia y devuelve la URL de redireccion", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: {
          token: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
          amount: { subtotalIva0: 150000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().redirectUrl).toContain("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
      expect(response.json().trazabilityCode).toBeDefined();
      expect(response.json().status).toBeUndefined();
    });

    it("rechaza el inicio sin token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    /**
     * Kushki exige el monto en el inicio aunque ya viajo al pedir el token. Medido: el
     * token solo responde `400 T001`, y con el monto responde `201`.
     */
    it("rechaza el inicio sin el monto, porque la API real lo exige dos veces", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: { token: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("T001");
    });

    /**
     * La forma es la medida: `token` y `status` en la raiz, sin `ticketNumber` ni
     * `transaction_status`, que son del vocabulario de tarjeta.
     */
    it("consulta el estado de la transferencia por token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/status/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().token).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
      expect(response.json().status).toBe("approvedTransaction");
      expect(response.json().ticketNumber).toBeUndefined();
    });

    /**
     * Esta ruta no contesta por un cobro con tarjeta.
     *
     * Importa porque el adaptador prueba las dos rutas de consulta en orden: si esta
     * respondiera a cualquier identificador, un cobro con tarjeta se reportaría con el
     * vocabulario de transferencia (`approvedTransaction` en vez de `APPROVAL`) y el orden
     * de las rutas no se ejercitaría nunca. Se distinguen por su forma: 32 caracteres hex
     * el token de transferencia, 18 el ticket de tarjeta.
     */
    it("no contesta por un ticket de tarjeta, que es de otro método", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/status/a263b3997a5b446985",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("T004");
    });

    /** El estado no final tiene que ser el nativo de transferencia, no el de tarjeta. */
    it("reporta initializedTransaction en el escenario pendiente", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/status/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        headers: { "x-simulate-scenario": "PENDING" },
      });

      expect(response.json().status).toBe("initializedTransaction");
    });

    /**
     * El 403 no es un detalle del mock: es lo que la API real contesta en
     * `GET /charges/{id}` para cualquier identificador, incluso para uno que no existe.
     * Por eso el SDK consulta la ruta de transferencia primero: por esta no se puede
     * encadenar nada.
     */
    it("responde 403 cuando se consulta un token de transferencia como si fuera tarjeta", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/charges/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      });

      expect(response.statusCode).toBe(403);
    });

    it("sigue respondiendo 200 a un ticket de tarjeta", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/charges/123456789012345678",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ticketNumber).toBe("123456789012345678");
    });
  });
});
