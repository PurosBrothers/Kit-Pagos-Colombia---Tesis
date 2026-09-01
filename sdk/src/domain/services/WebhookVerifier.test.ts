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

    describe("Rapyd", () => {
      // Rapyd adquirio PayU GPO el 14 mar 2025.
      // Algoritmo: Base64( HMAC-SHA256( url_path + salt + timestamp + access_key + secret_key + body ) )
      // Fuente: https://docs.rapyd.net/en/webhook-authentication.html
      // "url_path" es la URL COMPLETA configurada en el panel de Rapyd para el
      // webhook, no un path relativo (ver architecture-log.md, punto 16).
      const secretKey  = "rapyd_secret_key_test";
      const accessKey  = "rapyd_access_key_test";
      const salt       = "random_salt_abc123";
      const timestamp  = "1727001234";
      const webhookUrl = "https://comercio-ejemplo.com/webhooks/rapyd";

      const payload = JSON.stringify({
        id: "wh_e0afb507504b5eb901449993fadba20f",
        type: "PAYMENT_COMPLETED",
        data: {
          id: "payment_f5e668f17ecc4b83a4d10aaa68260862",
          status: "CLO",
          paid: true,
        },
      });

      const signature = crypto
        .createHmac("sha256", secretKey)
        .update(webhookUrl + salt + timestamp + accessKey + secretKey + payload)
        .digest("base64");

      it("valida una firma Rapyd correcta en el header signature", () => {
        const headers = {
          signature,
          access_key: accessKey,
          salt,
          timestamp,
          "x-webhook-url": webhookUrl,
        };
        expect(verifier.verify(payload, headers, secretKey, Gateway.RAPYD)).toBe(true);
      });

      it("rechaza si el body fue alterado", () => {
        const tampered = payload.replace("PAYMENT_COMPLETED", "PAYMENT_FAILED");
        const headers = {
          signature,
          access_key: accessKey,
          salt,
          timestamp,
          "x-webhook-url": webhookUrl,
        };
        expect(verifier.verify(tampered, headers, secretKey, Gateway.RAPYD)).toBe(false);
      });

      it("rechaza si el secret es incorrecto", () => {
        const headers = {
          signature,
          access_key: accessKey,
          salt,
          timestamp,
          "x-webhook-url": webhookUrl,
        };
        expect(verifier.verify(payload, headers, "wrong_secret", Gateway.RAPYD)).toBe(false);
      });

      it("rechaza si falta el header signature", () => {
        const headers = {
          access_key: accessKey,
          salt,
          timestamp,
          "x-webhook-url": webhookUrl,
        };
        expect(verifier.verify(payload, headers, secretKey, Gateway.RAPYD)).toBe(false);
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

    it("normaliza eventos de Rapyd (PAYMENT_COMPLETED)", () => {
      const payload = JSON.stringify({
        id: "wh_e0afb507504b5eb901449993fadba20f",
        type: "PAYMENT_COMPLETED",
        data: { id: "payment_rapyd-tx-456", status: "CLO", paid: true },
      });

      const event = verifier.parse(payload, Gateway.RAPYD);
      expect(event.eventType).toBe("PAYMENT_COMPLETED");
      expect(event.gatewayTransactionId).toBe("payment_rapyd-tx-456");
      expect(event.newStatus).toBe("APPROVED");
      expect(event.gateway).toBe(Gateway.RAPYD);
    });

    it("normaliza eventos de Rapyd pendientes (PAYMENT_SUCCEEDED con data.status ACT)", () => {
      const payload = JSON.stringify({
        id: "wh_abc123",
        type: "PAYMENT_SUCCEEDED",
        data: { id: "payment_rapyd-tx-789", status: "ACT", paid: false },
      });

      const event = verifier.parse(payload, Gateway.RAPYD);
      expect(event.newStatus).toBe("PENDING");
    });

    it("normaliza eventos de Rapyd expirados (PAYMENT_EXPIRED)", () => {
      const payload = JSON.stringify({
        id: "wh_exp001",
        type: "PAYMENT_EXPIRED",
        data: { id: "payment_rapyd-tx-exp", status: "EXP" },
      });

      const event = verifier.parse(payload, Gateway.RAPYD);
      expect(event.newStatus).toBe("EXPIRED");
    });

    it("normaliza eventos de Rapyd cancelados (PAYMENT_CANCELED)", () => {
      const payload = JSON.stringify({
        id: "wh_can001",
        type: "PAYMENT_CANCELED",
        data: { id: "payment_rapyd-tx-can", status: "CAN" },
      });

      const event = verifier.parse(payload, Gateway.RAPYD);
      expect(event.newStatus).toBe("VOIDED");
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

      // Rapyd usa el prefijo de failure_code para distinguir un rechazo de
      // negocio (del procesador de tarjeta) de un fallo tecnico, ya que
      // data.status es "ERR" en ambos casos. Ver docs.rapyd.net/en/card-network-errors.html.
      const rapydCardDeclined = JSON.stringify({
        id: "wh_def456",
        type: "PAYMENT_FAILED",
        data: { id: "payment_2", status: "ERR", failure_code: "ERROR_PROCESSING_CARD - [51]" },
      });
      expect(verifier.parse(rapydCardDeclined, Gateway.RAPYD).newStatus).toBe("DECLINED");

      const rapydTechnicalError = JSON.stringify({
        id: "wh_def789",
        type: "PAYMENT_FAILED",
        data: { id: "payment_3", status: "ERR", failure_code: "MISSING_AUTHENTICATION_HEADERS" },
      });
      expect(verifier.parse(rapydTechnicalError, Gateway.RAPYD).newStatus).toBe("ERROR");

      const mpRejected = JSON.stringify({ data: { id: "3" }, status: "rejected" });
      expect(verifier.parse(mpRejected, Gateway.MERCADOPAGO).newStatus).toBe("DECLINED");

      const kushkiDeclined = JSON.stringify({ transaction_id: "4", transaction_status: "DECLINED" });
      expect(verifier.parse(kushkiDeclined, Gateway.KUSHKI).newStatus).toBe("DECLINED");
    });
  });
});
