import { jsonErrorResponse } from "../../test-support/http-response";
import * as crypto from "crypto";
import { MercadoPagoAdapter } from "./MercadoPagoAdapter";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { expectTransaction } from "../../test-support/payment-result";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";

describe("MercadoPagoAdapter", () => {
  const originalFetch = global.fetch;

  const validRequest: CreatePaymentRequest = {
    amount: new Amount("50000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ORDER-MP-123"),
    payer: new Payer({ email: "cliente.mp@example.com" }),
    paymentMethod: PaymentMethod.card("a1b2c3d4e5f6"),
  };

  const credentials = {
    publicKey: "APP_USR_pub_123",
    privateKey: "APP_USR_priv_secret_456",
  };

  /**
   * Las tres respuestas de un cobro con tarjeta, con la forma medida el 15 de octubre de 2026
   * (`mercadopago-card.ts`): el token leído con el access token, la búsqueda por BIN y la orden
   * aprobada. Los ids son los de la medición; los montos y la referencia, los de la prueba.
   */
  const readCardToken = {
    id: "a1b2c3d4e5f6",
    public_key: "APP_USR_pub_123",
    status: "active",
    first_six_digits: "401354",
    last_four_digits: "6260",
  };
  const binSearch = {
    paging: { total: 1, limit: 30, offset: 0 },
    results: [{ id: "visa", name: "Visa", payment_type_id: "credit_card", status: "active" }],
  };
  const cardPayment = (status: string, statusDetail: string) => ({
    id: "PAY01M50EJ7F05THGGT4G9QYVZ4M2",
    amount: "50000",
    paid_amount: "50000",
    reference_id: "000gsvomal",
    status,
    status_detail: statusDetail,
    payment_method: {
      id: "visa",
      type: "credit_card",
      token: "a1b2c3d4e5f6",
      installments: 1,
      installment_amount: "50000",
      transaction_security: { validation: "never" },
    },
  });
  const cardOrder = (status: string, statusDetail: string, paymentDetail = statusDetail) => ({
    id: "ORDTST01M50EJ7EF1B8E8KAS3T7FK5SW",
    type: "online",
    processing_mode: "automatic",
    external_reference: "ORDER-MP-123",
    total_amount: "50000",
    total_paid_amount: "50000",
    country_code: "COL",
    status,
    status_detail: statusDetail,
    capture_mode: "automatic_async",
    currency: "COP",
    config: { online: { transaction_security: { validation: "never" } } },
    transactions: { payments: [cardPayment(status, paymentDetail)] },
  });

  const okJson = (status: number, body: unknown) => ({
    ok: true,
    status,
    json: async () => body,
  });

  /** `fetch` que responde cada una de las tres llamadas del cobro con tarjeta por su URL. */
  function mockCardFlow(
    order: unknown = cardOrder("processed", "accredited"),
    orderHttpStatus = 201,
    overrides: { token?: unknown; search?: unknown } = {},
  ): jest.Mock {
    const mockFetch = jest.fn(async (url: string) => {
      if (url.includes("/card_tokens/")) return okJson(200, overrides.token ?? readCardToken);
      if (url.includes("/payment_methods/search")) return okJson(200, overrides.search ?? binSearch);
      return orderHttpStatus >= 400
        ? jsonErrorResponse(orderHttpStatus, order)
        : okJson(orderHttpStatus, order);
    });
    global.fetch = mockFetch as unknown as typeof fetch;
    return mockFetch;
  }

  const cardAdapter = () => new MercadoPagoAdapter(undefined, credentials);

  /** La llamada que crea la orden, que es la única con método POST. */
  const orderCalls = (mockFetch: jest.Mock) =>
    mockFetch.mock.calls.filter((call) => call[1].method === "POST");

  const approvedMpResponse = {
    id: 1234567890,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 50000,
    currency_id: "COP",
    description: "ORDER-MP-123",
    external_reference: "ORDER-MP-123",
    payer: { email: "cliente.mp@example.com" },
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("createPayment()", () => {
    /**
     * Desde la versión 0.6.0 tarjeta va por la Orders API: con las credenciales de prueba
     * vigentes, `POST /v1/payments` responde `401 "Unauthorized use of live credentials"`
     * (medido el 15 de octubre de 2026).
     */
    it("charges a card as an order, after resolving the brand from the token", async () => {
      const mockFetch = mockCardFlow();

      const transaction = expectTransaction(await cardAdapter().createPayment(validRequest));

      expect(mockFetch.mock.calls.map((call) => `${call[1].method} ${call[0]}`)).toEqual([
        "GET http://localhost:3000/v1/sim/mercadopago/card_tokens/a1b2c3d4e5f6",
        "GET http://localhost:3000/v1/sim/mercadopago/payment_methods/search?public_key=APP_USR_pub_123&bins=401354",
        "POST http://localhost:3000/v1/sim/mercadopago/orders",
      ]);
      expect(JSON.parse(orderCalls(mockFetch)[0][1].body)).toEqual({
        type: "online",
        processing_mode: "automatic",
        total_amount: "50000",
        external_reference: "ORDER-MP-123",
        payer: { email: "cliente.mp@example.com" },
        transactions: {
          payments: [
            {
              amount: "50000",
              payment_method: {
                id: "visa",
                type: "credit_card",
                token: "a1b2c3d4e5f6",
                installments: 1,
              },
            },
          ],
        },
      });

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.rawStatus).toBe("processed");
      expect(transaction.gatewayTransactionId.value).toBe("ORDTST01M50EJ7EF1B8E8KAS3T7FK5SW");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.MERCADOPAGO);
      expect(transaction.amount.getValue()).toBe("50000.00");
      expect(transaction.orderReference.getValue()).toBe("ORDER-MP-123");
    });

    it("never charges a card through the Payments API", async () => {
      const mockFetch = mockCardFlow();

      await cardAdapter().createPayment(validRequest);

      expect(mockFetch.mock.calls.some((call) => String(call[0]).includes("/payments"))).toBe(false);
    });

    it("sends the brand and type of a debit card, and the requested installments", async () => {
      const mockFetch = mockCardFlow(undefined, 201, {
        search: { results: [{ id: "debvisa", payment_type_id: "debit_card" }] },
      });

      await cardAdapter().createPayment({
        ...validRequest,
        paymentMethod: PaymentMethod.card("a1b2c3d4e5f6", { installments: 3 }),
      });

      const body = JSON.parse(orderCalls(mockFetch)[0][1].body);
      expect(body.transactions.payments[0].payment_method).toEqual({
        id: "debvisa",
        type: "debit_card",
        token: "a1b2c3d4e5f6",
        installments: 3,
      });
    });

    it("sends the payer document when the merchant provides it", async () => {
      const mockFetch = mockCardFlow();

      await cardAdapter().createPayment({
        ...validRequest,
        payer: new Payer({
          email: "cliente.mp@example.com",
          documentType: "CC",
          documentNumber: "123456789",
        }),
      });

      expect(JSON.parse(orderCalls(mockFetch)[0][1].body).payer).toEqual({
        email: "cliente.mp@example.com",
        identification: { type: "CC", number: "123456789" },
      });
    });

    /**
     * Medido el 15 de octubre de 2026 con el titular `OTHE`: `402` con el sobre `errors[]` y la
     * orden en `failed / failed` dentro de `data`, con el motivo en el pago.
     */
    it.each([
      ["rejected_by_issuer", "UNKNOWN"],
      ["insufficient_amount", "INSUFFICIENT_FUNDS"],
      ["bad_filled_card_data", "INVALID_CARD_DATA"],
      ["high_risk", "UNKNOWN"],
    ])("returns the 402 of a card declined with %s as a DECLINED transaction", async (detail, category) => {
      mockCardFlow(
        {
          errors: [
            {
              code: "failed",
              message: "The following transactions failed",
              details: [`PAY01M50EKNA4CBANNDD3CFM2HED9: ${detail}`],
            },
          ],
          data: cardOrder("failed", "failed", detail),
        },
        402,
      );

      const transaction = expectTransaction(await cardAdapter().createPayment(validRequest));

      expect(transaction.getStatus()).toBe("DECLINED");
      expect(transaction.rawStatus).toBe("failed");
      expect(transaction.gatewayTransactionId.value).toBe("ORDTST01M50EJ7EF1B8E8KAS3T7FK5SW");
      expect(transaction.rejectionReason).toEqual({
        rejectionCode: detail,
        rejectionCategory: category,
      });
    });

    /** El titular `CONT`, medido el 15 de octubre de 2026: `201` en `processing / in_process`. */
    it("returns a card order still processing as PENDING", async () => {
      mockCardFlow(cardOrder("processing", "in_process"));

      const transaction = expectTransaction(await cardAdapter().createPayment(validRequest));

      expect(transaction.getStatus()).toBe("PENDING");
      expect(transaction.rawStatus).toBe("processing");
    });

    it("refuses an amount with cents before charging, because total_amount takes whole pesos", async () => {
      const mockFetch = mockCardFlow();

      await expect(
        cardAdapter().createPayment({ ...validRequest, amount: new Amount("50000.50") }),
      ).rejects.toMatchObject({ code: KitPagosErrorCode.INVALID_REQUEST });
      expect(orderCalls(mockFetch)).toHaveLength(0);
    });

    it("fails with INVALID_REQUEST before any request when there is no public key", async () => {
      const mockFetch = mockCardFlow();

      await expect(new MercadoPagoAdapter().createPayment(validRequest)).rejects.toMatchObject({
        code: KitPagosErrorCode.INVALID_REQUEST,
        gateway: Gateway.MERCADOPAGO,
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fails with MALFORMED_RESPONSE when the token comes back without first_six_digits", async () => {
      const mockFetch = mockCardFlow(undefined, 201, { token: { id: "a1b2c3d4e5f6" } });

      await expect(cardAdapter().createPayment(validRequest)).rejects.toMatchObject({
        code: KitPagosErrorCode.MALFORMED_RESPONSE,
      });
      expect(orderCalls(mockFetch)).toHaveLength(0);
    });

    /** Medido con el BIN `999999`: `200` con `results: []`. */
    it("fails with INVALID_REQUEST when no payment method matches the BIN", async () => {
      const mockFetch = mockCardFlow(undefined, 201, {
        search: { paging: { total: 0, limit: 30, offset: 0 }, results: [] },
      });

      await expect(cardAdapter().createPayment(validRequest)).rejects.toMatchObject({
        code: KitPagosErrorCode.INVALID_REQUEST,
      });
      expect(orderCalls(mockFetch)).toHaveLength(0);
    });

    it("authenticates every call with a Bearer token using the credentials privateKey", async () => {
      const mockFetch = mockCardFlow();

      await cardAdapter().createPayment(validRequest);

      for (const [, init] of mockFetch.mock.calls) {
        expect(init.headers.Authorization).toBe("Bearer APP_USR_priv_secret_456");
      }
      expect(orderCalls(mockFetch)[0][1].headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer APP_USR_priv_secret_456",
        "X-Idempotency-Key": expect.any(String),
      });
    });

    /**
     * Mercado Pago es la única de las cuatro que exige una llave de idempotencia, y sin ella
     * no crea nada: `400 "Header X-Idempotency-Key can't be null"` en `/payments` y
     * `400 "Missing HTTP header: X-Idempotency-Key."` en `/orders`, que es por donde va PSE.
     * Lo encontraron las pruebas contra sandbox; las mediciones a mano mandaban el header sin
     * pensarlo y el simulador no lo pedía, así que el SDK no podía cobrar por ningún método.
     */
    it("sends an idempotency key on every creation", async () => {
      const mockFetch = mockCardFlow();

      await cardAdapter().createPayment(validRequest);

      const key = orderCalls(mockFetch)[0][1].headers["X-Idempotency-Key"];
      expect(key).toBeTruthy();
    });

    /**
     * Una llave por intento, no derivada de la referencia de la orden.
     *
     * Con la referencia como llave, Mercado Pago devolvería la respuesta original en el
     * segundo intento, y un cobro rechazado quedaría incobrable: reintentar con otra tarjeta
     * sobre la misma orden repetiría el rechazo viejo.
     */
    it("uses a different key on each attempt of the same order", async () => {
      const mockFetch = mockCardFlow();

      const adapter = cardAdapter();
      await adapter.createPayment(validRequest);
      await adapter.createPayment(validRequest);

      const [firstCall, secondCall] = orderCalls(mockFetch).map(
        (call) => call[1].headers["X-Idempotency-Key"],
      );
      expect(firstCall).not.toBe(secondCall);
    });

    /** Una lectura no crea nada, así que las dos consultas previas al cobro no llevan llave. */
    it("does not send an idempotency key on the two reads before the charge", async () => {
      const mockFetch = mockCardFlow();

      await cardAdapter().createPayment(validRequest);

      const reads = mockFetch.mock.calls.filter((call) => call[1].method === "GET");
      expect(reads).toHaveLength(2);
      for (const [, init] of reads) {
        expect(init.headers["X-Idempotency-Key"]).toBeUndefined();
      }
    });

    /** Una consulta no crea nada, así que no necesita llave. */
    it("does not send an idempotency key when querying", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      await new MercadoPagoAdapter().getStatus("1234567890");

      expect(
        mockFetch.mock.calls[0][1].headers["X-Idempotency-Key"],
      ).toBeUndefined();
    });

    it("maps network failures to KitPagosError(CONNECTION_FAILED)", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("fetch failed"));

      const adapter = cardAdapter();
      await expect(adapter.createPayment(validRequest)).rejects.toThrow(KitPagosError);

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
        expect(sdkError.gateway).toBe(Gateway.MERCADOPAGO);
      }
    });

    it("maps unsuccessful HTTP errors to KitPagosError", async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonErrorResponse(401, { message: "Invalid credentials" }));

      const adapter = cardAdapter();
      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
        expect(sdkError.gateway).toBe(Gateway.MERCADOPAGO);
      }
    });

    it("maps an unsuccessful HTTP response that returns text instead of JSON", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("Cannot parse JSON");
        },
        text: async () => "Internal Server Error Text",
      });

      await expect(cardAdapter().createPayment(validRequest)).rejects.toMatchObject({
        code: KitPagosErrorCode.GATEWAY_SERVER_ERROR,
      });
    });

    it("maps a response with malformed JSON to MALFORMED_RESPONSE", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });

      await expect(cardAdapter().createPayment(validRequest)).rejects.toMatchObject({
        code: KitPagosErrorCode.MALFORMED_RESPONSE,
      });
    });
  });

  describe("getStatus()", () => {
    it("queries a payment status successfully and returns the Transaction", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      const adapter = new MercadoPagoAdapter();
      const transaction = await adapter.getStatus("1234567890");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/mercadopago/payments/1234567890",
        expect.objectContaining({ method: "GET" })
      );
      expect(transaction.isApproved()).toBe(true);
      expect(transaction.gatewayTransactionId.value).toBe("1234567890");
    });

    it("authenticates with a Bearer token in getStatus when credentials are configured", async () => {
      const credentials = {
        publicKey: "APP_USR_pub_123",
        privateKey: "APP_USR_priv_secret_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      const adapter = new MercadoPagoAdapter(undefined, credentials);
      await adapter.getStatus("1234567890");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/mercadopago/payments/1234567890",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer APP_USR_priv_secret_456",
          }),
        })
      );
    });

    it("maps network failures in getStatus to KitPagosError", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("network timeout"));

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.getStatus("1234567890");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
      }
    });

    it("maps an HTTP 404 in getStatus to RESOURCE_NOT_FOUND", async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonErrorResponse(404, { message: "Payment not found" }));

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.getStatus("not-found-id");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.RESOURCE_NOT_FOUND);
      }
    });

    it("maps an unsuccessful HTTP error with plain text in getStatus", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("Invalid json");
        },
        text: async () => "Bad Gateway",
      });

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.getStatus("1234567890");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
      }
    });

    it("maps a JSON parse error in getStatus to MALFORMED_RESPONSE", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
      });

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.getStatus("1234567890");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
      }
    });
  });

  describe("verifySignature()", () => {
    it("validates the Mercado Pago HMAC-SHA256 signature correctly by delegating to WebhookVerifier", () => {
      const adapter = new MercadoPagoAdapter();
      const secret = "test_mp_secret_key";
      const dataId = "1234567890";
      const requestId = "req-uuid-123";
      const ts = String(Math.floor(Date.now() / 1000));

      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

      const payload = JSON.stringify({
        action: "payment.created",
        data: { id: dataId },
      });

      const headers = {
        "x-signature": `ts=${ts},v1=${v1}`,
        "x-request-id": requestId,
      };

      const isValid = adapter.verifySignature(payload, headers, secret);
      expect(isValid).toBe(true);
    });

    /**
     * Desde 0.6.0 el cobro con tarjeta también es una orden: su notificación trae el id
     * alfanumérico (`ORDTST…` con credenciales de vendedor de prueba), que el manifiesto firma
     * en minúsculas.
     */
    it("validates the notification of a card order, signed with its id in lowercase", () => {
      const secret = "test_mp_secret_key";
      const orderId = "ORDTST01M50EJ7EF1B8E8KAS3T7FK5SW";
      const requestId = "req-uuid-456";
      const ts = String(Math.floor(Date.now() / 1000));
      const manifest = `id:${orderId.toLowerCase()};request-id:${requestId};ts:${ts};`;
      const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
      const payload = JSON.stringify({ action: "order.processed", type: "order", data: { id: orderId } });
      const headers = { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };

      expect(new MercadoPagoAdapter().verifySignature(payload, headers, secret)).toBe(true);
    });
  });
});

