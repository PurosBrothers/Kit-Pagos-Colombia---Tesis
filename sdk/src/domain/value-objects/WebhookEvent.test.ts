import { WebhookEvent } from "../../../src/domain/value-objects/WebhookEvent";
import { Gateway } from "../../../src/domain/value-objects/Gateway";
import { TransactionStatus } from "../../../src/domain/value-objects/TransactionStatus";

describe("WebhookEvent", () => {
  it("preserves the four fields without transforming them", () => {
    const event = new WebhookEvent({
      eventType: "payment.updated",
      gatewayTransactionId: "wompi_txn_123",
      newStatus: "APPROVED" as TransactionStatus,
      gateway: Gateway.WOMPI,
    });

    expect(event.eventType).toBe("payment.updated");
    expect(event.gatewayTransactionId).toBe("wompi_txn_123");
    expect(event.newStatus).toBe("APPROVED");
    expect(event.gateway).toBe(Gateway.WOMPI);
    expect(event.rawStatus).toBeUndefined();
    expect(event.orderReference).toBeUndefined();
  });

  it("preserves the raw status and the order reference when the gateway signed them", () => {
    const event = new WebhookEvent({
      eventType: "PAYMENT_COMPLETED",
      gatewayTransactionId: "payment_1",
      newStatus: "APPROVED" as TransactionStatus,
      gateway: Gateway.RAPYD,
      rawStatus: "CLO",
      orderReference: "ORD-1",
    });

    expect(event.rawStatus).toBe("CLO");
    expect(event.orderReference).toBe("ORD-1");
  });
});
