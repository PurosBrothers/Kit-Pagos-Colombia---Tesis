import { FastifyInstance } from "fastify";
import {
  Gateway,
  KitPagos,
  KitPagosError,
  KitPagosErrorCode,
  PseBank,
} from "kit-pagos-colombia";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { KitPagosProvider } from "../src/services/KitPagosProvider";

/**
 * Sin `...process.env`: un `WOMPI_BASE_URL` en la terminal de quien corre la
 * prueba ganaría sobre `SIMULATOR_SDK_BASE_URL` y la mandaría a una API real.
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

function appWith(env: Record<string, string | undefined>): FastifyInstance {
  const credentialResolver = new CredentialResolver(env);
  return buildApp({
    logger: false,
    credentialResolver,
    kitPagosProvider: new KitPagosProvider(credentialResolver, env),
  });
}

function cardPayload(gateway: string, amount: string) {
  return {
    gateway,
    amount,
    currency: "COP",
    orderReference: `ORDER-READ-${gateway}-${Date.now()}`,
    payer: { email: "lector@example.com", fullName: "Camila Rojas" },
    paymentMethod: { type: "CARD", token: "tok_test_read_123", installments: 1 },
  };
}

const PSE_PAYER = {
  email: "pagador.pse@example.com",
  fullName: "Felipe Ruiz",
  documentType: "CC",
  documentNumber: "1020304050",
  phone: "3001234567",
};

function kushkiPse(amount: string) {
  return {
    gateway: "kushki",
    amount,
    currency: "COP",
    orderReference: `ORDER-READ-KUSHKI-${Date.now()}`,
    payer: PSE_PAYER,
    paymentMethod: { type: "PSE", bankCode: "0001" },
    returnUrlConfig: { returnUrl: "https://comercio.example.com/retorno" },
    taxBreakdown: { rate: "0.19" },
  };
}

/**
 * Los cuatro caminos de lectura y el estado exacto que cada mock devuelve.
 *
 * Los valores no están inventados para que la prueba pase: cada uno sale de la fábrica
 * del simulador y de la tabla de estados nativos del SDK, y la prueba falla si alguno de
 * los dos cambia. `toBeDefined()` no detectaría ni un cambio de vocabulario ni una
 * traducción equivocada, que es justo lo que estas rutas existen para no perder.
 *
 * - **Wompi, tarjeta:** nace `PENDING` y resuelve en la *primera* consulta
 *   (`advanceCardTransaction`, `routes/wompi.ts`).
 * - **Mercado Pago, tarjeta:** la consulta devuelve aprobado por omisión
 *   (`buildApprovedResponse`), en minúsculas.
 * - **Rapyd, tarjeta:** la tarjeta va por la página de pago alojada, y el `id` que se
 *   devuelve es el del *checkout*, no el de un pago. Mientras nadie paga, el checkout
 *   queda en `NEW` con `payment.id` en `null` (`rapyd-checkout.ts`), que es una
 *   transacción pendiente de verdad.
 * - **Kushki, PSE:** el identificador es el *token* de la transferencia y la consulta va
 *   a `/transfer/v1/status/{token}`, que responde con el vocabulario de transferencia.
 *   Kushki con tarjeta no entra aquí: su ruta de consulta es un 400 `UNSUPPORTED_OPERATION`
 *   que ya cubre otra prueba de este archivo.
 */
const READ_CASES = [
  {
    gateway: "mercadopago",
    methodLabel: "card",
    create: () => cardPayload("mercadopago", "50000.00"),
    idOf: (body: { transaction?: { gatewayTransactionId: string } }) =>
      body.transaction!.gatewayTransactionId,
    status: "APPROVED",
    rawStatus: "approved",
  },
  {
    gateway: "rapyd",
    methodLabel: "card",
    create: () => cardPayload("rapyd", "50000.00"),
    idOf: (body: { redirect?: { gatewayTransactionId: string } }) =>
      body.redirect!.gatewayTransactionId,
    status: "PENDING",
    rawStatus: "NEW",
  },
  {
    gateway: "kushki",
    methodLabel: "PSE",
    create: () => kushkiPse("119000.00"),
    idOf: (body: { redirect?: { gatewayTransactionId: string } }) =>
      body.redirect!.gatewayTransactionId,
    status: "APPROVED",
    rawStatus: "approvedTransaction",
  },
];

