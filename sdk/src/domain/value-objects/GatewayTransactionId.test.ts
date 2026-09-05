import { GatewayTransactionId } from "../../../src/domain/value-objects/GatewayTransactionId";
import { Gateway } from "../../../src/domain/value-objects/Gateway";

describe("GatewayTransactionId", () => {
  describe("construcción", () => {
    it("combina y expone el value y el gateway", () => {
      const id = new GatewayTransactionId("wompi_txn_123", Gateway.WOMPI);
      expect(id.value).toBe("wompi_txn_123");
      expect(id.gateway).toBe(Gateway.WOMPI);
    });
  });

  describe("equals()", () => {
    it("es true cuando value y gateway coinciden", () => {
      const a = new GatewayTransactionId("txn_1", Gateway.WOMPI);
      const b = new GatewayTransactionId("txn_1", Gateway.WOMPI);
      expect(a.equals(b)).toBe(true);
    });

    it("es false cuando el value difiere", () => {
      const a = new GatewayTransactionId("txn_1", Gateway.WOMPI);
      const b = new GatewayTransactionId("txn_2", Gateway.WOMPI);
      expect(a.equals(b)).toBe(false);
    });

    it("es false cuando el gateway difiere, aunque el value sea igual", () => {
      const a = new GatewayTransactionId("txn_1", Gateway.WOMPI);
      const b = new GatewayTransactionId("txn_1", Gateway.RAPYD);
      expect(a.equals(b)).toBe(false);
    });
  });
});