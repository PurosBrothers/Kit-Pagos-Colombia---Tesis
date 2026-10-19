import { Transaction } from "../entities/Transaction";
import { Amount } from "./Amount";
import { Currency } from "./Currency";
import { Gateway } from "./Gateway";
import { GatewayTransactionId } from "./GatewayTransactionId";
import { OrderReference } from "./OrderReference";
import { Payer } from "./Payer";
import {
  PaymentResult,
  redirectRequired,
  transactionResult,
} from "./PaymentResult";

describe("PaymentResult", () => {
  const buildTransaction = () =>
    new Transaction(
      new GatewayTransactionId("tx-123", Gateway.WOMPI),
      new OrderReference("ord-1"),
      new Amount("50000.00"),
      new Currency("COP"),
      new Payer({ email: "cliente@example.com" }),
      "APPROVED",
      "APPROVED",
    );

  describe("transactionResult", () => {
    it("tags the result as TRANSACTION and keeps the transaction", () => {
      const transaction = buildTransaction();
      const result = transactionResult(transaction);

      expect(result.outcome).toBe("TRANSACTION");
      expect(result.transaction).toBe(transaction);
    });
  });

  describe("redirectRequired", () => {
    it("tags the result as REDIRECT_REQUIRED and keeps the redirect", () => {
      const gatewayTransactionId = new GatewayTransactionId(
        "payment_abc",
        Gateway.RAPYD,
      );
      const result = redirectRequired({
        redirectUrl: "https://sandbox.rapyd.net/3ds/payment_abc",
        gatewayTransactionId,
        rawStatus: "ACT",
      });

      expect(result.outcome).toBe("REDIRECT_REQUIRED");
      expect(result.redirect.redirectUrl).toBe(
        "https://sandbox.rapyd.net/3ds/payment_abc",
      );
      expect(result.redirect.gatewayTransactionId).toBe(gatewayTransactionId);
      expect(result.redirect.rawStatus).toBe("ACT");
    });

    it("rejects a redirect without a URL", () => {
      // Decirle al comercio que redirija sin decirle a dónde deja el pago
      // colgado igual que antes de este cambio, pero además en silencio.
      expect(() =>
        redirectRequired({
          redirectUrl: "",
          gatewayTransactionId: new GatewayTransactionId("x", Gateway.RAPYD),
          rawStatus: "ACT",
        }),
      ).toThrow("redirectRequired requiere redirectUrl no vacia");
    });
  });

  describe("tagged union guarantee", () => {
    it("forces the redirect to be ruled out before reaching the transaction", () => {
      // Esta prueba documenta el motivo de existir del tipo. Lo que realmente la
      // verifica es el compilador: si `PaymentResult` volviera a ser
      // `Transaction` con un `redirectUrl?` opcional, el acceso a
      // `result.transaction` de abajo compilaría sin el `if` previo, y este
      // archivo dejaría de proteger nada. Ver el encabezado de PaymentResult.ts.
      const results: PaymentResult[] = [
        transactionResult(buildTransaction()),
        redirectRequired({
          redirectUrl: "https://banco.example.com/pse/abc",
          gatewayTransactionId: new GatewayTransactionId("p-1", Gateway.RAPYD),
          rawStatus: "ACT",
        }),
      ];

      const descriptions = results.map((result) =>
        result.outcome === "REDIRECT_REQUIRED"
          ? `redirigir a ${result.redirect.redirectUrl}`
          : `estado ${result.transaction.getStatus()}`,
      );

      expect(descriptions).toEqual([
        "estado APPROVED",
        "redirigir a https://banco.example.com/pse/abc",
      ]);
    });
  });
});