describe("GET /v1/api/payments/:id (issue #103)", () => {
  let app: FastifyInstance;
  const testEnv: Record<string, string | undefined> = { ...SERVER_CREDENTIALS };

  beforeAll(async () => {
    app = appWith(testEnv);
    // La misma app sirve de simulador: el SDK le consulta por /v1/sim.
    testEnv.SIMULATOR_SDK_BASE_URL = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("should return 200 with the normalized and native status of a stored transaction", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/api/payments",
      payload: cardPayload("wompi", "50000.00"),
    });
    expect(created.statusCode).toBe(201);
    const txId = created.json().transaction.gatewayTransactionId;

    const res = await app.inject({
      method: "GET",
      url: `/v1/api/payments/${txId}?gateway=wompi`,
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.gateway).toBe("wompi");
    expect(data.transaction.gatewayTransactionId).toBe(txId);
    // Estado normalizado + estado nativo de la pasarela. Un cobro con tarjeta de Wompi
    // nace PENDING y resuelve en la primera consulta, así que el valor exacto es APPROVED.
    expect(data.transaction.status).toBe("APPROVED");
    expect(data.transaction.rawStatus).toBe("APPROVED");
    expect(data.transaction.orderReference).toMatch(/^ORDER-READ-wompi-/);
    expect(data.transaction.amount).toBe("50000.00");
    expect(data.transaction.currency).toBe("COP");
  });

  /**
   * La misma consulta en las otras tres pasarelas, con el valor exacto y no
   * `toBeDefined()`: es lo que distingue una traducción correcta de una que por
   * casualidad existe.
   */
  it.each(READ_CASES)(
    "should return the exact native status of a $gateway $methodLabel payment",
    async ({ gateway, create, idOf, status, rawStatus }) => {
      const created = await app.inject({
        method: "POST",
        url: "/v1/api/payments",
        payload: create(),
      });
      expect(created.statusCode).toBe(201);

      const res = await app.inject({
        method: "GET",
        url: `/v1/api/payments/${idOf(created.json())}?gateway=${gateway}`,
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.gateway).toBe(gateway);
      // El estado normalizado y el nativo viajan juntos y no se pueden pisar entre sí.
      expect(data.transaction.status).toBe(status);
      expect(data.transaction.rawStatus).toBe(rawStatus);
    },
  );

  it("should answer 404 with RESOURCE_NOT_FOUND for a stored transaction that does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/api/payments/tx-que-no-existe?gateway=wompi",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe(KitPagosErrorCode.RESOURCE_NOT_FOUND);
  });

  it("should answer 400 when the gateway query parameter is missing or unknown", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/v1/api/payments/tx-cualquiera",
    });
    expect(missing.statusCode).toBe(400);

    const unknown = await app.inject({
      method: "GET",
      url: "/v1/api/payments/tx-cualquiera?gateway=paypal",
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe(KitPagosErrorCode.INVALID_REQUEST);
    // El mensaje no repite el valor recibido a propósito (gateway-param.ts).
    expect(unknown.json().message).toContain("Supported gateways");
  });

  /**
   * Consultar una tarjeta en Kushki responde 400 con UNSUPPORTED_OPERATION y
   * no lo disfraza de 404: Kushki no tiene ruta de consulta de cobros con
   * tarjeta, y el adaptador produce el error tras probar las rutas que existen.
   *
   * Se inyecta un KitPagos que lanza ese código desde getPaymentStatus(): el
   * simulador no lo genera por sí solo, porque su GET /charges/:ticketNumber
   * responde 200 a tickets de tarjeta a propósito (punto 50 del architecture-log).
   */
  it("should answer 400 UNSUPPORTED_OPERATION for a Kushki card query, not 404", async () => {
    const failingKitPagos = {
      getPaymentStatus: () =>
        Promise.reject(
          new KitPagosError(
            KitPagosErrorCode.UNSUPPORTED_OPERATION,
            Gateway.KUSHKI,
            null,
            "Kushki no permite consultar un cobro con tarjeta",
          ),
        ),
    } as unknown as KitPagos;

    const fakeProvider = {
      resolveClient: () => ({
        kitPagos: failingKitPagos,
        target: "simulator" as const,
      }),
      resolveBaseUrl: () => undefined,
    } as unknown as KitPagosProvider;

    const standalone = buildApp({ logger: false, kitPagosProvider: fakeProvider });
    try {
      const res = await standalone.inject({
        method: "GET",
        url: "/v1/api/payments/cualquier-ticket?gateway=kushki",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
    } finally {
      await standalone.close();
    }
  });

  /**
   * La regla de credenciales del punto 69 tiene que cumplirse también en las lecturas,
   * y no basta con que la ruta "use `gatewayClientFor()`": eso es lo que dice el
   * comentario del código, y no es lo que una prueba verifica.
   *
   * Si alguien reemplaza `gatewayClientFor(app, request, reply, gateway)` por
   * `app.kitPagosProvider.resolveClient(...).kitPagos` en estas dos rutas, las pruebas
   * de abajo se ponen rojas: contra producción dejaría de responder 401 antes de
   * llamar a la pasarela, y contra el sandbox real se perdería la advertencia. Esa es
   * exactamente la mutación que se hizo en la revisión de #118.
   */
  describe("when the gateway points at a real API", () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ error: "stubbed" }), { status: 401 }));
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("should refuse the server credentials on GET /payments/:id against production without calling the gateway", async () => {
      const production = appWith(SERVER_CREDENTIALS);

      const response = await production.inject({
        method: "GET",
        url: "/v1/api/payments/tx-cualquiera?gateway=wompi",
        headers: { "x-kit-pagos-environment": "production" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().message).toContain("producción");
      expect(fetchSpy).not.toHaveBeenCalled();
      await production.close();
    });

    it("should warn in the header and the body of GET /payments/:id when it falls back to the server credentials in a sandbox", async () => {
      const sandbox = appWith(SERVER_CREDENTIALS);

      const response = await sandbox.inject({
        method: "GET",
        url: "/v1/api/payments/tx-cualquiera?gateway=wompi",
        headers: { "x-kit-pagos-environment": "sandbox" },
      });

      expect(fetchSpy).toHaveBeenCalled();
      expect(response.headers["x-kit-pagos-warning"]).toBeDefined();
      expect(response.json().warnings).toEqual([
        expect.objectContaining({ code: "SERVER_SANDBOX_CREDENTIALS_USED" }),
      ]);
      await sandbox.close();
    });

    it("should refuse the server credentials on GET /pse-banks against production without calling the gateway", async () => {
      const production = appWith(SERVER_CREDENTIALS);

      const response = await production.inject({
        method: "GET",
        url: "/v1/api/pse-banks?gateway=wompi",
        headers: { "x-kit-pagos-environment": "production" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().message).toContain("producción");
      expect(fetchSpy).not.toHaveBeenCalled();
      await production.close();
    });

    it("should warn in the header and the body of GET /pse-banks when it falls back to the server credentials in a sandbox", async () => {
      const sandbox = appWith(SERVER_CREDENTIALS);

      const response = await sandbox.inject({
        method: "GET",
        url: "/v1/api/pse-banks?gateway=wompi",
        headers: { "x-kit-pagos-environment": "sandbox" },
      });

      expect(fetchSpy).toHaveBeenCalled();
      expect(response.headers["x-kit-pagos-warning"]).toBeDefined();
      expect(response.json().warnings).toEqual([
        expect.objectContaining({ code: "SERVER_SANDBOX_CREDENTIALS_USED" }),
      ]);
      await sandbox.close();
    });
  });
});

