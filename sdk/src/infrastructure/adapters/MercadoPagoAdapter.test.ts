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
    // Token y cuotas son obligatorios: medido contra la API real, un cobro sin token
    // responde `400 "payment_method_id attribute can't be null"` y sin cuotas
    // `400 "Invalid installments"`.
    paymentMethod: PaymentMethod.card("a1b2c3d4e5f6"),
  };

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
    it("creates a payment successfully sending transaction_amount in pesos", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      const adapter = new MercadoPagoAdapter();
      const transaction = expectTransaction(await adapter.createPayment(validRequest));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/mercadopago/payments",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Sin este header Mercado Pago no crea nada; ver el docstring de request().
            "X-Idempotency-Key": expect.any(String),
          },
          body: JSON.stringify({
            transaction_amount: 50000,
            description: "ORDER-MP-123",
            external_reference: "ORDER-MP-123",
            token: "a1b2c3d4e5f6",
            installments: 1,
            payer: { email: "cliente.mp@example.com" },
          }),
          signal: expect.any(AbortSignal),
        }
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.gatewayTransactionId.value).toBe("1234567890");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.MERCADOPAGO);
      expect(transaction.amount.getValue()).toBe("50000.00");
    });

    it("authenticates with a Bearer token using the credentials privateKey", async () => {
      const credentials = {
        publicKey: "APP_USR_pub_123",
        privateKey: "APP_USR_priv_secret_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      const adapter = new MercadoPagoAdapter(undefined, credentials);
      await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer APP_USR_priv_secret_456",
            "X-Idempotency-Key": expect.any(String),
          },
        })
      );
    });

    /**
     * Mercado Pago es la única de las cuatro que exige una llave de idempotencia, y sin ella
     * no crea nada: `400 "Header X-Idempotency-Key can't be null"` en `/payments` y
     * `400 "Missing HTTP header: X-Idempotency-Key."` en `/orders`, que es por donde va PSE.
     * Lo encontraron las pruebas contra sandbox; las mediciones a mano mandaban el header sin
     * pensarlo y el simulador no lo pedía, así que el SDK no podía cobrar por ningún método.
     */
    it("sends an idempotency key on every creation", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      await new MercadoPagoAdapter().createPayment(validRequest);

      const key = mockFetch.mock.calls[0][1].headers["X-Idempotency-Key"];
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
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedMpResponse,
      });
      global.fetch = mockFetch;

      const adapter = new MercadoPagoAdapter();
      await adapter.createPayment(validRequest);
      await adapter.createPayment(validRequest);

      const [firstCall, secondCall] = mockFetch.mock.calls.map(
        (call) => call[1].headers["X-Idempotency-Key"],
      );
      expect(firstCall).not.toBe(secondCall);
    });

    it("returns redirectRequired when the card payment requires 3DS authentication", async () => {
      const response3ds = {
        id: 987654321,
        status: "pending",
        status_detail: "pending_challenge",
        point_of_interaction: {
          transaction_data: {
            ticket_url: "https://www.mercadopago.com.co/payments/987654321/ticket",
          },
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => response3ds,
      });

      const adapter = new MercadoPagoAdapter();
      const result = await adapter.createPayment(validRequest);
      expect(result.outcome).toBe("REDIRECT_REQUIRED");
      if (result.outcome === "REDIRECT_REQUIRED") {
        expect(result.redirect.redirectUrl).toBe(
          "https://www.mercadopago.com.co/payments/987654321/ticket",
        );
        expect(result.redirect.gatewayTransactionId.value).toBe("987654321");
        expect(result.redirect.gatewayTransactionId.gateway).toBe(Gateway.MERCADOPAGO);
        expect(result.redirect.rawStatus).toBe("pending");
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

      const adapter = new MercadoPagoAdapter();
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

      const adapter = new MercadoPagoAdapter();
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

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
      }
    });

    it("maps a response with malformed JSON to MALFORMED_RESPONSE", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });

      const adapter = new MercadoPagoAdapter();
      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
      }
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
