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
    new Amount(100.5),
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
    it("es true unicamente para APPROVED", () => {
      expect(buildTransaction("APPROVED", "APPROVED").isApproved()).toBe(true);
    });

    it.each<TransactionStatus>(["DECLINED", "PENDING", "EXPIRED", "VOIDED", "ERROR"])(
      "es false para %s",
      (status) => {
        expect(buildTransaction(status, status).isApproved()).toBe(false);
      },
    );
  });

  describe("isPending()", () => {
    it("es true unicamente para PENDING", () => {
      expect(buildTransaction("PENDING", "PENDING").isPending()).toBe(true);
    });

    it.each<TransactionStatus>(["APPROVED", "DECLINED", "EXPIRED", "VOIDED", "ERROR"])(
      "es false para %s",
      (status) => {
        expect(buildTransaction(status, status).isPending()).toBe(false);
      },
    );
  });

  describe("isFinal()", () => {
    it("es false unicamente para PENDING", () => {
      expect(buildTransaction("PENDING", "PENDING").isFinal()).toBe(false);
    });

    it.each<TransactionStatus>(["APPROVED", "DECLINED", "EXPIRED", "VOIDED", "ERROR"])(
      "es true para %s, porque ya no se espera ningun cambio adicional",
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
    ])("devuelve el mismo estado con el que se construyo (%s)", (status) => {
      expect(buildTransaction(status, status).getStatus()).toBe(status);
    });
  });

  describe("rawStatus", () => {
    it("conserva el valor nativo de la pasarela sin normalizar", () => {
      const transaction = buildTransaction("APPROVED", "4");
      expect(transaction.rawStatus).toBe("4");
    });
  });

  describe("campos opcionales", () => {
    it("rejectionReason y authorizationCode quedan undefined si no se pasan", () => {
      const transaction = buildTransaction("APPROVED", "APPROVED");
      expect(transaction.rejectionReason).toBeUndefined();
      expect(transaction.authorizationCode).toBeUndefined();
    });

    it("conserva rejectionReason cuando el estado es DECLINED", () => {
      const rejectionReason = new RejectionReason("51", "INSUFFICIENT_FUNDS");
      const transaction = buildTransaction("DECLINED", "DECLINED", { rejectionReason });
      expect(transaction.rejectionReason).toBe(rejectionReason);
    });

    it("conserva authorizationCode cuando la pasarela lo devuelve", () => {
      const transaction = buildTransaction("APPROVED", "APPROVED", {
        authorizationCode: "AUTH-000123",
      });
      expect(transaction.authorizationCode).toBe("AUTH-000123");
    });
  });

  describe("objetos de valor colaboradores", () => {
    it("expone gatewayTransactionId, orderReference, amount, currency y payer tal como se construyeron", () => {
      const gatewayTransactionId = new GatewayTransactionId("tx-999", Gateway.KUSHKI);
      const orderReference = new OrderReference("order-999");
      const amount = new Amount(250);
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
