import * as crypto from "crypto";
import { WompiAdapter } from "./WompiAdapter";
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
import { computeIntegritySignature } from "./wompi-pse";

describe("WompiAdapter", () => {
  const originalFetch = global.fetch;

  /**
   * Pedido base de un cobro con tarjeta.
   *
   * Lleva token desde que se midió que Wompi no cobra sin método de pago: un
   * `POST /transactions` sin `payment_method` responde
   * `422 "No se especificó método de pago o fuente de pago"`.
   */
  const validRequest: CreatePaymentRequest = {
    amount: new Amount("50000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-12345"),
    payer: new Payer({ email: "cliente@example.com" }),
    paymentMethod: PaymentMethod.card("tok_test_card_4242"),
  };

  const approvedWompiMockResponse = {
    data: {
      id: "wompi-mock-tx-123",
      status: "APPROVED",
      amount_in_cents: 5000000,
      currency: "COP",
      reference: "ord-12345",
      customer_email: "cliente@example.com",
    },
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("createPayment()", () => {
    it("should successfully create a payment and return an approved Transaction", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter();
      const transaction = expectTransaction(await adapter.createPayment(validRequest));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/wompi/transactions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount_in_cents: 5000000,
            currency: "COP",
            reference: "ord-12345",
            customer_email: "cliente@example.com",
            payment_method: {
              type: "CARD",
              token: "tok_test_card_4242",
              installments: 1,
            },
          }),
        },
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("wompi-mock-tx-123");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.WOMPI);
      expect(transaction.amount.getValue()).toBe("50000.00");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.orderReference.getValue()).toBe("ord-12345");
    });

    it("sends the amount as a JSON integer of cents, preserving the trailing zero", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter();
      await adapter.createPayment({ ...validRequest, amount: new Amount("19.90") });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // 1990 and not 199 or 19.9: the trailing zero survives to the wire.
      expect(body.amount_in_cents).toBe(1990);
      // Wompi expects an integer, not the string returned by toMinorUnits().
      expect(typeof body.amount_in_cents).toBe("number");
    });

    it("rejects an amount with more decimals than the currency allows", async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const adapter = new WompiAdapter();
      // CLP is a zero-exponent currency: an amount with cents makes no sense
      // and must fail before reaching the network, not be silently truncated.
      await expect(
        adapter.createPayment({
          ...validRequest,
          amount: new Amount("19.99"),
          currency: new Currency("CLP"),
        }),
      ).rejects.toThrow("no cabe en CLP");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should authenticate with the public key as a Bearer token when credentials are given", async () => {
      const credentials = {
        publicKey: "pub_test_wompi_123",
        privateKey: "prv_test_wompi_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter(undefined, credentials);
      await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/wompi/transactions",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer pub_test_wompi_123",
          },
        }),
      );
      // The private key must never travel in the payment creation request.
      expect(JSON.stringify(mockFetch.mock.calls[0])).not.toContain(
        credentials.privateKey,
      );
    });

    it("should omit the Authorization header when no credentials are given, so the mock stays consumable", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      await new WompiAdapter().createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("should use custom baseUrl when provided in constructor", async () => {
      // Raíz de la API: el adaptador agrega /transactions (issue #64).
      const customRoot = "https://custom.api.wompi.test";
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter(customRoot);
      await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        `${customRoot}/transactions`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should throw KitPagosError(CONNECTION_FAILED) when network fetch fails", async () => {
      const networkError = new Error("fetch failed");
      global.fetch = jest.fn().mockRejectedValue(networkError);

      const adapter = new WompiAdapter();
      await expect(adapter.createPayment(validRequest)).rejects.toThrow(KitPagosError);

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
        expect(kitError.message).toContain("Failed to connect to Wompi gateway");
      }
    });

    it("should throw KitPagosError(GATEWAY_SERVER_ERROR) when HTTP status is not ok", async () => {
      const errorPayload = { error: "Simulated scenario error" };
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => errorPayload,
      });

      const adapter = new WompiAdapter();

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
        expect(kitError.originalPayload).toEqual(errorPayload);
        expect(kitError.message).toContain("500");
      }
    });

    it("should fallback to text if error body is not valid JSON", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("Invalid JSON");
        },
        text: async () => "Bad Gateway Error Page",
      });

      const adapter = new WompiAdapter();

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
        expect(kitError.originalPayload).toBe("Bad Gateway Error Page");
      }
    });

    it("should throw KitPagosError(MALFORMED_RESPONSE) when successful response JSON cannot be parsed", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
      });

      const adapter = new WompiAdapter();

      try {
        await adapter.createPayment(validRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
      }
    });
  });

  describe("getStatus()", () => {
    it("returns a normalized Transaction when the id exists in the simulator", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter();
      const transaction = await adapter.getStatus("wompi-mock-tx-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/wompi/transactions/wompi-mock-tx-123",
        expect.objectContaining({ method: "GET" }),
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("wompi-mock-tx-123");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.WOMPI);
      expect(transaction.amount.getValue()).toBe("50000.00");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.orderReference.getValue()).toBe("ord-12345");
    });

    it("includes Authorization header when credentials are provided", async () => {
      const credentials = {
        publicKey: "pub_test_wompi_123",
        privateKey: "prv_test_wompi_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;

      const adapter = new WompiAdapter(undefined, credentials);
      await adapter.getStatus("wompi-mock-tx-123");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("wompi-mock-tx-123"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer pub_test_wompi_123",
          }),
        }),
      );
    });

    it("throws KitPagosError(RESOURCE_NOT_FOUND) when the id does not exist in the simulator", async () => {
      const notFoundPayload = {
        error: {
          type: "NOT_FOUND",
          reason: "Transaction with id 'non-existent-id' does not exist",
        },
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => notFoundPayload,
      });

      const adapter = new WompiAdapter();

      try {
        await adapter.getStatus("non-existent-id");
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.RESOURCE_NOT_FOUND);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
        expect(kitError.originalPayload).toEqual(notFoundPayload);
      }
    });

    it("throws KitPagosError(CONNECTION_FAILED) when the network fails during status query", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("fetch failed"));

      const adapter = new WompiAdapter();

      try {
        await adapter.getStatus("any-id");
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const kitError = error as KitPagosError;
        expect(kitError.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
        expect(kitError.gateway).toBe(Gateway.WOMPI);
      }
    });
  });

  describe("verifySignature()", () => {
    it("should return true when webhook signature is valid", () => {
      const adapter = new WompiAdapter();
      const secret = "test_events_secret_wompi";
      const timestamp = 1602113476;
      const transactionId = "1292-1602113476-10985";
      const status = "APPROVED";

      const checksum = crypto
        .createHash("sha256")
        .update(`${transactionId}${status}${timestamp}${secret}`)
        .digest("hex");

      const payload = JSON.stringify({
        event: "transaction.updated",
        data: {
          transaction: { id: transactionId, status },
        },
        timestamp,
        signature: {
          properties: ["data.transaction.id", "data.transaction.status"],
          checksum,
        },
      });

      const headers = { "x-event-checksum": checksum };
      const isValid = adapter.verifySignature(payload, headers, secret);

      expect(isValid).toBe(true);
    });

    it("should return false when webhook signature is invalid", () => {
      const adapter = new WompiAdapter();
      const secret = "test_events_secret_wompi";
      const timestamp = 1602113476;
      const transactionId = "1292-1602113476-10985";
      const status = "APPROVED";

      const payload = JSON.stringify({
        event: "transaction.updated",
        data: {
          transaction: { id: transactionId, status },
        },
        timestamp,
        signature: {
          properties: ["data.transaction.id", "data.transaction.status"],
          checksum: "invalid_checksum",
        },
      });

      const headers = { "x-event-checksum": "wrong_checksum" };
      const isValid = adapter.verifySignature(payload, headers, secret);

      expect(isValid).toBe(false);
    });
  });

  /**
   * PSE (issue #64). Lo que se verifica acá es que el adaptador respete el orden
   * real medido contra el sandbox: la creación no trae la URL de redirección, así
   * que hay que consultar hasta que aparezca, y el resultado debe ser
   * REDIRECT_REQUIRED y no una transacción.
   */
  describe("createPayment() con tarjeta", () => {
    function mockCreated() {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => approvedWompiMockResponse,
      });
      global.fetch = mockFetch;
      return mockFetch;
    }

    /**
     * Wompi cobra la tarjeta con el token del comercio y las cuotas dentro de
     * `payment_method`, que es el campo cuya ausencia responde
     * `422 "No se especificó método de pago o fuente de pago"`.
     */
    it("should send the card token and installments as payment_method", async () => {
      const mockFetch = mockCreated();

      await new WompiAdapter().createPayment(validRequest);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payment_method).toEqual({
        type: "CARD",
        token: "tok_test_card_4242",
        installments: 1,
      });
    });

    it("should send the requested installments", async () => {
      const mockFetch = mockCreated();

      await new WompiAdapter().createPayment({
        ...validRequest,
        paymentMethod: PaymentMethod.card("tok_test_card_4242", { installments: 12 }),
      });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).payment_method.installments).toBe(
        12,
      );
    });

    /** El número de la tarjeta no viaja nunca: el SDK solo acepta el token. */
    it("should never send anything that looks like a card number", async () => {
      const mockFetch = mockCreated();

      await new WompiAdapter().createPayment(validRequest);

      expect(mockFetch.mock.calls[0][1].body).not.toMatch(/\b\d{13,19}\b/);
    });

    /**
     * Falla acá y no en la pasarela. Es una llamada de red que se ahorra, y sobre todo un
     * mensaje que dice qué falta y dónde conseguirlo, en vez del 422 en castellano de
     * Wompi sobre un campo que el comercio no escribió.
     */
    it("should refuse a card payment without a token before calling the gateway", async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      await expect(
        new WompiAdapter().createPayment({
          ...validRequest,
          paymentMethod: undefined,
        }),
      ).rejects.toMatchObject({
        code: KitPagosErrorCode.INVALID_REQUEST,
        gateway: Gateway.WOMPI,
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should say where to get the token in the error message", async () => {
      global.fetch = jest.fn();

      await expect(
        new WompiAdapter().createPayment({ ...validRequest, paymentMethod: undefined }),
      ).rejects.toThrow("POST /v1/tokens/cards");
    });
  });

  describe("createPayment() con PSE", () => {
    const pseRequest: CreatePaymentRequest = {
      amount: new Amount("150000"),
      currency: new Currency("COP"),
      orderReference: new OrderReference("ord-pse-1"),
      payer: new Payer({
        email: "cliente@example.com",
        documentType: "CC",
        documentNumber: "1099888777",
      }),
      paymentMethod: PaymentMethod.pse({ bankCode: "1" }),
    };

    /** Creación sin URL, tal como responde Wompi. */
    const createdPse = {
      data: {
        id: "wompi-pse-1",
        status: "PENDING",
        amount_in_cents: 15000000,
        currency: "COP",
        reference: "ord-pse-1",
        customer_email: "cliente@example.com",
        payment_method: { type: "PSE", extra: { is_three_ds: false } },
      },
    };

    /** Consulta posterior, ya con la URL. */
    const pseWithUrl = {
      data: {
        ...createdPse.data,
        payment_method: {
          type: "PSE",
          extra: { async_payment_url: "https://banco.example/pagar?ticket=abc" },
        },
      },
    };

    function mockResponses(...bodies: unknown[]) {
      const mockFetch = jest.fn();
      for (const body of bodies) {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
      }
      global.fetch = mockFetch;
      return mockFetch;
    }

    it("should return REDIRECT_REQUIRED with the url found after polling", async () => {
      mockResponses(createdPse, pseWithUrl);

      const result = await new WompiAdapter().createPayment(pseRequest);

      expect(result.outcome).toBe("REDIRECT_REQUIRED");
      if (result.outcome !== "REDIRECT_REQUIRED") return;
      expect(result.redirect.redirectUrl).toBe("https://banco.example/pagar?ticket=abc");
      expect(result.redirect.gatewayTransactionId.value).toBe("wompi-pse-1");
    });

    it("should send the native PSE fields that Wompi requires", async () => {
      const mockFetch = mockResponses(createdPse, pseWithUrl);

      await new WompiAdapter().createPayment(pseRequest);

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody.payment_method).toEqual({
        type: "PSE",
        user_type: 0,
        user_legal_id_type: "CC",
        user_legal_id: "1099888777",
        financial_institution_code: "1",
        payment_description: "Pago ord-pse-1",
      });
    });

    /**
     * Un documento faltante es un error del comercio, no un rechazo de la
     * pasarela: atajarlo local ahorra una ida y vuelta y da un mensaje que dice
     * qué falta, en vez de un 422 genérico.
     */
    it("should fail locally without touching the network if the payer has no document", async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      await expect(
        new WompiAdapter().createPayment({
          ...pseRequest,
          payer: new Payer({ email: "cliente@example.com" }),
        }),
      ).rejects.toMatchObject({ code: KitPagosErrorCode.INVALID_REQUEST });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should sign the transaction and attach the acceptance token when configured", async () => {
      const mockFetch = mockResponses(
        { data: { presigned_acceptance: { acceptance_token: "tok_sim_1" } } },
        createdPse,
        pseWithUrl,
      );

      await new WompiAdapter(undefined, {
        publicKey: "pub_test_1",
        privateKey: "prv_test_1",
        integritySecret: "test_integrity_secreto",
      }).createPayment(pseRequest);

      // La primera llamada es por el token de aceptación, que es de un solo uso.
      expect(mockFetch.mock.calls[0][0]).toContain("/merchants/pub_test_1");

      const sentBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(sentBody.acceptance_token).toBe("tok_sim_1");
      expect(sentBody.signature).toBe(
        computeIntegritySignature("ord-pse-1", 15000000, "COP", "test_integrity_secreto"),
      );
    });

    /**
     * Wompi acepta una sola URL de retorno mientras ReturnUrlConfig admite una
     * por resultado. Se manda la de PENDING porque es el estado en el que está la
     * transacción cuando se redirige al pagador.
     */
    it("should send the return url resolved for the pending state", async () => {
      const mockFetch = mockResponses(createdPse, pseWithUrl);

      await new WompiAdapter().createPayment({
        ...pseRequest,
        returnUrlConfig: new ReturnUrlConfig("https://comercio.example.com/retorno"),
      });

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody.redirect_url).toBe("https://comercio.example.com/retorno");
    });

    /**
     * Los dos métodos viajan en el mismo campo nativo, así que nunca se mandan juntos: un
     * cobro con tarjeta lleva el token y ningún dato de PSE, y un PSE al revés.
     *
     * Esta prueba antes afirmaba que un cobro con tarjeta **no mandaba `payment_method`**,
     * que era lo que el SDK hacía y lo que Wompi rechaza con
     * `422 "No se especificó método de pago o fuente de pago"`. La prueba pasaba porque el
     * simulador aceptaba el cobro sin método.
     */
    it("should send the card in payment_method, without any PSE field", async () => {
      const mockFetch = mockResponses(approvedWompiMockResponse);

      await new WompiAdapter().createPayment(validRequest);

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody.payment_method.type).toBe("CARD");
      expect(sentBody.payment_method.token).toBe("tok_test_card_4242");
      expect(sentBody.payment_method.financial_institution_code).toBeUndefined();
      expect(sentBody.payment_method.user_legal_id).toBeUndefined();
    });
  });
});