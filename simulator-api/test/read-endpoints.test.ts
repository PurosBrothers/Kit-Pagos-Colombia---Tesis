import { FastifyInstance } from "fastify";
import {
  Gateway,
  KitPagos,
  KitPagosError,
  KitPagosErrorCode,
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
    // Estado normalizado + estado nativo de la pasarela.
    expect(data.transaction.status).toBeDefined();
    expect(data.transaction.rawStatus).toBeDefined();
    expect(data.transaction.orderReference).toMatch(/^ORDER-READ-wompi-/);
    expect(data.transaction.amount).toBe("50000.00");
    expect(data.transaction.currency).toBe("COP");
  });

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
});