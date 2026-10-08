import { Transaction } from "./Transaction";
import { Amount } from "../value-objects/Amount";
import { Currency } from "../value-objects/Currency";
import { OrderReference } from "../value-objects/OrderReference";
import { Payer } from "../value-objects/Payer";
import { Gateway } from "../value-objects/Gateway";
import { GatewayTransactionId } from "../value-objects/GatewayTransactionId";
import { RejectionReason } from "../value-objects/RejectionReason";
import { TransactionStatus } from "../value-objects/TransactionStatus";

/** Fabrica una Transaction valida, permitiendo sobreescribir status y campos opcionales. */
function buildTransaction(
  status: TransactionStatus,
  rawStatus: string,
  extra?: { rejectionReason?: RejectionReason; authorizationCode?: string },
): Transaction {
  return new Transaction(
    new GatewayTransactionId("tx-123", Gateway.WOMPI),
    new OrderReference("order-123"),
    new Amount("100.5"),
    new Currency("COP"),
    new Payer({ email: "cliente@example.com" }),
    status,
    rawStatus,
    extra?.rejectionReason,
    extra?.authorizationCode,
  );
}

describe("Transaction", () => {
  describe("isApproved()", () => {
    it("is true only for APPROVED", () => {
      expect(buildTransaction("APPROVED", "APPROVED").isApproved()).toBe(true);
    });

    it.each<TransactionStatus>(["DECLINED", "PENDING", "EXPIRED", "VOIDED", "ERROR"])(
      "is false for %s",
      (status) => {
        expect(buildTransaction(status, status).isApproved()).toBe(false);
      },
    );
  });

  describe("isPending()", () => {
    it("is true only for PENDING", () => {
      expect(buildTransaction("PENDING", "PENDING").isPending()).toBe(true);
    });

    it.each<TransactionStatus>(["APPROVED", "DECLINED", "EXPIRED", "VOIDED", "ERROR"])(
      "is false for %s",
      (status) => {
        expect(buildTransaction(status, status).isPending()).toBe(false);
      },
    );
  });

  describe("isFinal()", () => {
    it("is false only for PENDING", () => {
      expect(buildTransaction("PENDING", "PENDING").isFinal()).toBe(false);
    });

    it.each<TransactionStatus>(["APPROVED", "DECLINED", "EXPIRED", "VOIDED", "ERROR"])(
      "is true for %s, because no further change is expected",
      (status) => {
        expect(buildTransaction(status, status).isFinal()).toBe(true);
      },
    );
  });

  describe("getStatus()", () => {
    it.each<TransactionStatus>([
      "APPROVED",
      "DECLINED",
      "PENDING",
      "EXPIRED",
      "VOIDED",
      "ERROR",
    ])("returns the same status it was built with (%s)", (status) => {
      expect(buildTransaction(status, status).getStatus()).toBe(status);
    });
  });

  describe("rawStatus", () => {
    it("keeps the gateway's native value without normalizing it", () => {
      const transaction = buildTransaction("APPROVED", "4");
      expect(transaction.rawStatus).toBe("4");
    });
  });

  describe("optional fields", () => {
    it("rejectionReason and authorizationCode stay undefined if not passed", () => {
      const transaction = buildTransaction("APPROVED", "APPROVED");
      expect(transaction.rejectionReason).toBeUndefined();
      expect(transaction.authorizationCode).toBeUndefined();
    });

    it("keeps rejectionReason when the status is DECLINED", () => {
      const rejectionReason = new RejectionReason("51", "INSUFFICIENT_FUNDS");
      const transaction = buildTransaction("DECLINED", "DECLINED", { rejectionReason });
      expect(transaction.rejectionReason).toBe(rejectionReason);
    });

    it("keeps authorizationCode when the gateway returns it", () => {
      const transaction = buildTransaction("APPROVED", "APPROVED", {
        authorizationCode: "AUTH-000123",
      });
      expect(transaction.authorizationCode).toBe("AUTH-000123");
    });
  });

  describe("collaborating value objects", () => {
    it("exposes gatewayTransactionId, orderReference, amount, currency and payer as they were built", () => {
      const gatewayTransactionId = new GatewayTransactionId("tx-999", Gateway.KUSHKI);
      const orderReference = new OrderReference("order-999");
      const amount = new Amount("250");
      const currency = new Currency("USD");
      const payer = new Payer({ email: "otro@example.com" });

      const transaction = new Transaction(
        gatewayTransactionId,
        orderReference,
        amount,
        currency,
        payer,
        "APPROVED",
        "APPROVED",
      );

      expect(transaction.gatewayTransactionId).toBe(gatewayTransactionId);
      expect(transaction.orderReference).toBe(orderReference);
      expect(transaction.amount).toBe(amount);
      expect(transaction.currency).toBe(currency);
      expect(transaction.payer).toBe(payer);
    });
  });
});