/**
 * PSE en Mercado Pago, agregado en el issue #64.
 *
 * Las respuestas de estas pruebas reproducen la forma exacta que devolvió la
 * Orders API real el 18 de septiembre de 2026; el razonamiento y el resto de lo
 * medido está en `mercadopago-pse.ts`.
 */
describe("MercadoPagoAdapter PSE", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const pseRequest: CreatePaymentRequest = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-mp-pse-1"),
    payer: new Payer({
      email: "cliente@example.com",
      firstName: "Juan",
      lastName: "Perez Gomez",
      documentType: "CC",
      documentNumber: "1099888777",
      phone: "3001234567",
      phoneAreaCode: "57",
      address: {
        streetName: "Calle 10",
        streetNumber: "100",
        city: "Bogota",
        zipCode: "110111",
        neighborhood: "Centro",
      },
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: "1051" }),
    returnUrlConfig: new ReturnUrlConfig("https://comercio.example.com/retorno"),
    ipAddress: "200.100.50.25",
  };

  const createdOrder = {
    id: "ORD01M2V7ZQH9BAZ57V99VG1NY0K1",
    status: "action_required",
    status_detail: "waiting_transfer",
    total_amount: "150000",
    currency: "COP",
    external_reference: "ord-mp-pse-1",
    transactions: {
      payments: [
        {
          id: "PAY01M2V7ZQHMX28P0086V5NZ9QRM",
          status: "action_required",
          payment_method: {
            id: "pse",
            type: "bank_transfer",
            redirect_url: "https://www.mercadopago.com.co/payments/179749499276/bank_transfer",
            financial_institution: "1051",
          },
        },
      ],
    },
  };

  function mockCreatedOrder(): jest.Mock {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => createdOrder,
    });
    global.fetch = mockFetch;
    return mockFetch;
  }

  /**
   * PSE no se cobra por la Payments API: con el banco en
   * `transaction_details.financial_institution` esa API devuelve 424 pase lo que
   * pase. Por eso este camino tiene que salir por `/orders`.
   */
  it("should create a PSE payment against the Orders API and not the payments one", async () => {
    const mockFetch = mockCreatedOrder();

    await new MercadoPagoAdapter().createPayment(pseRequest);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/v1/sim/mercadopago/orders",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("should return the bank URL as a pending redirect", async () => {
    mockCreatedOrder();

    const result = await new MercadoPagoAdapter().createPayment(pseRequest);

    expect(result.outcome).toBe("REDIRECT_REQUIRED");
    if (result.outcome === "REDIRECT_REQUIRED") {
      expect(result.redirect.redirectUrl).toBe(
        "https://www.mercadopago.com.co/payments/179749499276/bank_transfer",
      );
      expect(result.redirect.rawStatus).toBe("action_required");
      expect(result.redirect.gatewayTransactionId.value).toBe(
        "ORD01M2V7ZQH9BAZ57V99VG1NY0K1",
      );
    }
  });

  /**
   * A diferencia de Wompi, que necesita consultar hasta que la URL aparezca
   * (punto 43), aquí la redirección viene en la creación: una sola llamada.
   */
  it("should not poll, because the URL arrives with the creation", async () => {
    const mockFetch = mockCreatedOrder();

    await new MercadoPagoAdapter().createPayment(pseRequest);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  /**
   * La orden que nace `processing` sin URL (15 de octubre de 2026, 21:33–21:44) vuelve como
   * transacción pendiente, y la consulta de unos segundos después la da rechazada con el
   * motivo `processing_error`, que es como terminaron las 12 órdenes medidas.
   */
  it("should return an order born processing without a URL as PENDING, and read it back DECLINED", async () => {
    const processingPayment = {
      id: "PAY01M2V7ZQHMX28P0086V5NZ9QRM",
      status: "processing",
      status_detail: "in_process",
      payment_method: { id: "pse", type: "bank_transfer", financial_institution: "1051" },
    };
    const processingOrder = {
      ...createdOrder,
      status: "processing",
      status_detail: "in_process",
      transactions: { payments: [processingPayment] },
    };
    const failedOrder = {
      ...processingOrder,
      status: "failed",
      status_detail: "failed",
      transactions: {
        payments: [{ ...processingPayment, status: "failed", status_detail: "processing_error" }],
      },
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => processingOrder })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => failedOrder });
    const adapter = new MercadoPagoAdapter();

    const result = await adapter.createPayment(pseRequest);
    expect(result.outcome).toBe("TRANSACTION");
    if (result.outcome !== "TRANSACTION") return;
    expect(result.transaction.getStatus()).toBe("PENDING");
    expect(result.transaction.rawStatus).toBe("processing");

    const read = await adapter.getStatus(result.transaction.gatewayTransactionId.value);
    expect(read.getStatus()).toBe("DECLINED");
    expect(read.rejectionReason?.rejectionCode).toBe("processing_error");
  });

  it("should send whole pesos because the Orders API rejects decimals", async () => {
    const mockFetch = mockCreatedOrder();

    await new MercadoPagoAdapter().createPayment(pseRequest);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.total_amount).toBe("150000");
    expect(body.transactions.payments[0].amount).toBe("150000");
  });

  describe("getStatus() routing", () => {
    function mockOk(payload: unknown): jest.Mock {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload,
      });
      global.fetch = mockFetch;
      return mockFetch;
    }

    /** Las órdenes viven en otro endpoint que los pagos con tarjeta. */
    it("should query an order identifier against the orders endpoint", async () => {
      const mockFetch = mockOk(createdOrder);

      await new MercadoPagoAdapter().getStatus("ORD01M2V7ZQH9BAZ57V99VG1NY0K1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/mercadopago/orders/ORD01M2V7ZQH9BAZ57V99VG1NY0K1",
        expect.objectContaining({ method: "GET" }),
      );
    });

    /** El prefijo de las órdenes de un vendedor de prueba, medido el 15 de octubre de 2026. */
    it("should query a test seller order identifier against the orders endpoint", async () => {
      const mockFetch = mockOk(createdOrder);

      await new MercadoPagoAdapter().getStatus("ORDTST01M50EJ7EF1B8E8KAS3T7FK5SW");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/mercadopago/orders/ORDTST01M50EJ7EF1B8E8KAS3T7FK5SW",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should keep querying numeric identifiers against the payments endpoint", async () => {
      const mockFetch = mockOk({
        id: "1234567890",
        status: "approved",
        transaction_amount: 50000,
        currency_id: "COP",
        external_reference: "ORDER-MP-123",
      });

      await new MercadoPagoAdapter().getStatus("1234567890");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/mercadopago/payments/1234567890",
        expect.objectContaining({ method: "GET" }),
      );
    });

    /**
     * `action_required` es el estado de una orden esperando que el pagador
     * vuelva del banco, y no estaba en el mapeo antes de este issue: caía en
     * ERROR. El monto llega como string en `total_amount` y la divisa en
     * `currency`, no en `transaction_amount` ni `currency_id`.
     */
    it("should normalise an order waiting for the payer as PENDING", async () => {
      mockOk(createdOrder);

      const transaction = await new MercadoPagoAdapter().getStatus(
        "ORD01M2V7ZQH9BAZ57V99VG1NY0K1",
      );

      expect(transaction.isPending()).toBe(true);
      expect(transaction.rawStatus).toBe("action_required");
      expect(transaction.amount.getValue()).toBe("150000.00");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.orderReference.getValue()).toBe("ord-mp-pse-1");
    });
  });

  /**
   * Medido contra la API real el 7 de octubre de 2026
   * (docs/testing-data/mercado-pago.md, «El `402` de una orden de PSE que falla»), con el
   * `user_id` y el `application_id` reemplazados igual que en el documento.
   */
  describe("an order whose payment failed (402)", () => {
    const failedOrder = {
      id: "ORD01M4BB3B5XBNNB1EF1AM53K2MA",
      type: "online",
      processing_mode: "automatic",
      external_reference: "kp122-tu-1791382104",
      total_amount: "5000",
      total_paid_amount: "0",
      country_code: "COL",
      user_id: "<user_id-cuenta>",
      status: "failed",
      status_detail: "failed",
      capture_mode: "automatic_async",
      currency: "COP",
      created_date: "2026-10-07T14:08:25.288Z",
      last_updated_date: "2026-10-07T14:08:25.849Z",
      integration_data: { application_id: "<application_id>" },
      payer: { entity_type: "individual" },
      config: { online: { callback_url: "https://merchant.com/pse/return" } },
      transactions: {
        payments: [
          {
            id: "PAY01M4BB3B6824R6BDME6MJAWQD5",
            amount: "5000",
            reference_id: "000ghe1vp0",
            status: "failed",
            status_detail: "processing_error",
            payment_method: { id: "pse", type: "bank_transfer", financial_institution: "1051" },
          },
        ],
      },
    };

    const failedOrderBody = {
      errors: [
        {
          code: "failed",
          message: "The following transactions failed",
          details: ["PAY01M4BB3B6824R6BDME6MJAWQD5: processing_error"],
        },
      ],
      data: failedOrder,
    };

    function mockFailure(status: number, body: unknown): void {
      global.fetch = jest.fn().mockResolvedValue(jsonErrorResponse(status, body));
    }

    it("should return a DECLINED transaction with the order id", async () => {
      mockFailure(402, failedOrderBody);

      const transaction = expectTransaction(
        await new MercadoPagoAdapter().createPayment(pseRequest),
      );

      expect(transaction.getStatus()).toBe("DECLINED");
      expect(transaction.rawStatus).toBe("failed");
      expect(transaction.gatewayTransactionId.value).toBe("ORD01M4BB3B5XBNNB1EF1AM53K2MA");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.MERCADOPAGO);
      expect(transaction.orderReference.getValue()).toBe("kp122-tu-1791382104");
      expect(transaction.amount.getValue()).toBe("5000.00");
      expect(transaction.rejectionReason).toEqual({
        rejectionCode: "processing_error",
        rejectionCategory: "UNKNOWN",
      });
    });

    it.each([
      ["without the order in data", 402, { errors: failedOrderBody.errors }],
      ["with an order that is not failed", 402, { ...failedOrderBody, data: { ...failedOrder, status: "action_required" } }],
      ["with an order without id", 402, { ...failedOrderBody, data: { ...failedOrder, id: "" } }],
      ["with another status", 400, failedOrderBody],
    ])("should keep throwing for a failure %s", async (_case, status, body) => {
      mockFailure(status, body);

      await expect(new MercadoPagoAdapter().createPayment(pseRequest)).rejects.toBeInstanceOf(
        KitPagosError,
      );
    });

    /** La consulta medida: la orden suelta, sin `data` y sin `payer`, en `failed / failed`. */
    it("should normalise the queried failed order as DECLINED", async () => {
      const { payer: _payer, ...queried } = failedOrder;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => queried,
      });

      const transaction = await new MercadoPagoAdapter().getStatus(failedOrder.id);

      expect(transaction.getStatus()).toBe("DECLINED");
      expect(transaction.rawStatus).toBe("failed");
    });
  });
});
