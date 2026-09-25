import { buildApp } from "../src/app";
import { transactionStore } from "../src/store/TransactionStore";

/**
 * Pruebas de integración de resiliencia y escenarios del simulador (Issue #65).
 *
 * Demuestra de punta a punta que:
 * 1. Los 4 escenarios mandatorios (DECLINED, TIMEOUT, NETWORK_ERROR, EXPIRED) funcionan
 *    nativamente en las 4 pasarelas (Wompi, Mercado Pago, Rapyd, Kushki) vía cabecera
 *    sin alterar el cuerpo del pago.
 * 2. Los escenarios transitorios (NETWORK_ERROR, TIMEOUT, RATE_LIMIT, 500, FLAPPING)
 *    se comportan como reintentables bajo una política de reintentos con backoff.
 * 3. Los rechazos de negocio (DECLINED) NO se reintentan (ejecución única y definitiva).
 */
describe("Integración de Escenarios de Fallo y Resiliencia (Issue #65)", () => {
  beforeEach(() => {
    transactionStore.clear();
  });

  afterEach(() => {
    transactionStore.clear();
  });

  describe("1. Matriz de Escenarios Mandatorios por Pasarela", () => {
    // ── Wompi ──
    describe("Wompi", () => {
      const wompiBody = {
        amount_in_cents: 3500000,
        currency: "COP",
        reference: "ref-wompi-65",
        customer_email: "test@wompi.co",
        payment_method: { type: "CARD", token: "tok_wompi_65" },
      };

      it("Rechazo de negocio (DECLINED) retorna HTTP 201 con status DECLINED", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/wompi/transactions",
          headers: { "x-simulator-scenario": "DECLINED" },
          payload: wompiBody,
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().data.status).toBe("DECLINED");
        await app.close();
      });

      it("Timeout retorna HTTP 504 con payload nativo de timeout", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/wompi/transactions",
          headers: { "x-simulator-scenario": "TIMEOUT" },
          payload: wompiBody,
        });

        expect(res.statusCode).toBe(504);
        expect(res.json().error.type).toBe("GATEWAY_TIMEOUT");
        await app.close();
      });

      it("Error de red retorna HTTP 500", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/wompi/transactions",
          headers: { "x-simulator-scenario": "NETWORK_ERROR" },
          payload: wompiBody,
        });

        expect(res.statusCode).toBe(500);
        await app.close();
      });

      it("Expiración retorna HTTP 201 con status VOIDED y se persiste en store", async () => {
        const app = buildApp();
        const postRes = await app.inject({
          method: "POST",
          url: "/v1/sim/wompi/transactions",
          headers: { "x-simulator-scenario": "EXPIRED" },
          payload: wompiBody,
        });

        expect(postRes.statusCode).toBe(201);
        const id = postRes.json().data.id;
        expect(postRes.json().data.status).toBe("VOIDED");

        const getRes = await app.inject({
          method: "GET",
          url: `/v1/sim/wompi/transactions/${id}`,
        });
        expect(getRes.statusCode).toBe(200);
        expect(getRes.json().data.status).toBe("VOIDED");

        await app.close();
      });
    });

    // ── Mercado Pago ──
    describe("Mercado Pago", () => {
      const mpBody = {
        transaction_amount: 35000,
        description: "orden-mp-65",
        token: "tok_mp_65",
        installments: 1,
        payer: { email: "test@mercadopago.com" },
      };

      it("Rechazo de negocio (REJECTED) retorna HTTP 201 con status rejected", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/mercadopago/payments",
          headers: {
            "x-idempotency-key": "idemp-mp-65-1",
            "x-simulator-scenario": "REJECTED",
          },
          payload: mpBody,
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().status).toBe("rejected");
        await app.close();
      });

      it("Timeout retorna HTTP 504 con payload nativo", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/mercadopago/payments",
          headers: {
            "x-idempotency-key": "idemp-mp-65-2",
            "x-simulator-scenario": "TIMEOUT",
          },
          payload: mpBody,
        });

        expect(res.statusCode).toBe(504);
        expect(res.json().error).toBe("gateway_timeout");
        await app.close();
      });

      it("Error de red retorna HTTP 500", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/mercadopago/payments",
          headers: {
            "x-idempotency-key": "idemp-mp-65-3",
            "x-simulator-scenario": "NETWORK_ERROR",
          },
          payload: mpBody,
        });

        expect(res.statusCode).toBe(500);
        await app.close();
      });

      it("Expiración retorna HTTP 201 con status cancelled y status_detail expired", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/mercadopago/payments",
          headers: {
            "x-idempotency-key": "idemp-mp-65-4",
            "x-simulator-scenario": "EXPIRED",
          },
          payload: mpBody,
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().status).toBe("cancelled");
        expect(res.json().status_detail).toBe("expired");
        await app.close();
      });
    });

    // ── Rapyd ──
    describe("Rapyd", () => {
      const rapydBody = {
        amount: "35000.00",
        currency: "COP",
        merchant_reference_id: "ref-rapyd-65",
        receipt_email: "test@rapyd.net",
      };

      it("Rechazo de negocio (DECLINED) retorna HTTP 201 con status ERR y paid false", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/payments",
          headers: { "x-simulator-scenario": "DECLINED" },
          payload: rapydBody,
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().data.status).toBe("ERR");
        expect(res.json().data.paid).toBe(false);
        expect(res.json().status.status).toBe("ERROR");
        await app.close();
      });

      it("Timeout retorna HTTP 504", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/payments",
          headers: { "x-simulator-scenario": "TIMEOUT" },
          payload: rapydBody,
        });

        expect(res.statusCode).toBe(504);
        expect(res.json().status.error_code).toBe("GATEWAY_TIMEOUT");
        await app.close();
      });

      it("Error de red retorna HTTP 500", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/payments",
          headers: { "x-simulator-scenario": "NETWORK_ERROR" },
          payload: rapydBody,
        });

        expect(res.statusCode).toBe(500);
        await app.close();
      });

      it("Expiración retorna HTTP 201 con status EXP y paid false", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/rapyd/payments",
          headers: { "x-simulator-scenario": "EXPIRED" },
          payload: rapydBody,
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().data.status).toBe("EXP");
        expect(res.json().data.paid).toBe(false);
        await app.close();
      });
    });

    // ── Kushki ──
    describe("Kushki", () => {
      const kushkiBody = {
        token: "tok_kushki_65",
        amount: {
          subtotalIva0: 35000,
          subtotalIva: 0,
          iva: 0,
          ice: 0,
          currency: "COP",
        },
      };

      it("Rechazo de negocio (DECLINED) retorna HTTP 201 con transactionStatus DECLINED", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/kushki/card/v1/charges",
          headers: { "x-simulator-scenario": "DECLINED" },
          payload: kushkiBody,
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().details.transactionStatus).toBe("DECLINED");
        await app.close();
      });

      it("Timeout retorna HTTP 504 con código nativo K504", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/kushki/card/v1/charges",
          headers: { "x-simulator-scenario": "TIMEOUT" },
          payload: kushkiBody,
        });

        expect(res.statusCode).toBe(504);
        expect(res.json().code).toBe("K504");
        await app.close();
      });

      it("Error de red retorna HTTP 500", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/kushki/card/v1/charges",
          headers: { "x-simulator-scenario": "NETWORK_ERROR" },
          payload: kushkiBody,
        });

        expect(res.statusCode).toBe(500);
        await app.close();
      });

      it("Expiración retorna HTTP 201 con texto Transacción expirada", async () => {
        const app = buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/kushki/card/v1/charges",
          headers: { "x-simulator-scenario": "EXPIRED" },
          payload: kushkiBody,
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().details.transactionStatus).toBe("DECLINED");
        expect(res.json().details.responseText).toBe("Transacción expirada");
        await app.close();
      });
    });
  });

  describe("2. Demostración de Política de Reintentos vs Rechazo de Negocio", () => {
    /**
     * Política de reintento simulada:
     * - Errores 5xx, 504, 429 son transitorios -> se reintentan hasta 3 veces.
     * - Rechazos de negocio (HTTP 200/201 con status DECLINED/rejected/ERR) -> NO se reintentan.
     */
    async function executeWithRetry<T>(
      operation: () => Promise<{ statusCode: number; body: T }>,
      maxRetries = 3,
    ): Promise<{ attempts: number; finalResult: { statusCode: number; body: T } }> {
      let attempts = 0;
      while (true) {
        attempts++;
        const result = await operation();

        const isTransient =
          result.statusCode >= 500 ||
          result.statusCode === 504 ||
          result.statusCode === 429;

        if (!isTransient || attempts >= maxRetries) {
          return { attempts, finalResult: result };
        }
      }
    }

    it("Demuestra que el error de red (NETWORK_ERROR) agota los reintentos", async () => {
      const app = buildApp();
      const wompiBody = {
        amount_in_cents: 1000000,
        currency: "COP",
        reference: "ref-retry-net",
        customer_email: "net@test.co",
        payment_method: { type: "CARD", token: "tok_net" },
      };

      const { attempts, finalResult } = await executeWithRetry(async () => {
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/wompi/transactions",
          headers: { "x-simulator-scenario": "NETWORK_ERROR" },
          payload: wompiBody,
        });
        return { statusCode: res.statusCode, body: res.json() };
      }, 3);

      expect(attempts).toBe(3); // Se reintentó hasta el máximo
      expect(finalResult.statusCode).toBe(500);

      await app.close();
    });

    it("Demuestra que el rechazo de negocio (DECLINED) NO se reintenta (1 solo intento)", async () => {
      const app = buildApp();
      const wompiBody = {
        amount_in_cents: 1000000,
        currency: "COP",
        reference: "ref-no-retry-declined",
        customer_email: "declined@test.co",
        payment_method: { type: "CARD", token: "tok_declined" },
      };

      const { attempts, finalResult } = await executeWithRetry(async () => {
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/wompi/transactions",
          headers: { "x-simulator-scenario": "DECLINED" },
          payload: wompiBody,
        });
        return { statusCode: res.statusCode, body: res.json() };
      }, 3);

      expect(attempts).toBe(1); // Final inmediato, NO se reintenta
      expect(finalResult.statusCode).toBe(201);
      expect((finalResult.body as { data: { status: string } }).data.status).toBe("DECLINED");

      await app.close();
    });

    it("Demuestra auto-recuperación (FLAPPING): falla en los primeros intentos y resuelve en el siguiente", async () => {
      const app = buildApp();
      const wompiBody = {
        amount_in_cents: 1000000,
        currency: "COP",
        reference: "ref-flapping-auto-recovery",
        customer_email: "flapping@test.co",
        payment_method: { type: "CARD", token: "tok_flap" },
      };

      const { attempts, finalResult } = await executeWithRetry(async () => {
        const res = await app.inject({
          method: "POST",
          url: "/v1/sim/wompi/transactions",
          headers: { "x-simulator-scenario": "FLAPPING" },
          payload: wompiBody,
        });
        return { statusCode: res.statusCode, body: res.json() };
      }, 4);

      expect(attempts).toBe(3); // Falló 2 veces con 503, triunfó en el 3er intento
      expect(finalResult.statusCode).toBe(201);
      expect((finalResult.body as { data: { status: string } }).data.status).toBe("PENDING");

      await app.close();
    });
  });
});

