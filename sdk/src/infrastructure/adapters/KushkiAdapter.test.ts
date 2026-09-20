import { KushkiAdapter } from "./KushkiAdapter";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { Gateway } from "../../domain/value-objects/Gateway";
import {
  expectRedirect,
  expectTransaction,
} from "../../test-support/payment-result";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Credentials } from "../../domain/value-objects/Credentials";
import { KitPagosError } from "../../domain/errors/KitPagosError";

describe("KushkiAdapter", () => {
  const originalFetch = global.fetch;

  const validRequest: CreatePaymentRequest = {
    amount: new Amount("50000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-12345"),
    payer: new Payer({ email: "cliente@example.com" }),
    // Antes el adaptador mandaba el literal "simulated-token", que contra Kushki real
    // responde `400 K001`. Ver el punto 50 del architecture-log.
    paymentMethod: PaymentMethod.card("kushki-card-token-abc"),
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("createPayment()", () => {
    it("should successfully create an approved payment", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();
      const transaction = expectTransaction(
        await adapter.createPayment(validRequest),
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/kushki/card/v1/charges",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: "kushki-card-token-abc",
            trackingCode: "ord-12345",
            amount: {
              subtotalIva0: 50000,
              subtotalIva: 0,
              iva: 0,
              ice: 0,
              currency: "COP",
            },
            contactDetails: {
              email: "cliente@example.com",
            },
            // Sin `fullResponse` la respuesta real es `{ticketNumber, transactionReference}`
            // y no alcanza para construir una Transaction: falta el estado y el monto.
            fullResponse: true,
          }),
        },
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe(
        "kushki-mock-tx-123",
      );
      expect(transaction.gatewayTransactionId.gateway).toBe(
        Gateway.KUSHKI,
      );
      expect(transaction.amount.getValue()).toBe("50000");
      expect(transaction.currency.getCode()).toBe("COP");
    });

    it("should normalize a declined transaction even when HTTP status is successful", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        // El rechazo de negocio llega como HTTP 200; el Adapter debe leer
        // transaction_status y no asumir una aprobación porque response.ok.
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-declined-tx-123",
          transaction_status: "DECLINED",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();
      const transaction = expectTransaction(
        await adapter.createPayment(validRequest),
      );

      expect(transaction.isApproved()).toBe(false);
      expect(transaction.getStatus()).toBe("DECLINED");
      expect(transaction.gatewayTransactionId.value).toBe(
        "kushki-declined-tx-123",
      );
      expect(transaction.gatewayTransactionId.gateway).toBe(
        Gateway.KUSHKI,
      );
    });

    it("should normalize INITIALIZED as PENDING", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-pending-tx-123",
          transaction_status: "INITIALIZED",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();
      const transaction = expectTransaction(
        await adapter.createPayment(validRequest),
      );

      expect(transaction.getStatus()).toBe("PENDING");
      expect(transaction.isPending()).toBe(true);
      expect(transaction.isApproved()).toBe(false);
    });

    it("should send the full Kushki amount breakdown", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();

      await adapter.createPayment({
        ...validRequest,
        amount: new Amount("50000.00"),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.amount).toEqual({
        subtotalIva0: 50000,
        subtotalIva: 0,
        iva: 0,
        ice: 0,
        currency: "COP",
      });
    });

    it("should use the provided tax breakdown", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 0,
            subtotalIva: 42000,
            iva: 8000,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const { TaxBreakdown } = await import(
        "../../domain/value-objects/TaxBreakdown"
      );

      const adapter = new KushkiAdapter();

      await adapter.createPayment({
        ...validRequest,
        amount: new Amount("50000"),
        taxBreakdown: TaxBreakdown.fromComponents({
          subtotalIva0: new Amount("0"),
          subtotalIva: new Amount("42000"),
          iva: new Amount("8000"),
          currency: new Currency("COP"),
        }),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.amount).toEqual({
        subtotalIva0: 0,
        subtotalIva: 42000,
        iva: 8000,
        ice: 0,
        currency: "COP",
      });
    });

    it("should use the private merchant id when credentials are provided", async () => {
      const credentials = {
        publicKey: "pub_test_kushki",
        privateKey: "prv_test_kushki",
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 50000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "ord-12345",
        }),
      });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter(undefined, credentials);

      await adapter.createPayment(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/sim/kushki/card/v1/charges",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            "Private-Merchant-Id": "prv_test_kushki",
          },
        }),
      );
    });

    it("should throw when the tax breakdown does not match the payment amount", async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const { TaxBreakdown } = await import(
        "../../domain/value-objects/TaxBreakdown"
      );

      const adapter = new KushkiAdapter();

      await expect(
        adapter.createPayment({
          ...validRequest,
          taxBreakdown: TaxBreakdown.fromComponents({
            subtotalIva0: new Amount("10000"),
            subtotalIva: new Amount("0"),
            iva: new Amount("0"),
            currency: new Currency("COP"),
          }),
        }),
      ).rejects.toThrow();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    /*
     * Regresión: el adaptador no enviaba la referencia del comercio, y el
     * normalizador tomaba el `transactionReference` que genera Kushki como si lo
     * fuera. El comercio recibía de vuelta un identificador que nunca envió.
     * Este caso devuelve a propósito un `transactionReference` distinto de la
     * referencia de la orden, que es lo que hace la pasarela real.
     */
    it("should keep the merchant order reference instead of the Kushki one", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ticketNumber: "kushki-mock-tx-123",
          transaction_status: "APPROVAL",
          amount: {
            subtotalIva0: 150000,
            subtotalIva: 0,
            iva: 0,
            ice: 0,
            currency: "COP",
          },
          transactionReference: "kushki-generated-2f9c41",
          trackingCode: "ord-12345",
          contactDetails: { email: "cliente@example.com" },
        }),
      });

      global.fetch = mockFetch;

      const transaction = expectTransaction(
        await new KushkiAdapter().createPayment(validRequest),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.trackingCode).toBe("ord-12345");

      expect(transaction.orderReference.getValue()).toBe("ord-12345");
      expect(transaction.payer.email).toBe("cliente@example.com");
    });

    it("should return redirectRequired when card transaction requires 3DS/OTP challenge", async () => {
      const response3ds = {
        ticketNumber: "1234567890",
        status: "PENDING",
        redirectUrl: "https://sandbox-otp.kushkipagos.com/challenge?token=abc123xyz",
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => response3ds,
      });

      const adapter = new KushkiAdapter();
      const result = await adapter.createPayment(validRequest);
      expect(result.outcome).toBe("REDIRECT_REQUIRED");
      if (result.outcome === "REDIRECT_REQUIRED") {
        expect(result.redirect.redirectUrl).toBe(
          "https://sandbox-otp.kushkipagos.com/challenge?token=abc123xyz",
        );
        expect(result.redirect.gatewayTransactionId.value).toBe("1234567890");
        expect(result.redirect.gatewayTransactionId.gateway).toBe(Gateway.KUSHKI);
      }
    });
  });

  describe("getStatus()", () => {
    /**
     * Consultar un ticket de tarjeta cuesta dos llamadas desde que la ruta de
     * transferencia va primero: es lo que hay que pagar para que la de transferencia
     * pueda encadenar, porque `/charges/{id}` no sabe decir que no conoce un id. El
     * primer paso responde el `400 T001` de la API real.
     */
    it("should return a normalized transaction", async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ code: "T001", message: "Cuerpo de la peticion invalido." }),
        })
        // La consulta del flujo asíncrono de tarjeta: existe, y contesta que no tiene
        // registrado un cobro síncrono. Es el `CAS004` medido contra la UAT.
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ code: "CAS004", message: "No existe la transaccion" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ticketNumber: "kushki-mock-tx-123",
            transaction_status: "APPROVAL",
            amount: {
              subtotalIva0: 50000,
              subtotalIva: 0,
              iva: 0,
              ice: 0,
              currency: "COP",
            },
            transactionReference: "ord-12345",
          }),
        });

      global.fetch = mockFetch;

      const adapter = new KushkiAdapter();

      const transaction = await adapter.getStatus(
        "kushki-mock-tx-123",
      );

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "http://localhost:3000/v1/sim/kushki/transfer/v1/status/kushki-mock-tx-123",
        expect.objectContaining({ method: "GET" }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "http://localhost:3000/v1/sim/kushki/card-async/v1/status/kushki-mock-tx-123",
        expect.objectContaining({ method: "GET" }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        "http://localhost:3000/v1/sim/kushki/charges/kushki-mock-tx-123",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      expect(transaction.isApproved()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe(
        "kushki-mock-tx-123",
      );
      expect(transaction.gatewayTransactionId.gateway).toBe(
        Gateway.KUSHKI,
      );
    });
  });
});

