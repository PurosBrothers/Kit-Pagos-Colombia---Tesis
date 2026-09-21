import { GatewayTransactionId } from "../../../src/domain/value-objects/GatewayTransactionId";
import { Gateway } from "../../../src/domain/value-objects/Gateway";

describe("GatewayTransactionId", () => {
  describe("construction", () => {
    it("combines and exposes value and gateway", () => {
      const id = new GatewayTransactionId("wompi_txn_123", Gateway.WOMPI);
      expect(id.value).toBe("wompi_txn_123");
      expect(id.gateway).toBe(Gateway.WOMPI);
    });
  });

  describe("equals()", () => {
    it("is true when value and gateway match", () => {
      const a = new GatewayTransactionId("txn_1", Gateway.WOMPI);
      const b = new GatewayTransactionId("txn_1", Gateway.WOMPI);
      expect(a.equals(b)).toBe(true);
    });

    it("is false when value differs", () => {
      const a = new GatewayTransactionId("txn_1", Gateway.WOMPI);
      const b = new GatewayTransactionId("txn_2", Gateway.WOMPI);
      expect(a.equals(b)).toBe(false);
    });

    it("is false when gateway differs, even if value matches", () => {
      const a = new GatewayTransactionId("txn_1", Gateway.WOMPI);
      const b = new GatewayTransactionId("txn_1", Gateway.RAPYD);
      expect(a.equals(b)).toBe(false);
    });
  });
});