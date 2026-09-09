import { ResponseNormalizer } from "./ResponseNormalizer";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

describe("ResponseNormalizer", () => {
  let normalizer: ResponseNormalizer;

  beforeEach(() => {
    normalizer = new ResponseNormalizer();
  });

  describe("normalize() with Wompi", () => {
    it("should normalize an approved Wompi response matching simulator contract", () => {
      const wompiRawResponse = {
        data: {
          id: "wompi-sim-12345",
          status: "APPROVED",
          amount_in_cents: 5000000,
          currency: "COP",
          reference: "ORDER-123",
          customer_email: "cliente@example.com",
          authorization_code: "AUTH-999",
        },
      };

      const transaction = normalizer.normalize(wompiRawResponse, Gateway.WOMPI);

      expect(transaction).toBeDefined();
      expect(transaction.isApproved()).toBe(true);
      expect(transaction.isPending()).toBe(false);
      expect(transaction.isFinal()).toBe(true);
      expect(transaction.getStatus()).toBe("APPROVED");
      expect(transaction.rawStatus).toBe("APPROVED");
      expect(transaction.gatewayTransactionId.value).toBe("wompi-sim-12345");
      expect(transaction.gatewayTransactionId.gateway).toBe(Gateway.WOMPI);
      expect(transaction.amount.getValue()).toBe("50000.00");
      expect(transaction.amount.toMinorUnits(transaction.currency)).toBe("5000000");
      expect(transaction.currency.getCode()).toBe("COP");
      expect(transaction.orderReference.getValue()).toBe("ORDER-123");
      expect(transaction.payer.email).toBe("cliente@example.com");
      expect(transaction.authorizationCode).toBe("AUTH-999");
    });

    it("should parse payload when passed as a valid JSON string", () => {
      const wompiJsonString = JSON.stringify({
        data: {
          id: "wompi-sim-str-1",
          status: "APPROVED",
          amount_in_cents: 2500000,
          currency: "COP",
          reference: "REF-STR",
        },
      });

      const transaction = normalizer.normalize(wompiJsonString, Gateway.WOMPI);
      expect(transaction.gatewayTransactionId.value).toBe("wompi-sim-str-1");
      expect(transaction.amount.getValue()).toBe("25000.00");
    });

    it("conserva el cero a la derecha al reconstruir el monto desde centavos", () => {
      // La implementación anterior dividía entre 100, y 1990 / 100 da 19.9: el
      // comercio cobraba 19.90 y recibía de vuelta un monto escrito distinto.
      // Ahora el punto decimal se inserta sobre los dígitos.
      const payload = {
        data: {
          id: "tx-trailing-zero",
          status: "APPROVED",
          amount_in_cents: 1990,
          currency: "COP",
          reference: "REF-TZ",
        },
      };

      const transaction = normalizer.normalize(payload, Gateway.WOMPI);
      expect(transaction.amount.getValue()).toBe("19.90");
      expect(transaction.amount.toMinorUnits(transaction.currency)).toBe("1990");
    });

    it("lanza KitPagosError(MALFORMED_RESPONSE) si el monto no es un entero de centavos", () => {
      // Un monto ilegible es una respuesta malformada, y debe llegar como error
      // tipado igual que un JSON roto, no como el Error nativo del objeto de valor.
      const payload = {
        data: {
          id: "tx-bad-amount",
          status: "APPROVED",
          amount_in_cents: "no-es-un-numero",
          currency: "COP",
          reference: "REF-BAD",
        },
      };

      expect(() => normalizer.normalize(payload, Gateway.WOMPI)).toThrow(KitPagosError);

      try {
        normalizer.normalize(payload, Gateway.WOMPI);
      } catch (error) {
        expect((error as KitPagosError).code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
      }
    });

    it("should map different Wompi transaction statuses properly", () => {
      const statuses = [
        { raw: "DECLINED", expected: "DECLINED" },
        { raw: "PENDING", expected: "PENDING" },
        { raw: "VOIDED", expected: "VOIDED" },
        { raw: "ERROR", expected: "ERROR" },
        { raw: "UNKNOWN_CUSTOM_STATUS", expected: "ERROR" },
      ];

      for (const { raw, expected } of statuses) {
        const payload = {
          data: {
            id: `tx-${raw}`,
            status: raw,
            amount_in_cents: 100000,
            currency: "COP",
            reference: `ref-${raw}`,
          },
        };

        const transaction = normalizer.normalize(payload, Gateway.WOMPI);
        expect(transaction.getStatus()).toBe(expected);
        expect(transaction.rawStatus).toBe(raw);
      }
    });

    it("should throw KitPagosError(MALFORMED_RESPONSE) when JSON parsing fails", () => {
      const invalidJson = "{ invalid json ";

      expect(() => normalizer.normalize(invalidJson, Gateway.WOMPI)).toThrow(KitPagosError);

      try {
        normalizer.normalize(invalidJson, Gateway.WOMPI);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
        expect(sdkError.message).toContain("Failed to parse JSON response");
      }
    });

    it("should throw KitPagosError(MALFORMED_RESPONSE) when data or data.id is missing", () => {
      const missingData = {};
      const missingId = { data: { status: "APPROVED" } };

      expect(() => normalizer.normalize(missingData, Gateway.WOMPI)).toThrow(KitPagosError);
      expect(() => normalizer.normalize(missingId, Gateway.WOMPI)).toThrow(KitPagosError);

      try {
        normalizer.normalize(missingId, Gateway.WOMPI);
      } catch (error) {
        expect(error).toBeInstanceOf(KitPagosError);
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
        expect(sdkError.gateway).toBe(Gateway.WOMPI);
        expect(sdkError.message).toContain("missing data.id");
      }
    });
  });

  describe("normalize() with other gateways (open for Iteration 2)", () => {
    it("should throw KitPagosError(UNSUPPORTED_OPERATION) for RAPYD", () => {
      expect(() => normalizer.normalize({}, Gateway.RAPYD)).toThrow(KitPagosError);
      try {
        normalizer.normalize({}, Gateway.RAPYD);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.RAPYD);
        expect(sdkError.message).toContain("Gateway not supported for response normalization: RAPYD");
      }
    });

    it("should throw KitPagosError(UNSUPPORTED_OPERATION) for MERCADOPAGO", () => {
      expect(() => normalizer.normalize({}, Gateway.MERCADOPAGO)).toThrow(KitPagosError);
      try {
        normalizer.normalize({}, Gateway.MERCADOPAGO);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.MERCADOPAGO);
      }
    });

    it("should throw KitPagosError(UNSUPPORTED_OPERATION) for KUSHKI", () => {
      expect(() => normalizer.normalize({}, Gateway.KUSHKI)).toThrow(KitPagosError);
      try {
        normalizer.normalize({}, Gateway.KUSHKI);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(Gateway.KUSHKI);
      }
    });

    it("should throw KitPagosError(UNSUPPORTED_OPERATION) for unknown gateway (default)", () => {
      const unknown = "UNKNOWN_GATEWAY" as Gateway;
      expect(() => normalizer.normalize({}, unknown)).toThrow(KitPagosError);
      try {
        normalizer.normalize({}, unknown);
      } catch (error) {
        const sdkError = error as KitPagosError;
        expect(sdkError.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
        expect(sdkError.gateway).toBe(unknown);
      }
    });
  });
});