describe("GET /v1/api/pse-banks (issue #103)", () => {
  let app: FastifyInstance;
  const testEnv: Record<string, string | undefined> = { ...SERVER_CREDENTIALS };

  beforeAll(async () => {
    app = appWith(testEnv);
    testEnv.SIMULATOR_SDK_BASE_URL = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("should return one bank list per gateway, grouped with its origin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/api/pse-banks" });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.pseBanks).toHaveLength(4);

    const byGateway = Object.fromEntries(
      data.pseBanks.map((g: { gateway: string; banks: unknown[] }) => [g.gateway, g.banks]),
    );
    expect(Object.keys(byGateway).sort()).toEqual(
      ["kushki", "mercadopago", "rapyd", "wompi"],
    );
  });

  it("should return the bank codes each gateway expects, not a shared catalog", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/api/pse-banks" });
    const byGateway = Object.fromEntries(
      res.json().pseBanks.map((g: { gateway: string; banks: unknown[] }) => [g.gateway, g.banks]),
    );

    // Wompi: los tres bancos ficticios del sandbox, tal cual los devuelve (punto 43).
    const wompi = byGateway.wompi as Array<{ code: string; name: string; achCode?: string }>;
    expect(wompi).toHaveLength(3);
    expect(wompi[0]).toEqual({ code: "1", name: "Banco que aprueba" });
    expect(wompi[0].achCode).toBeUndefined();

    // Mercado Pago: las cinco entidades reales del mock, con su código ACH.
    const mercadopago = byGateway.mercadopago as Array<{
      code: string;
      name: string;
      achCode?: string;
    }>;
    expect(mercadopago).toHaveLength(5);
    expect(mercadopago[1]).toEqual({ code: "1007", name: "Bancolombia", achCode: "1007" });

    // Kushki: descarta el placeholder del <select> y no deja bancos inventados
    // como "0" ("A continuacion seleccione su banco").
    const kushki = byGateway.kushki as Array<{ code: string; name: string }>;
    expect(kushki).toHaveLength(4);
    expect(kushki.map((b) => b.code)).not.toContain("0");
    expect(kushki[0]).toEqual({ code: "001", name: "Bancolombia" });

    // Rapyd: los métodos co_pse_*; el mock incluye una tarjeta que el filtro descarta.
    const rapyd = byGateway.rapyd as Array<{ code: string; name: string }>;
    expect(rapyd).toHaveLength(4);
    expect(rapyd.every((b) => b.code.startsWith("co_pse_"))).toBe(true);
    expect(rapyd.find((b) => b.code === "co_pse_bancolombia_bank")?.name).toBe("Bancolombia");

    // Los códigos de Wompi ("1", "2", "3") no son portables: no aparecen en el
    // catálogo de Mercado Pago, que usa los códigos de compensación de ACH.
    const wompiCodes = new Set(wompi.map((b) => b.code));
    const allOtherCodes = [
      ...byGateway.mercadopago,
      ...byGateway.kushki,
      ...byGateway.rapyd,
    ].map((b: { code: string }) => b.code);
    expect(allOtherCodes.some((code) => wompiCodes.has(code))).toBe(false);
  });

  describe("the ?gateway= parameter", () => {
    it("should return only the requested gateway, in the same response shape", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/api/pse-banks?gateway=mercadopago",
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.pseBanks).toHaveLength(1);
      expect(data.pseBanks[0].gateway).toBe("mercadopago");
      expect(data.pseBanks[0].banks).toHaveLength(5);
    });

    it("should answer 400 asking for the gateway when the request carries its own credentials", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/api/pse-banks",
        headers: {
          "x-gateway-public-key": "pub_wompi_del_comercio",
          "x-gateway-private-key": "prv_wompi_del_comercio",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(KitPagosErrorCode.INVALID_REQUEST);
      expect(res.json().message).toContain("?gateway=");
    });

    /**
     * La prueba de la fuga: las cabeceras no dicen de qué pasarela son, así que la
     * única garantía es que la ruta resuelva **una** pasarela. Se cuenta las llamadas
     * al proveedor en vez de mirar el resultado, porque un resultado correcto no
     * distingue "consultó solo Wompi" de "consultó las cuatro y solo Wompi vino bien".
     */
    it("should send the client's keys to the requested gateway only, never to the other three", async () => {
      const resolveClient = jest.spyOn(app.kitPagosProvider, "resolveClient");

      try {
        const res = await app.inject({
          method: "GET",
          url: "/v1/api/pse-banks?gateway=wompi",
          headers: {
            "x-gateway-public-key": "pub_wompi_del_comercio",
            "x-gateway-private-key": "prv_wompi_del_comercio",
          },
        });

        expect(res.statusCode).toBe(200);
        expect(resolveClient).toHaveBeenCalledTimes(1);
        expect(resolveClient).toHaveBeenCalledWith(Gateway.WOMPI, expect.anything());
      } finally {
        resolveClient.mockRestore();
      }
    });

    it("should answer 400 for a gateway that does not exist, without echoing it back", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/api/pse-banks?gateway=paypal",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(KitPagosErrorCode.INVALID_REQUEST);
      expect(res.json().message).not.toContain("paypal");
    });
  });

  /**
   * El docstring promete que la ruta falla completo. Sin esta prueba el `try/catch`
   * por pasarela se puede colar sin que nadie lo note, y el comercio recibe una lista
   * parcial que tomo por completa: de ahí nace el cobro con un banco que la pasarela
   * nunca autorizó.
   */
  it("should fail with 502 and no list when a single gateway does not answer", async () => {
    const answering: PseBank[] = [{ code: "1", name: "Banco que aprueba" }];
    const working = {
      getPseBanks: () => Promise.resolve(answering),
    } as unknown as KitPagos;
    const broken = {
      getPseBanks: () =>
        Promise.reject(
          new KitPagosError(
            KitPagosErrorCode.GATEWAY_SERVER_ERROR,
            Gateway.RAPYD,
            null,
            "Rapyd no respondio",
          ),
        ),
    } as unknown as KitPagos;

    const fakeProvider = {
      resolveClient: (gateway: Gateway) => ({
        kitPagos: gateway === Gateway.RAPYD ? broken : working,
        target: "simulator" as const,
      }),
      resolveBaseUrl: () => undefined,
    } as unknown as KitPagosProvider;

    const standalone = buildApp({ logger: false, kitPagosProvider: fakeProvider });
    try {
      const res = await standalone.inject({ method: "GET", url: "/v1/api/pse-banks" });

      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
      expect(res.json().pseBanks).toBeUndefined();
    } finally {
      await standalone.close();
    }
  });
});
