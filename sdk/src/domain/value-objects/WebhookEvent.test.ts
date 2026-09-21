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
  });
});