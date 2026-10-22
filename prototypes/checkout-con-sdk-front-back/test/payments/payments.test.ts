import { Gateway, KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";
import { PaymentTechnicalError } from "../../src/checkout/PaymentsPort";
import { createPayments } from "../../src/payments";

/**
 * Pruebas del módulo de pagos del prototipo B. El SDK se reemplaza por un doble: lo que se
 * prueba aquí es la traducción entre el puerto del esqueleto y `kit-pagos-colombia`, no la
 * red. El SDK real tiene sus propias pruebas en `sdk/`.
 */

const mockCreatePayment = jest.fn();
const mockGetPaymentStatus = jest.fn();
const mockGetPseBanks = jest.fn();
const mockValidateWebhook = jest.fn();
const mockKitPagosConstructor = jest.fn();

jest.mock("kit-pagos-colombia", () => {
  const actual = jest.requireActual("kit-pagos-colombia");
  return {
    ...actual,
    KitPagos: jest.fn().mockImplementation((options: unknown) => {
      mockKitPagosConstructor(options);
      return {
        createPayment: mockCreatePayment,
        getPaymentStatus: mockGetPaymentStatus,
        getPseBanks: mockGetPseBanks,
        validateWebhook: mockValidateWebhook,
      };
    }),
  };
});

/** Una transacción del SDK reducida a lo que el módulo lee. */
function fakeTransaction(id: string, status: string, rawStatus: string = status) {
  return {
    gatewayTransactionId: { value: id, gateway: Gateway.WOMPI },
    getStatus: () => status,
    rawStatus,
  };
}

function webhookError(code: KitPagosErrorCode): KitPagosError {
  return new KitPagosError(code, Gateway.WOMPI, null, "desde el doble");
}

/** Un error que no viene del SDK: no es un fallo de la pasarela y no debe reetiquetarse. */
const foreignError = new Error("error ajeno al SDK");

/** El esqueleto en el ambiente del simulador, sin llaves: lo que prueba la traducción sin red. */
const SIMULATOR = { CHECKOUT_ENVIRONMENT: "simulator" };

/** Las tres llaves sin las que el sandbox oficial no cobra. */
const SANDBOX_KEYS = {
  WOMPI_PUBLIC_KEY: "pub_test_x",
  WOMPI_PRIVATE_KEY: "prv_test_x",
  WOMPI_INTEGRITY_SECRET: "integrity_x",
};

const payer = {
  fullName: "Pedro Pérez",
  email: "pedro@example.com",
  documentType: "CC" as const,
  documentNumber: "1020304050",
  phone: "3001234567",
  address: { streetName: "Carrera 13", streetNumber: "63-39", neighborhood: "Chapinero", city: "Bogotá", zipCode: "110231" },
};

const cardRequest = {
  gateway: "wompi",
  orderReference: "ORD-1",
  amountInPesos: 5_000_000,
  description: "Teclado",
  payer,
  method: { type: "CARD" as const, cardToken: "tok_123", installments: 3 },
  returnUrl: "http://localhost:4000/orders/ORD-1",
  payerIp: "190.24.1.10",
};

const pseRequest = {
  ...cardRequest,
  method: { type: "PSE" as const, bankCode: "1007", personType: "NATURAL" as const },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("payments module (kit-pagos-colombia)", () => {
  describe("publicConfig", () => {
    it("should expose the gateway, the public key and the simulator environment the browser needs", () => {
      const payments = createPayments({ ...SIMULATOR, WOMPI_PUBLIC_KEY: "pub_test_desde_entorno" });
      expect(payments.publicConfig("wompi")).toEqual({
        gateway: "WOMPI",
        publicKey: "pub_test_desde_entorno",
        environment: "simulator",
      });
    });

    it("should tell the browser to tokenize in the sandbox when the skeleton charges there", () => {
      expect(createPayments(SANDBOX_KEYS).publicConfig("wompi")).toEqual({
        gateway: "WOMPI",
        publicKey: "pub_test_x",
        environment: "sandbox",
      });
    });

    it("should fall back to the example credentials in the simulator without Wompi keys", () => {
      expect(createPayments(SIMULATOR).publicConfig("wompi").publicKey).toBe("pub_test_ejemplo_no_real");
    });
  });

  describe("createPayment", () => {
    it("should map the port request to the SDK and translate an approved transaction", async () => {
      mockCreatePayment.mockResolvedValue({
        outcome: "TRANSACTION",
        transaction: fakeTransaction("tx-1", "APPROVED"),
      });

      const snapshot = await createPayments(SIMULATOR).createPayment(cardRequest);

      expect(snapshot).toEqual({
        transactionId: "tx-1",
        status: "APPROVED",
        nativeStatus: "APPROVED",
      });

      const request = mockCreatePayment.mock.calls[0][0];
      expect(request.amount.getValue()).toBe("5000000");
      expect(request.currency.getCode()).toBe("COP");
      expect(request.orderReference.getValue()).toBe("ORD-1");
      expect(request.payer).toMatchObject({ email: payer.email, fullName: payer.fullName });
      expect(request.paymentMethod).toMatchObject({ type: "CARD", cardToken: "tok_123", installments: 3 });
      expect(request.returnUrlConfig.resolveFor("APPROVED")).toBe(cardRequest.returnUrl);
    });

    it("should hand the SDK the payer's names, area code, address and IP that some gateways ask for apart", async () => {
      mockCreatePayment.mockResolvedValue({ outcome: "TRANSACTION", transaction: fakeTransaction("tx-1", "APPROVED") });

      await createPayments(SIMULATOR).createPayment(cardRequest);

      const request = mockCreatePayment.mock.calls[0][0];
      expect(request.payer).toMatchObject({
        firstName: "Pedro",
        lastName: "Pérez",
        phone: "3001234567",
        phoneAreaCode: "57",
        address: payer.address,
      });
      expect(request.ipAddress).toBe("190.24.1.10");
    });

    it("should send a card without token when the gateway takes the card in its own page", async () => {
      mockCreatePayment.mockResolvedValue({
        outcome: "REDIRECT_REQUIRED",
        redirect: { redirectUrl: "https://pay.example/checkout", gatewayTransactionId: { value: "tx-h" } },
      });

      await createPayments(SIMULATOR).createPayment({ ...cardRequest, method: { type: "CARD", installments: 1 } });

      const method = mockCreatePayment.mock.calls[0][0].paymentMethod;
      expect(method).toMatchObject({ type: "CARD", installments: 1 });
      expect(method.cardToken).toBeUndefined();
    });

    it("should map a PSE payment to the SDK method", async () => {
      mockCreatePayment.mockResolvedValue({
        outcome: "TRANSACTION",
        transaction: fakeTransaction("tx-pse", "PENDING"),
      });

      await createPayments(SIMULATOR).createPayment(pseRequest);

      expect(mockCreatePayment.mock.calls[0][0].paymentMethod).toMatchObject({
        type: "PSE",
        bankCode: "1007",
        payerKind: "NATURAL",
      });
    });

    it("should surface a business decline as a snapshot, not as an error", async () => {
      mockCreatePayment.mockResolvedValue({
        outcome: "TRANSACTION",
        transaction: fakeTransaction("tx-dec", "DECLINED", "DECLINED"),
      });

      await expect(createPayments(SIMULATOR).createPayment(cardRequest)).resolves.toEqual({
        transactionId: "tx-dec",
        status: "DECLINED",
        nativeStatus: "DECLINED",
      });
    });

    it.each(["EXPIRED", "VOIDED", "ERROR"])(
      "should map the terminal %s state to DECLINED and keep the native status",
      async (native) => {
        mockCreatePayment.mockResolvedValue({
          outcome: "TRANSACTION",
          transaction: fakeTransaction("tx-terminal", native),
        });

        const snapshot = await createPayments(SIMULATOR).createPayment(cardRequest);

        expect(snapshot.status).toBe("DECLINED");
        expect(snapshot.nativeStatus).toBe(native);
      },
    );

    it("should translate a redirect outcome to a PENDING snapshot with the bank URL", async () => {
      mockCreatePayment.mockResolvedValue({
        outcome: "REDIRECT_REQUIRED",
        redirect: {
          redirectUrl: "https://banco.example/pagar",
          gatewayTransactionId: { value: "tx-pse-2" },
          rawStatus: "PENDING",
        },
      });

      const snapshot = await createPayments(SIMULATOR).createPayment(pseRequest);

      expect(snapshot).toEqual({
        transactionId: "tx-pse-2",
        status: "PENDING",
        nativeStatus: "PENDING",
        redirectUrl: "https://banco.example/pagar",
      });
    });

    it("should wrap a technical failure as PaymentTechnicalError with the SDK error as cause", async () => {
      const failure = webhookError(KitPagosErrorCode.GATEWAY_TIMEOUT);
      mockCreatePayment.mockRejectedValue(failure);

      const error = await createPayments(SIMULATOR).createPayment(cardRequest).catch((e) => e);

      expect(error).toBeInstanceOf(PaymentTechnicalError);
      expect((error as PaymentTechnicalError).cause).toBe(failure);
      expect((error as Error).message).toContain("GATEWAY_TIMEOUT");
    });

    it("should let a non-SDK error bubble untouched", async () => {
      mockCreatePayment.mockRejectedValue(foreignError);

      await expect(createPayments(SIMULATOR).createPayment(cardRequest)).rejects.toBe(foreignError);
    });
  });

  describe("listPseBanks", () => {
    it("should map the SDK banks to the port options", async () => {
      mockGetPseBanks.mockResolvedValue([
        { code: "1", name: "Banco que aprueba" },
        { code: "2", name: "Banco que declina" },
      ]);

      await expect(createPayments(SIMULATOR).listPseBanks("wompi")).resolves.toEqual([
        { code: "1", name: "Banco que aprueba" },
        { code: "2", name: "Banco que declina" },
      ]);
    });

    it("should wrap a technical failure", async () => {
      mockGetPseBanks.mockRejectedValue(webhookError(KitPagosErrorCode.MAX_RETRIES_EXCEEDED));

      await expect(createPayments(SIMULATOR).listPseBanks("wompi")).rejects.toBeInstanceOf(PaymentTechnicalError);
    });
  });

  describe("getPaymentStatus", () => {
    it("should query the SDK and translate the result", async () => {
      mockGetPaymentStatus.mockResolvedValue(fakeTransaction("tx-q", "PENDING"));

      await expect(createPayments(SIMULATOR).getPaymentStatus("wompi", "tx-q")).resolves.toEqual({
        transactionId: "tx-q",
        status: "PENDING",
        nativeStatus: "PENDING",
      });
      expect(mockGetPaymentStatus).toHaveBeenCalledWith("tx-q");
    });

    it("should wrap a technical failure as a PaymentTechnicalError", async () => {
      mockGetPaymentStatus.mockRejectedValue(webhookError(KitPagosErrorCode.GATEWAY_SERVER_ERROR));

      await expect(createPayments(SIMULATOR).getPaymentStatus("wompi", "tx-q")).rejects.toBeInstanceOf(
        PaymentTechnicalError,
      );
    });
  });

  describe("verifyWebhook", () => {
    it("should translate a verified event and normalize headers and query", async () => {
      mockValidateWebhook.mockReturnValue({
        eventType: "transaction.updated",
        gatewayTransactionId: "tx-wh",
        newStatus: "APPROVED",
        gateway: Gateway.WOMPI,
      });

      const notification = await createPayments(SIMULATOR).verifyWebhook("wompi", {
        rawBody: "{}",
        headers: {
          "x-event-checksum": ["abc", "ignored"],
          "content-type": "application/json",
          "x-missing": undefined,
        },
        query: { id: "tx-wh", empty: undefined },
      });

      expect(notification).toEqual({
        transactionId: "tx-wh",
        status: "APPROVED",
        nativeStatus: "APPROVED",
      });
      const [payload, headers, options] = mockValidateWebhook.mock.calls[0];
      expect(payload).toBe("{}");
      expect(headers).toEqual({ "x-event-checksum": "abc", "content-type": "application/json" });
      expect(options).toEqual({ gateway: "WOMPI", query: { id: "tx-wh" } });
    });

    it("should translate a declined event retaining the native status", async () => {
      mockValidateWebhook.mockReturnValue({
        eventType: "transaction.updated",
        gatewayTransactionId: "tx-wh",
        newStatus: "DECLINED",
        gateway: Gateway.WOMPI,
      });

      const notification = await createPayments(SIMULATOR).verifyWebhook("wompi", {
        rawBody: "{}",
        headers: {},
        query: {},
      });

      expect(notification).toEqual({
        transactionId: "tx-wh",
        status: "DECLINED",
        nativeStatus: "DECLINED",
      });
    });

    it("should confirm by querying when the signed event does not carry the status", async () => {
      mockValidateWebhook.mockReturnValue({
        eventType: "payment",
        gatewayTransactionId: "tx-wh",
        newStatus: "PENDING",
        gateway: Gateway.WOMPI,
      });
      mockGetPaymentStatus.mockResolvedValue(fakeTransaction("tx-wh", "APPROVED", "approved"));

      const notification = await createPayments(SIMULATOR).verifyWebhook("wompi", {
        rawBody: "{}",
        headers: {},
        query: {},
      });

      expect(mockGetPaymentStatus).toHaveBeenCalledWith("tx-wh");
      expect(notification).toEqual({ transactionId: "tx-wh", status: "APPROVED", nativeStatus: "approved" });
    });

    it("should return null when the signature is invalid", async () => {
      mockValidateWebhook.mockImplementation(() => {
        throw webhookError(KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID);
      });

      await expect(
        createPayments(SIMULATOR).verifyWebhook("wompi", { rawBody: "{}", headers: {}, query: {} }),
      ).resolves.toBeNull();
    });

    it("should wrap any other SDK failure as a technical error", async () => {
      mockValidateWebhook.mockImplementation(() => {
        throw webhookError(KitPagosErrorCode.MALFORMED_RESPONSE);
      });

      await expect(
        createPayments(SIMULATOR).verifyWebhook("wompi", { rawBody: "{}", headers: {}, query: {} }),
      ).rejects.toBeInstanceOf(PaymentTechnicalError);
    });

    it("should let a non-SDK error bubble untouched", async () => {
      mockValidateWebhook.mockImplementation(() => {
        throw foreignError;
      });

      await expect(
        createPayments(SIMULATOR).verifyWebhook("wompi", { rawBody: "{}", headers: {}, query: {} }),
      ).rejects.toBe(foreignError);
    });
  });

  describe("SDK configuration", () => {
    it("should read the Wompi credentials from the environment, including the webhook secret and base URL", () => {
      createPayments({
        WOMPI_PUBLIC_KEY: " pub_test_x ",
        WOMPI_PRIVATE_KEY: "prv_test_x",
        WOMPI_INTEGRITY_SECRET: "integrity_x",
        WOMPI_EVENTS_SECRET: "events_x",
        WOMPI_BASE_URL: "http://simulador:3000/v1/sim/wompi",
      });

      expect(mockKitPagosConstructor).toHaveBeenCalledWith({
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: {
            publicKey: "pub_test_x",
            privateKey: "prv_test_x",
            integritySecret: "integrity_x",
            webhookSecret: "events_x",
          },
        },
        environment: "simulator",
        baseUrl: "http://simulador:3000/v1/sim/wompi",
      });
    });

    it("should use the simulator integrity secret and the skeleton's simulator in the simulator without keys", () => {
      createPayments(SIMULATOR);

      expect(mockKitPagosConstructor).toHaveBeenCalledWith({
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: {
            publicKey: "pub_test_ejemplo_no_real",
            privateKey: "prv_test_ejemplo_no_real",
            integritySecret: "test_integrity_kit_pagos_simulator",
          },
        },
        environment: "simulator",
        baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/wompi",
      });
    });

    it("should follow the simulator URL of the skeleton, as npm run start:local sets it", () => {
      createPayments({ ...SIMULATOR, CHECKOUT_SIMULATOR_URL: "http://localhost:3000/" });

      expect(mockKitPagosConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ environment: "simulator", baseUrl: "http://localhost:3000/v1/sim/wompi" }),
      );
    });

    it("should charge in the official sandbox by default, with the SDK catalog and no base URL", () => {
      createPayments(SANDBOX_KEYS);

      expect(mockKitPagosConstructor).toHaveBeenCalledWith({
        gateway: Gateway.WOMPI,
        credentials: {
          [Gateway.WOMPI]: { publicKey: "pub_test_x", privateKey: "prv_test_x", integritySecret: "integrity_x" },
        },
        environment: "sandbox",
      });
    });

    it("should stop at start-up and name the sandbox keys that are missing", () => {
      expect(() => createPayments({ WOMPI_PUBLIC_KEY: "pub_test_x" })).toThrow(
        "Para cobrar en el sandbox faltan las llaves de todas las pasarelas en el .env de la raíz (Wompi: WOMPI_PRIVATE_KEY, WOMPI_INTEGRITY_SECRET",
      );
      expect(mockKitPagosConstructor).not.toHaveBeenCalled();
    });
  });

  describe("gateways", () => {
    it("should list the gateways the checkout charges with and how each one takes the card", () => {
      expect(createPayments(SIMULATOR).listGateways()).toEqual([
        { id: "wompi", name: "Wompi", cardCapture: "BROWSER_TOKEN" },
        { id: "mercadopago", name: "Mercado Pago", cardCapture: "BROWSER_TOKEN" },
        { id: "kushki", name: "Kushki", cardCapture: "BROWSER_TOKEN" },
        { id: "rapyd", name: "Rapyd", cardCapture: "HOSTED_PAGE" },
      ]);
    });

    it("should offer, in the sandbox, only the gateways whose keys are in the environment", () => {
      expect(createPayments(SANDBOX_KEYS).listGateways().map((option) => option.id)).toEqual(["wompi"]);
    });

    it("should refuse a gateway it does not charge with", async () => {
      const payments = createPayments(SIMULATOR);

      expect(() => payments.publicConfig("otra")).toThrow("El checkout no cobra con la pasarela «otra»");
      await expect(payments.getPaymentStatus("otra", "tx-q")).rejects.toThrow("«otra»");
    });

    it("should point the way to the simulator when no gateway has its sandbox keys", () => {
      expect(() => createPayments({})).toThrow("Sin ellas, usa el simulador: npm run start:local.");
    });
  });

  describe("Mercado Pago", () => {
    const MERCADOPAGO_KEYS = {
      MERCADOPAGO_ACCESS_TOKEN: "APP_USR-access",
      MERCADOPAGO_PUBLIC_KEY: "APP_USR-public",
      MERCADOPAGO_WEBHOOK_SECRET: "mp_webhook_x",
    };

    it("should hand the SDK the access token, the public key and the webhook secret, in the official sandbox", () => {
      const payments = createPayments(MERCADOPAGO_KEYS);

      expect(payments.listGateways().map((option) => option.id)).toEqual(["mercadopago"]);
      expect(mockKitPagosConstructor).toHaveBeenCalledWith({
        gateway: Gateway.MERCADOPAGO,
        credentials: {
          [Gateway.MERCADOPAGO]: { publicKey: "APP_USR-public", privateKey: "APP_USR-access", webhookSecret: "mp_webhook_x" },
        },
        environment: "sandbox",
      });
    });

    it("should tell the browser to tokenize with Mercado Pago's public key", () => {
      expect(createPayments(MERCADOPAGO_KEYS).publicConfig("mercadopago")).toEqual({
        gateway: "MERCADOPAGO",
        publicKey: "APP_USR-public",
        environment: "sandbox",
      });
    });

    it("should charge in the skeleton's simulator without keys", () => {
      createPayments(SIMULATOR);

      expect(mockKitPagosConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: Gateway.MERCADOPAGO,
          environment: "simulator",
          baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/mercadopago",
        }),
      );
    });

    it("should name its missing keys when no gateway can charge in the sandbox", () => {
      expect(() => createPayments({})).toThrow("Mercado Pago: MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_PUBLIC_KEY");
    });
  });

  describe("Kushki", () => {
    const KUSHKI_KEYS = {
      KUSHKI_PUBLIC_MERCHANT_ID: "public-merchant",
      KUSHKI_PRIVATE_MERCHANT_ID: "private-merchant",
      KUSHKI_WEBHOOK_SECRET: "kushki_webhook_x",
    };

    it("should hand the SDK the two merchant ids and the webhook secret, in the official sandbox", () => {
      const payments = createPayments(KUSHKI_KEYS);

      expect(payments.listGateways().map((option) => option.id)).toEqual(["kushki"]);
      expect(mockKitPagosConstructor).toHaveBeenCalledWith({
        gateway: Gateway.KUSHKI,
        credentials: {
          [Gateway.KUSHKI]: { publicKey: "public-merchant", privateKey: "private-merchant", webhookSecret: "kushki_webhook_x" },
        },
        environment: "sandbox",
      });
    });

    it("should tell the browser to tokenize with the public merchant id", () => {
      expect(createPayments(KUSHKI_KEYS).publicConfig("kushki")).toEqual({
        gateway: "KUSHKI",
        publicKey: "public-merchant",
        environment: "sandbox",
      });
    });

    it("should charge in the skeleton's simulator without keys", () => {
      createPayments(SIMULATOR);

      expect(mockKitPagosConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: Gateway.KUSHKI,
          environment: "simulator",
          baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/kushki",
        }),
      );
    });

    it("should keep Kushki's native status from the signed webhook, not the SDK's translation", async () => {
      mockValidateWebhook.mockReturnValue({
        eventType: "transaction.updated",
        gatewayTransactionId: "ticket-1",
        newStatus: "APPROVED",
        gateway: Gateway.KUSHKI,
        rawStatus: "APPROVAL",
      });

      const notification = await createPayments(KUSHKI_KEYS).verifyWebhook("kushki", {
        rawBody: "{}",
        headers: {},
        query: {},
      });

      expect(notification).toEqual({ transactionId: "ticket-1", status: "APPROVED", nativeStatus: "APPROVAL" });
      expect(mockGetPaymentStatus).not.toHaveBeenCalled();
    });

    it("should name its missing keys when no gateway can charge in the sandbox", () => {
      expect(() => createPayments({})).toThrow("Kushki: KUSHKI_PUBLIC_MERCHANT_ID, KUSHKI_PRIVATE_MERCHANT_ID");
    });
  });

  describe("Rapyd", () => {
    const RAPYD_KEYS = {
      RAPYD_API_ACCESS_KEY: "access-key",
      RAPYD_API_SECRET_KEY: "secret-key",
      RAPYD_WEBHOOK_URL: "https://tienda.example/webhooks/rapyd",
    };

    it("should hand the SDK both keys and the registered webhook URL, in the official sandbox", () => {
      const payments = createPayments(RAPYD_KEYS);

      expect(payments.listGateways()).toEqual([{ id: "rapyd", name: "Rapyd", cardCapture: "HOSTED_PAGE" }]);
      expect(mockKitPagosConstructor).toHaveBeenCalledWith({
        gateway: Gateway.RAPYD,
        credentials: {
          [Gateway.RAPYD]: {
            publicKey: "access-key",
            privateKey: "secret-key",
            webhookUrl: "https://tienda.example/webhooks/rapyd",
          },
        },
        environment: "sandbox",
      });
    });

    it("should not give the browser the access key, since the card is typed in Rapyd's page", () => {
      expect(createPayments(RAPYD_KEYS).publicConfig("rapyd")).toEqual({ gateway: "RAPYD", environment: "sandbox" });
    });

    it("should create the card payment without a token, for the SDK to send it to Rapyd's checkout", async () => {
      mockCreatePayment.mockResolvedValue({
        outcome: "REDIRECT_REQUIRED",
        redirect: {
          redirectUrl: "https://sandboxcheckout.rapyd.net/?token=checkout_1",
          gatewayTransactionId: { value: "checkout_1" },
          rawStatus: "NEW",
        },
      });

      const snapshot = await createPayments(RAPYD_KEYS).createPayment({
        ...cardRequest,
        gateway: "rapyd",
        method: { type: "CARD", installments: 1 },
      });

      expect(snapshot).toEqual({
        transactionId: "checkout_1",
        status: "PENDING",
        nativeStatus: "NEW",
        redirectUrl: "https://sandboxcheckout.rapyd.net/?token=checkout_1",
      });
      expect(mockCreatePayment.mock.calls[0][0].paymentMethod.cardToken).toBeUndefined();
    });

    it("should charge in the skeleton's simulator without keys", () => {
      createPayments(SIMULATOR);

      expect(mockKitPagosConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: Gateway.RAPYD,
          environment: "simulator",
          baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/rapyd",
        }),
      );
    });

    it("should hand the checkout the order a card payment carries, and Rapyd's native status", async () => {
      mockValidateWebhook.mockReturnValue({
        eventType: "PAYMENT_COMPLETED",
        gatewayTransactionId: "payment_1",
        newStatus: "APPROVED",
        gateway: Gateway.RAPYD,
        rawStatus: "CLO",
        orderReference: "ORD-1",
      });

      const notification = await createPayments(RAPYD_KEYS).verifyWebhook("rapyd", {
        rawBody: "{}",
        headers: {},
        query: {},
      });

      expect(notification).toStrictEqual({
        transactionId: "payment_1",
        status: "APPROVED",
        nativeStatus: "CLO",
        orderReference: "ORD-1",
      });
      expect(mockGetPaymentStatus).not.toHaveBeenCalled();
    });

    it("should keep the order of a pending card payment after querying it", async () => {
      mockValidateWebhook.mockReturnValue({
        eventType: "PAYMENT_SUCCEEDED",
        gatewayTransactionId: "payment_1",
        newStatus: "PENDING",
        gateway: Gateway.RAPYD,
        rawStatus: "ACT",
        orderReference: "ORD-1",
      });
      mockGetPaymentStatus.mockResolvedValue(fakeTransaction("payment_1", "PENDING", "ACT"));

      const notification = await createPayments(RAPYD_KEYS).verifyWebhook("rapyd", {
        rawBody: "{}",
        headers: {},
        query: {},
      });

      expect(mockGetPaymentStatus).toHaveBeenCalledWith("payment_1");
      expect(notification).toStrictEqual({
        transactionId: "payment_1",
        status: "PENDING",
        nativeStatus: "ACT",
        orderReference: "ORD-1",
      });
    });

    it("should name its missing keys when no gateway can charge in the sandbox", () => {
      expect(() => createPayments({})).toThrow("Rapyd: RAPYD_API_ACCESS_KEY, RAPYD_API_SECRET_KEY");
    });
  });
});