/**
 * PSE en Kushki, que Kushki llama Transfer In.
 *
 * **Las formas de respuesta estan medidas contra la API UAT** el 18 de septiembre de
 * 2026, ejecutando el flujo completo con las credenciales de API del comercio de
 * prueba. Antes venian de la referencia, y medirlas encontro cuatro defectos que
 * estas pruebas no podian ver porque el mock reproducia lo que el codigo esperaba: el
 * punto 48 del architecture-log los detalla. Lo unico que sigue sin medir es el
 * desenlace, que exige autorizar en el portal del banco simulado.
 */
describe("KushkiAdapter con PSE", () => {
  const originalFetch = global.fetch;

  const credentials: Credentials = {
    publicKey: "public-merchant-id",
    privateKey: "private-merchant-id",
  };

  const pseRequest: CreatePaymentRequest = {
    amount: new Amount("150000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-kushki-pse-1"),
    payer: new Payer({
      email: "cliente@example.com",
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: "007" }),
    returnUrlConfig: new ReturnUrlConfig("https://comercio.example.com/retorno"),
  };

  const tokenResponse = {
    ok: true,
    status: 201,
    json: async () => ({ token: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4" }),
  };

  const initResponse = {
    ok: true,
    status: 200,
    json: async () => ({
      redirectUrl: "https://sandbox-pse.kushkipagos.com/authorize?token=a1b2c3d4",
      status: "INITIALIZED",
    }),
  };

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("pide el token y despues inicia la transferencia, en ese orden", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(initResponse);
    global.fetch = mockFetch;

    await new KushkiAdapter("https://api.example.com").createPayment(pseRequest);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.example.com/transfer/v1/tokens",
    );
    expect(mockFetch.mock.calls[1][0]).toBe(
      "https://api.example.com/transfer/v1/init",
    );
  });

  /**
   * Cada ruta de Kushki pide una credencial distinta, y no son intercambiables:
   * mandar la privada donde va la publica funciona pero expone la credencial de
   * cobro. El adaptador elige explicitamente en cada llamada.
   */
  it("usa la credencial publica para el token y la privada para el inicio", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(initResponse);
    global.fetch = mockFetch;

    await new KushkiAdapter("https://api.example.com", credentials).createPayment(
      pseRequest,
    );

    expect(mockFetch.mock.calls[0][1].headers["Public-Merchant-Id"]).toBe(
      "public-merchant-id",
    );
    expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty(
      "Private-Merchant-Id",
    );
    expect(mockFetch.mock.calls[1][1].headers["Private-Merchant-Id"]).toBe(
      "private-merchant-id",
    );
  });

  /**
   * Es el unico caso de las cuatro pasarelas donde la URL de retorno del comercio
   * viaja en un paso previo al cobro. Cierra la pieza 3 del issue #64 para Kushki.
   */
  it("manda la URL de retorno del comercio al pedir el token", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(initResponse);
    global.fetch = mockFetch;

    await new KushkiAdapter("https://api.example.com").createPayment(pseRequest);

    const tokenBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(tokenBody.callbackUrl).toBe("https://comercio.example.com/retorno");
    expect(tokenBody.bankId).toBe("007");
  });

  it("usa el token como identificador de la transaccion", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(initResponse);
    global.fetch = mockFetch;

    const result = await new KushkiAdapter("https://api.example.com").createPayment(
      pseRequest,
    );

    const redirect = expectRedirect(result);
    expect(redirect.gatewayTransactionId.value).toBe(
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    );
    expect(redirect.redirectUrl).toContain("authorize");

    const initBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(initBody.token).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
    // Kushki exige el monto tambien en el inicio: con solo el token responde 400.
    expect(initBody.amount).toEqual({
      subtotalIva0: 150000,
      subtotalIva: 0,
      iva: 0,
      ice: 0,
      currency: "COP",
    });
  });

  /**
   * Kushki no publica como distinguir un token de transferencia de un ticket de
   * tarjeta, asi que el adaptador pregunta en vez de adivinar. La de transferencia va
   * primero porque es la unica que sabe contestar que no conoce un identificador:
   * medido contra la API UAT, `/charges/{id}` responde 403 para cualquiera.
   */
  describe("getStatus() con dos rutas posibles", () => {
    /** La forma de la respuesta es la medida: `token` y `status`, sin `ticketNumber`. */
    it("consulta transferencia primero y no gasta la segunda llamada si responde", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          token: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
          status: "approvedTransaction",
          paymentDescription: "ORDER-PSE-1",
          email: "comprador@example.com",
          amount: { subtotalIva0: 150000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
        }),
      });
      global.fetch = mockFetch;

      const transaction = await new KushkiAdapter("https://api.example.com").getStatus(
        "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://api.example.com/transfer/v1/status/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      );
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.orderReference.getValue()).toBe("ORDER-PSE-1");
    });

    /**
     * El `400 T001` es lo que la API real contesta cuando el identificador no es de
     * esa ruta, y significa lo mismo que el 404 del simulador: por aca no es.
     */
    it("pasa a la ruta de tarjeta cuando transferencia responde 400, como la API real", async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ code: "T001", message: "Cuerpo de la peticion invalido." }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ code: "CAS004", message: "No existe la transaccion" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ticketNumber: "123456789012345678",
            transaction_status: "APPROVAL",
            amount: { subtotalIva0: 150000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
          }),
        });
      global.fetch = mockFetch;

      const transaction = await new KushkiAdapter("https://api.example.com").getStatus(
        "123456789012345678",
      );

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[1][0]).toBe(
        "https://api.example.com/card-async/v1/status/123456789012345678",
      );
      expect(mockFetch.mock.calls[2][0]).toBe(
        "https://api.example.com/charges/123456789012345678",
      );
      expect(transaction.getStatus()).toBe("APPROVED");
    });

    /*
     * La consulta del flujo asíncrono de tarjeta existe —se midió `400 CAS004` con la llave
     * privada y `401` con la pública, el mismo patrón de la ruta de PSE que sí existe— y lo
     * que contesta es que el cobro síncrono no está en ese almacén. Se intenta igual porque
     * la certeza de que no está sale de preguntarle a Kushki en el momento, no de citar su
     * documentación; y si algún día registra los cobros síncronos ahí, esto ya funciona.
     */
    it("devuelve la transacción cuando la consulta asíncrona de tarjeta sí la conoce", async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ code: "T001", message: "Cuerpo de la peticion invalido." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ticketNumber: "441571084222882291",
            transaction_status: "APPROVAL",
            amount: { subtotalIva0: 150000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
          }),
        });
      global.fetch = mockFetch;

      const transaction = await new KushkiAdapter("https://api.example.com").getStatus(
        "441571084222882291",
      );

      // No llega a `/charges/{id}`: la resolvió la ruta asíncrona.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(
        "https://api.example.com/card-async/v1/status/441571084222882291",
      );
      expect(transaction.getStatus()).toBe("APPROVED");
    });

    /** El 404 del simulador tiene que seguir encadenando igual que el 400 real. */
    it("pasa a la ruta de tarjeta cuando transferencia responde 404, como el simulador", async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ code: "K004", message: "No encontrado" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ticketNumber: "123456789012345678",
            transaction_status: "APPROVAL",
            amount: { subtotalIva0: 150000, subtotalIva: 0, iva: 0, ice: 0, currency: "COP" },
          }),
        });
      global.fetch = mockFetch;

      await new KushkiAdapter("https://api.example.com").getStatus("123456789012345678");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    /**
     * Un 401 en la primera ruta no dice nada sobre la segunda. Seguir probando
     * convertiria un problema de credenciales en un "no encontrado", que manda a
     * buscar al lugar equivocado.
     */
    it("no prueba la segunda ruta si el fallo es de credenciales", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: "Unauthorized" }),
      });
      global.fetch = mockFetch;

      await expect(
        new KushkiAdapter("https://api.example.com").getStatus("cualquier-id"),
      ).rejects.toBeInstanceOf(KitPagosError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    /**
     * Defecto veinte del proyecto, medido el 19 de septiembre de 2026 con credenciales UAT
     * nuevas: consultar un cobro con tarjeta que Kushki acababa de aprobar devolvía
     * `INVALID_CREDENTIALS`, o sea que el SDK mandaba al comercio a rotar unas llaves que
     * estaban bien. El 403 no era de autorización sino de una ruta que no existe, y eso se
     * puede afirmar porque **a esta segunda ruta solo se llega si la primera contestó
     * `400 T001`**, que es la aplicación de Kushki hablando después del autorizador.
     */
    it("no culpa a las credenciales cuando la primera ruta ya probó que sirven", async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ code: "T001", message: "Cuerpo de la peticion invalido." }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({ message: "Forbidden" }),
        });
      global.fetch = mockFetch;

      try {
        await new KushkiAdapter("https://api.example.com").getStatus("ticket-de-tarjeta");
        fail("debía lanzar KitPagosError");
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
        // El mensaje tiene que decir las dos cosas: que no es de credenciales, y qué usar
        // en vez de la consulta, o el comercio queda sin saber cómo conciliar.
        expect(sdkError.message).toContain("validateWebhook()");
        expect(sdkError.message).toContain("no es un problema de tus credenciales");
      }

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    /**
     * La otra mitad del razonamiento, y la que evita que la corrección de arriba se coma un
     * problema real: si las llaves están mal, la **primera** ruta ya responde 403 y el
     * adaptador se rinde ahí, sin haber probado nada. Ese 403 sí es de credenciales y tiene
     * que seguir diciéndolo.
     */
    it("sigue culpando a las credenciales cuando ninguna ruta llegó a contestar", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: "Forbidden" }),
      });
      global.fetch = mockFetch;

      try {
        await new KushkiAdapter("https://api.example.com").getStatus("ticket-de-tarjeta");
        fail("debía lanzar KitPagosError");
      } catch (error) {
        expect((error as KitPagosError).code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
      }

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getPseBanks()", () => {
    it("pide la lista con la credencial publica", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { code: "007", name: "Davivienda" },
          { code: "001", name: "Bancolombia" },
        ],
      });
      global.fetch = mockFetch;

      const banks = await new KushkiAdapter(
        "https://api.example.com",
        credentials,
      ).getPseBanks();

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://api.example.com/transfer/v1/bankList",
      );
      expect(mockFetch.mock.calls[0][1].headers["Public-Merchant-Id"]).toBe(
        "public-merchant-id",
      );
      expect(banks).toHaveLength(2);
    });
  });
});
