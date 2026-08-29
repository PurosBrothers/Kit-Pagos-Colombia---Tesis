import * as crypto from "crypto";
import { WebhookVerifier } from "./WebhookVerifier";
import { Gateway } from "../value-objects/Gateway";

describe("WebhookVerifier", () => {
  const verifier = new WebhookVerifier();

  describe("verify()", () => {
    describe("Wompi", () => {
      const secret = "test_events_secret_wompi";
      const timestamp = 1602113476;
      const transactionId = "1292-1602113476-10985";
      const status = "APPROVED";

      const checksum = crypto
        .createHash("sha256")
        .update(`${transactionId}${status}${timestamp}${secret}`)
        .digest("hex");

      const payload = JSON.stringify({
        event: "transaction.updated",
        data: {
          transaction: { id: transactionId, status },
        },
        timestamp,
        signature: {
          properties: ["data.transaction.id", "data.transaction.status"],
          checksum,
        },
      });

      it("valida una firma correcta", () => {
        const headers = { "x-event-checksum": checksum };
        expect(verifier.verify(payload, headers, secret, Gateway.WOMPI)).toBe(true);
      });

      it("rechaza si el payload fue alterado", () => {
        const tampered = payload.replace("APPROVED", "DECLINED");
        const headers = { "x-event-checksum": checksum };
        expect(verifier.verify(tampered, headers, secret, Gateway.WOMPI)).toBe(false);
      });

      it("rechaza si la firma es incorrecta", () => {
        const headers = { "x-event-checksum": "invalidsignature123" };
        expect(verifier.verify(payload, headers, secret, Gateway.WOMPI)).toBe(false);
      });
    });

    describe("PayU", () => {
      const apiKey = "4Vj8eK4rloUd272L48hsrarnUA";
      const merchantId = "508029";
      const referenceSale = "TestPayU001";
      const currency = "COP";
      const statePol = "4";

      const sign = crypto
        .createHash("md5")
        .update(`${apiKey}~${merchantId}~${referenceSale}~150.0~${currency}~${statePol}`)
        .digest("hex");

      const payload = new URLSearchParams({
        merchant_id: merchantId,
        reference_sale: referenceSale,
        value: "150.00",
        currency,
        state_pol: statePol,
        sign,
      }).toString();

      it("valida una firma correcta en el body", () => {
        expect(verifier.verify(payload, {}, apiKey, Gateway.PAYU)).toBe(true);
      });

      it("rechaza si la firma no coincide", () => {
        const tampered = payload.replace(sign, "invalidsign");
        expect(verifier.verify(tampered, {}, apiKey, Gateway.PAYU)).toBe(false);
      });
    });

    describe("Mercado Pago", () => {
      const secret = "mp_webhook_secret_test";
      const dataId = "12345678";
      const requestId = "req-uuid-001";
      const ts = "1702500000";

      const v1 = crypto
        .createHmac("sha256", secret)
        .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
        .digest("hex");

      const payload = JSON.stringify({
        action: "payment.updated",
        data: { id: dataId },
      });

      it("valida un header x-signature correcto", () => {
        const headers = {
          "x-signature": `ts=${ts},v1=${v1}`,
          "x-request-id": requestId,
        };
        expect(verifier.verify(payload, headers, secret, Gateway.MERCADOPAGO)).toBe(true);
      });

      it("rechaza si el secret es incorrecto", () => {
        const headers = {
          "x-signature": `ts=${ts},v1=${v1}`,
          "x-request-id": requestId,
        };
        expect(verifier.verify(payload, headers, "wrong_secret", Gateway.MERCADOPAGO)).toBe(false);
      });
    });

    describe("Kushki", () => {
      const secret = "kushki_signature_id";
      const kushkiId = "1702500000";

      const payload = JSON.stringify({
        transaction_status: "APPROVAL",
        transaction_id: "781482485839103928",
      });

      const signature = crypto
        .createHmac("sha256", secret)
        .update(`${payload}.${kushkiId}`)
        .digest("hex");

      it("valida una firma HMAC correcta", () => {
        const headers = {
          "x-kushki-signature": signature,
          "x-kushki-id": kushkiId,
        };
        expect(verifier.verify(payload, headers, secret, Gateway.KUSHKI)).toBe(true);
      });

      it("rechaza si el body fue alterado", () => {
        const tampered = payload.replace("APPROVAL", "DECLINED");
        const headers = {
          "x-kushki-signature": signature,
          "x-kushki-id": kushkiId,
        };
        expect(verifier.verify(tampered, headers, secret, Gateway.KUSHKI)).toBe(false);
      });
    });
  });

  describe("parse()", () => {
    it("normaliza eventos de Wompi", () => {
      const payload = JSON.stringify({
        event: "transaction.updated",
        data: {
          transaction: { id: "wompi-tx-123", status: "APPROVED" },
        },
      });

      const event = verifier.parse(payload, Gateway.WOMPI);
      expect(event.eventType).toBe("transaction.updated");
      expect(event.gatewayTransactionId).toBe("wompi-tx-123");
      expect(event.newStatus).toBe("APPROVED");
      expect(event.gateway).toBe(Gateway.WOMPI);
    });

    it("normaliza eventos de PayU", () => {
      const payload = new URLSearchParams({
        transaction_id: "payu-tx-456",
        state_pol: "4",
      }).toString();

      const event = verifier.parse(payload, Gateway.PAYU);
      expect(event.eventType).toBe("transaction.updated");
      expect(event.gatewayTransactionId).toBe("payu-tx-456");
      expect(event.newStatus).toBe("APPROVED");
      expect(event.gateway).toBe(Gateway.PAYU);
    });

    it("normaliza eventos de Mercado Pago con estado en minuscula", () => {
      const payload = JSON.stringify({
        action: "payment.updated",
        data: { id: "mp-123" },
        status: "approved",
      });

      const event = verifier.parse(payload, Gateway.MERCADOPAGO);
      expect(event.eventType).toBe("payment.updated");
      expect(event.gatewayTransactionId).toBe("mp-123");
      expect(event.newStatus).toBe("APPROVED");
      expect(event.gateway).toBe(Gateway.MERCADOPAGO);
    });

    it("normaliza eventos de Kushki con APPROVAL a APPROVED", () => {
      const payload = JSON.stringify({
        transaction_id: "kushki-tx-789",
        transaction_status: "APPROVAL",
      });

      const event = verifier.parse(payload, Gateway.KUSHKI);
      expect(event.eventType).toBe("transaction.updated");
      expect(event.gatewayTransactionId).toBe("kushki-tx-789");
      expect(event.newStatus).toBe("APPROVED");
      expect(event.gateway).toBe(Gateway.KUSHKI);
    });

    it("mapea estados de rechazo correctamente", () => {
      const wompiDeclined = JSON.stringify({
        data: { transaction: { id: "1", status: "DECLINED" } },
      });
      expect(verifier.parse(wompiDeclined, Gateway.WOMPI).newStatus).toBe("DECLINED");

      const payuDeclined = new URLSearchParams({ transaction_id: "2", state_pol: "6" }).toString();
      expect(verifier.parse(payuDeclined, Gateway.PAYU).newStatus).toBe("DECLINED");

      const mpRejected = JSON.stringify({ data: { id: "3" }, status: "rejected" });
      expect(verifier.parse(mpRejected, Gateway.MERCADOPAGO).newStatus).toBe("DECLINED");

      const kushkiDeclined = JSON.stringify({ transaction_id: "4", transaction_status: "DECLINED" });
      expect(verifier.parse(kushkiDeclined, Gateway.KUSHKI).newStatus).toBe("DECLINED");
    });
  });
});
