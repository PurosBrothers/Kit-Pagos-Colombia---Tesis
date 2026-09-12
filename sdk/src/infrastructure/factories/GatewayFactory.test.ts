import { GatewayFactory } from "./GatewayFactory";
import { Gateway } from "../../domain/value-objects/Gateway";
import { WompiAdapter } from "../adapters/WompiAdapter";
import { RapydAdapter } from "../adapters/RapydAdapter";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { MercadoPagoAdapter } from "../adapters/MercadoPagoAdapter";


describe("GatewayFactory", () => {
  let factory: GatewayFactory;

  beforeEach(() => {
    factory = new GatewayFactory();
  });

  describe("create()", () => {
    it("should return an instance of WompiAdapter when gateway is WOMPI", () => {
      const adapter = factory.create(Gateway.WOMPI);

      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(WompiAdapter);
      expect(typeof adapter.createPayment).toBe("function");
      expect(typeof adapter.getStatus).toBe("function");
      expect(typeof adapter.verifySignature).toBe("function");
    });

    it("should hand the resolved credentials and baseUrl over to the Adapter", async () => {
      const originalFetch = global.fetch;
      const customUrl = "http://localhost:4000/v1/sim/wompi/transactions";
      const credentials = {
        publicKey: "pub_test_wompi_123",
        privateKey: "prv_test_wompi_456",
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            id: "wompi-tx-1",
            status: "APPROVED",
            amount_in_cents: 100000,
            currency: "COP",
            reference: "ord-1",
            customer_email: "cliente@example.com",
          },
        }),
      });
      global.fetch = mockFetch;

      const adapter = factory.create(Gateway.WOMPI, credentials, customUrl);
      await adapter.createPayment({
        amount: new Amount("1000"),
        currency: new Currency("COP"),
        orderReference: new OrderReference("ord-1"),
        payer: new Payer({ email: "cliente@example.com" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        customUrl,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${credentials.publicKey}`,
          }),
        })
      );

      global.fetch = originalFetch;
    });
        it("should return an instance of MercadoPagoAdapter when gateway is MERCADOPAGO", () => {
      const adapter = factory.create(Gateway.MERCADOPAGO);

      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(MercadoPagoAdapter);
      expect(typeof adapter.createPayment).toBe("function");
      expect(typeof adapter.getStatus).toBe("function");
      expect(typeof adapter.verifySignature).toBe("function");
    });


    it("should build a RapydAdapter for RAPYD", () => {
      expect(factory.create(Gateway.RAPYD)).toBeInstanceOf(RapydAdapter);
    });

    it("should pass credentials and baseUrl through to the RapydAdapter", async () => {
      // La Factory decide QUE clase instanciar, no de donde sale la
      // configuracion: se verifica que lo recibido llegue al adaptador
      // observando la peticion que este produce.
      const credentials = {
        publicKey: "rapyd_access_key",
        privateKey: "rapyd_secret_key",
      };
      const originalFetch = global.fetch;
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          status: { status: "SUCCESS" },
          data: {
            id: "payment_abc",
            status: "CLO",
            paid: true,
            amount: "1000.00",
            currency_code: "COP",
            merchant_reference_id: "ord-1",
            receipt_email: "cliente@example.com",
          },
        }),
      });
      global.fetch = mockFetch;

      const adapter = factory.create(
        Gateway.RAPYD,
        credentials,
        "https://sandboxapi.rapyd.net/v1/payments"
      );

      await adapter.createPayment({
        amount: new Amount("1000"),
        currency: new Currency("COP"),
        orderReference: new OrderReference("ord-1"),
        payer: new Payer({ email: "cliente@example.com" }),
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://sandboxapi.rapyd.net/v1/payments");
      // Rapyd no usa Bearer: identifica al comercio con el header access_key y
      // una firma por peticion.
      expect(init.headers.access_key).toBe(credentials.publicKey);
      expect(init.headers.signature).toBeDefined();

      global.fetch = originalFetch;
    });

    it("should throw KitPagosError(UNSUPPORTED_OPERATION) for KUSHKI", () => {
      expect(() => factory.create(Gateway.KUSHKI)).toThrow(KitPagosError);

      try {
        factory.create(Gateway.KUSHKI);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.KUSHKI);
        expect(sdkError.originalPayload).toBeNull();
        expect(sdkError.message).toContain("Gateway not supported in this iteration: KUSHKI");
      }
    });

    it("should throw KitPagosError(UNSUPPORTED_OPERATION) for unknown gateways (default)", () => {
      const unknownGateway = "UNKNOWN_GATEWAY" as Gateway;

      expect(() => factory.create(unknownGateway)).toThrow(KitPagosError);

      try {
        factory.create(unknownGateway);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(unknownGateway);
        expect(sdkError.message).toContain("Gateway not supported in this iteration: UNKNOWN_GATEWAY");
      }
    });
  });
});
