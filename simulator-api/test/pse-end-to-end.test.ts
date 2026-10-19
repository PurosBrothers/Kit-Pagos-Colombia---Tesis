import { FastifyInstance } from "fastify";
import { buildSignedApp } from "./helpers/signedRequests";

/**
 * Endpoints que PSE agrego a las cuatro pasarelas: la lista de bancos en las cuatro,
 * la secuencia de dos llamadas de Rapyd y el Transfer In de Kushki.
 *
 * Las formas replican lo medido contra las APIs reales el 18 de septiembre de 2026,
 * salvo las de Kushki, donde no hubo credenciales de API y vienen de su referencia.
 */
describe("PSE in the four gateways", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // La app completa y no las cuatro rutas sueltas: las de Wompi y Rapyd verifican la firma
    // con el `credentialResolver` que decora `buildApp()` (punto 86).
    app = buildSignedApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("bank list", () => {
    /**
     * Los tres bancos de prueba de Wompi no son bancos: sus codigos fuerzan cada
     * desenlace, y los nombres lo dicen. El mock los devuelve tal cual porque
     * disimularlos le esconderia al comercio contra que entorno apunta.
     */
    it("Wompi returns the three test banks with their real names", async () => {
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
    it("Mercado Pago nests the banks inside the methods catalog", async () => {
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

    it("Rapyd mixes the 47 PSE methods with the rest of the country catalog", async () => {
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

    it("Kushki returns the list on its own route", async () => {
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

  describe("Rapyd: the two PSE calls", () => {
    it("creates the customer with the cus_ prefix", async () => {
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

    it("rejects the customer without a name with Rapyd's own code", async () => {
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
    it("rejects the PSE payment without a previous customer", async () => {
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
    it("returns ACT, unpaid, and with the redirect in the same response", async () => {
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
    it("embeds the merchant's return URLs in the redirect", async () => {
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

    it("the card path still returns CLO and paid", async () => {
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

  /*
   * Los tres pasos se ejecutan de verdad: se pide un token, se inicia con el que se
   * emissions y se consulta ese mismo token.
   *
   * Antes estas pruebas usaban el literal `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4` en el `init`
   * y en la consulta, sin haberlo emitido nunca. El mock respondía `200` y
   * `approvedTransaction` a cualquier identificador, así que el ciclo completo no estaba
   * probado en ninguna parte: lo que se probaba era que un identificador inventado
   * devolviera un estado inventado. Ese es el defecto que reporta el issue #124, y la
   * forma de cubrirlo es el ciclo entero.
   */
  describe("Kushki: the three Transfer In steps", () => {
    /** Emite un token real y lo devuelve, para que el resto del ciclo lo use. */
    async function issueToken(scenario?: string) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/tokens",
        headers: scenario ? { "x-simulate-scenario": scenario } : {},
        payload: {
          bankId: "007",
          callbackUrl: "https://comercio.example.com/retorno",
          documentType: "CC",
          documentNumber: "1099888777",
        },
      });

      return response.json().token as string;
    }

    /** Inicia la transferencia de un token y devuelve la respuesta. */
    function initiate(token: string, amount = 150000) {
      return app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: {
          token,
          amount: { subtotalIva0: amount, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
        },
      });
    }

    it("issues a 32-character token", async () => {
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

    /*
     * Los dos campos sin los que el paso del token no tendria sentido: el banco que
     * el pagador eligio y la URL a la que volver. Si el adaptador dejara de mandar
     * cualquiera de los dos, el mock lo dice.
     */
    it.each([
      ["bankId", { callbackUrl: "https://comercio.example.com/retorno" }],
      ["callbackUrl", { bankId: "007" }],
    ])("rejects the token without %s", async (_field, payload) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/tokens",
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    /*
     * Responde 201 y sin campo de estado, que es la forma medida contra la API UAT:
     * `bankId`, `bankName`, `redirectUrl`, `transactionReference` y `trazabilityCode`.
     */
    it("initiates the transfer and returns the redirect URL", async () => {
      const token = await issueToken();
      const response = await initiate(token);

      expect(response.statusCode).toBe(201);
      expect(response.json().redirectUrl).toContain(token);
      expect(response.json().trazabilityCode).toBeDefined();
      // La respuesta medida del `init` no trae estado: el cobro se decide en la consulta.
      expect(response.json().status).toBeUndefined();
    });

    it("rejects the init without a token", async () => {
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
    it("rejects the init without the amount, because the real API requires it twice", async () => {
      const token = await issueToken();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/transfer/v1/init",
        payload: { token },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("T001");
    });

    it("does not initiate a transfer that was not created", async () => {
      // Antes el `init` respondía `201` para cualquier token. `400 T004` es lo que
      // respondió Kushki UAT el 5 de octubre de 2026 a un token de 32 caracteres que no
      // emitió.
      const response = await initiate("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "T004", message: "No existe la transacción" });
    });

    it("validates the init body before the token's existence", async () => {
      // Medido el 5 de octubre de 2026: `{ token: "abc123", amount }` responde `T001`, no
      // `T004`, aunque el token tampoco exista.
      const response = await initiate("abc123");

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("T001");
    });

    /**
     * La forma es la medida: `token` y `status` en la raiz, sin `ticketNumber` ni
     * `transaction_status`, que son del vocabulario de tarjeta.
     */
    it("queries the transfer status by token", async () => {
      const token = await issueToken();
      await initiate(token);

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().token).toBe(token);
      expect(response.json().status).toBe("approvedTransaction");
      expect(response.json().ticketNumber).toBeUndefined();
    });

    it("reports the amount charged at init, not the token's estimate", async () => {
      const token = await issueToken();
      await initiate(token, 240000);

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
      });

      // El monto de Kushki es el desglose, no un número suelto.
      expect(response.json().amount.subtotalIva0).toBe(240000);
      expect(response.json().amount.currency).toBe("COP");
    });

    /**
     * Esta ruta no contesta por un cobro con tarjeta.
     *
     * Importa porque el adaptador prueba las dos rutas de consulta en orden: si esta
     * respondiera a cualquier identificador, un cobro con tarjeta se reportaría con el
     * vocabulario de transferencia (`approvedTransaction` en vez de `APPROVAL`) y el orden
     * de las rutas no se ejercitaría nunca. Lo que decide la respuesta de Kushki es la
     * longitud (medido el 5 de octubre de 2026): 32 caracteres el token de transferencia,
     * 18 el ticket de tarjeta.
     */
    it("does not answer for a card ticket, which belongs to another method", async () => {
      // `400 T001` es lo que respondió Kushki UAT por esta ruta ante un identificador de
      // 18 caracteres (`docs/testing-data/kushki.md`).
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/status/a263b3997a5b446985",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "T001", message: "Cuerpo de la petición inválido." });
    });

    it("returns 400 T004 if the token has 32 characters and was not issued", async () => {
      // Antes la ruta respondía `200 approvedTransaction` a cualquier cosa.
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/transfer/v1/status/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "T004", message: "No existe la transacción" });
    });

    it("decides by the length and not by the identifier's alphabet", async () => {
      // Medido el 5 de octubre de 2026: 32 caracteres no hexadecimales y en mayúsculas
      // también dan `T004`; 31 y 33 dan `T001`.
      const queryStatus = (id: string) =>
        app.inject({ method: "GET", url: `/v1/sim/kushki/transfer/v1/status/${id}` });

      expect((await queryStatus("ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ")).json().code).toBe("T004");
      expect((await queryStatus("a".repeat(31))).json().code).toBe("T001");
      expect((await queryStatus("a".repeat(33))).json().code).toBe("T001");
    });

    /*
     * El estado que no es final, el que el ciclo necesita para poder ejercitarse, se
     * observa con un escenario pedido en la creación del token. Antes se pedía en la
     * consulta, con lo que el mismo token podía reportarse `initializedTransaction` o
     * `approvedTransaction` según la cabecera de quien preguntara.
     */
    it("reports initializedTransaction in the pending scenario", async () => {
      const token = await issueToken("PENDING");
      await initiate(token);

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
      });

      expect(response.json().status).toBe("initializedTransaction");
    });

    it("returns declinedTransaction for the declined scenario", async () => {
      // Antes `declinedTransaction` solo se alcanzaba enviando el escenario en la consulta:
      // el token y el `init` lo ignoraban. Con el escenario registrado en el paso del token,
      // el rechazo lo decide la creación.
      const token = await issueToken("DECLINED");
      await initiate(token);

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
      });

      expect(response.json().status).toBe("declinedTransaction");
    });

    it("does not change the outcome if the query asks for the opposite", async () => {
      const token = await issueToken("DECLINED");
      await initiate(token);

      const withApproved = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
        headers: { "x-simulate-scenario": "APPROVED" },
      });
      const withoutHeader = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/transfer/v1/status/${token}`,
      });

      expect(withApproved.json().status).toBe("declinedTransaction");
      expect(withoutHeader.json().status).toBe("declinedTransaction");
    });

    /**
     * El 403 no es un detalle del mock: es lo que la API real contesta en
     * `GET /charges/{id}` para cualquier identificador, incluso para uno que no existe.
     * Por eso el SDK consulta la ruta de transferencia primero: por esta no se puede
     * encadenar nada.
     */
    it("answers 403 when a transfer token is queried as if it were a card", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/charges/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      });

      expect(response.statusCode).toBe(403);
    });

    it("answers 404 to a card ticket that was not created, not 200 with another charge's data", async () => {
      // Antes esta ruta armaba un cargo de 50.000 para cualquier identificador de 18
      // caracteres, así que un ticket inexistente pasaba por cobrado. Con el cargo guardado
      // al crearlo, la respuesta es un 404. `K404` es un código del simulador: esta ruta no
      // existe en Kushki, así que no hay respuesta real que imitar.
      const response = await app.inject({
        method: "GET",
        url: "/v1/sim/kushki/charges/123456789012345678",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("K404");
    });

    it("answers 200 to the card ticket that was created, with its real status", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/v1/sim/kushki/card/v1/charges",
        headers: { "x-simulate-scenario": "DECLINED" },
        payload: {
          token: "tok_kushki_pse_completo",
          amount: { subtotalIva0: 150000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
          contactDetails: { email: "cliente@example.com" },
        },
      });

      const { ticketNumber } = created.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/sim/kushki/charges/${ticketNumber}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ticketNumber).toBe(ticketNumber);
      expect(response.json().details.transactionStatus).toBe("DECLINED");
    });
  });
});
