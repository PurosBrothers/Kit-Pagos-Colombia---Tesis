import * as crypto from "crypto";
import { WebhookVerifier } from "./WebhookVerifier";
import { Gateway } from "../value-objects/Gateway";
// Se compara contra el normalizador a propósito: la causa del defecto del punto
// 46 era que las dos piezas traducían el mismo estado por separado.
import { ResponseNormalizer } from "../../application/services/ResponseNormalizer";

describe("WebhookVerifier", () => {
  const verifier = new WebhookVerifier();

  describe("verify()", () => {
    describe("Wompi", () => {
      const secret = "test_events_secret_wompi";
      const timestamp = Math.floor(Date.now() / 1000);
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

      it("rechaza si la firma tiene la misma longitud pero difiere en un solo caracter", () => {
        const alteredChecksum = (checksum[0] === "a" ? "b" : "a") + checksum.slice(1);
        const headers = { "x-event-checksum": alteredChecksum };

        const result = verifier.verify(payload, headers, secret, Gateway.WOMPI);
        expect(result).toBe(false);
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
      const timestamp  = String(Math.floor(Date.now() / 1000));
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
      const ts = String(Math.floor(Date.now() / 1000));

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
      const kushkiId = String(Math.floor(Date.now() / 1000));

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

    describe("replay protection: timestamp tolerance", () => {
      const secret = "test_events_secret_wompi";
      const txId = "tx-replay-1";
      const status = "APPROVED";
      const now = Math.floor(Date.now() / 1000);

      function createWompiPayload(ts: number) {
        const checksum = crypto
          .createHash("sha256")
          .update(`${txId}${status}${ts}${secret}`)
          .digest("hex");

        const body = JSON.stringify({
          event: "transaction.updated",
          data: { transaction: { id: txId, status } },
          timestamp: ts,
          signature: {
            properties: ["data.transaction.id", "data.transaction.status"],
            checksum,
          },
        });
        return { body, headers: { "x-event-checksum": checksum } };
      }

      it("rechaza webhook si el timestamp tiene más de 300 segundos en el pasado (ataque de replay)", () => {
        const oldTimestamp = now - 301;
        const { body, headers } = createWompiPayload(oldTimestamp);
        expect(verifier.verify(body, headers, secret, Gateway.WOMPI)).toBe(false);
      });

      it("rechaza webhook si el timestamp está más de 300 segundos en el futuro", () => {
        const futureTimestamp = now + 305;
        const { body, headers } = createWompiPayload(futureTimestamp);
        expect(verifier.verify(body, headers, secret, Gateway.WOMPI)).toBe(false);
      });

      it("acepta webhook con timestamp fuera de ventana si se desactiva con toleranceSeconds: 0", () => {
        const oldTimestamp = now - 10000;
        const { body, headers } = createWompiPayload(oldTimestamp);
        expect(
          verifier.verify(body, headers, secret, Gateway.WOMPI, { toleranceSeconds: 0 })
        ).toBe(true);
      });

      it("acepta webhook con timestamp antiguo si se configura una tolerancia extendida", () => {
        const oldTimestamp = now - 800;
        const { body, headers } = createWompiPayload(oldTimestamp);
        expect(
          verifier.verify(body, headers, secret, Gateway.WOMPI, { toleranceSeconds: 900 })
        ).toBe(true);
      });

      it("acepta webhook antiguo si se provee currentTimestamp concordante", () => {
        const oldTimestamp = 1602113476;
        const { body, headers } = createWompiPayload(oldTimestamp);
        expect(
          verifier.verify(body, headers, secret, Gateway.WOMPI, { currentTimestamp: oldTimestamp + 10 })
        ).toBe(true);
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

    it("normaliza notificaciones nativas de Mercado Pago sin status a PENDING (flujo de 2 pasos)", () => {
      const payload = JSON.stringify({
        action: "payment.created",
        data: { id: "mp-native-999" },
      });

      const event = verifier.parse(payload, Gateway.MERCADOPAGO);
      expect(event.eventType).toBe("payment.created");
      expect(event.gatewayTransactionId).toBe("mp-native-999");
      expect(event.newStatus).toBe("PENDING");
      expect(event.gateway).toBe(Gateway.MERCADOPAGO);
    });

    it("extrae eventType desde type en Mercado Pago cuando action no está presente", () => {
      const payload = JSON.stringify({
        type: "payment",
        data: { id: "mp-type-888" },
      });

      const event = verifier.parse(payload, Gateway.MERCADOPAGO);
      expect(event.eventType).toBe("payment");
      expect(event.gatewayTransactionId).toBe("mp-type-888");
      expect(event.newStatus).toBe("PENDING");
      expect(event.gateway).toBe(Gateway.MERCADOPAGO);
    });

    it("normaliza eventos de Mercado Pago con in_process a PENDING y cancelled a VOIDED", () => {
      const payloadInProcess = JSON.stringify({
        action: "payment.updated",
        data: { id: "mp-proc-1" },
        status: "in_process",
      });
      const eventProc = verifier.parse(payloadInProcess, Gateway.MERCADOPAGO);
      expect(eventProc.newStatus).toBe("PENDING");

      const payloadCancelled = JSON.stringify({
        action: "payment.updated",
        data: { id: "mp-canc-2" },
        status: "cancelled",
      });
      const eventCanc = verifier.parse(payloadCancelled, Gateway.MERCADOPAGO);
      expect(eventCanc.newStatus).toBe("VOIDED");
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

    it("mapea estados adicionales como VOIDED, ERROR y PENDING", () => {
      const wompiVoided = JSON.stringify({
        data: { transaction: { id: "1", status: "VOIDED" } },
      });
      expect(verifier.parse(wompiVoided, Gateway.WOMPI).newStatus).toBe("VOIDED");

      const wompiError = JSON.stringify({
        data: { transaction: { id: "1", status: "ERROR" } },
      });
      expect(verifier.parse(wompiError, Gateway.WOMPI).newStatus).toBe("ERROR");

      const wompiUnknown = JSON.stringify({
        data: { transaction: { id: "1", status: "OTHER" } },
      });
      expect(verifier.parse(wompiUnknown, Gateway.WOMPI).newStatus).toBe("ERROR");

      const rapydUnknown = JSON.stringify({
        type: "OTHER_EVENT",
        data: { id: "payment_unk" },
      });
      expect(verifier.parse(rapydUnknown, Gateway.RAPYD).newStatus).toBe("ERROR");

      const mpPending = JSON.stringify({
        action: "payment.updated",
        data: { id: "mp-pend" },
        status: "pending",
      });
      expect(verifier.parse(mpPending, Gateway.MERCADOPAGO).newStatus).toBe("PENDING");

      const mpUnknown = JSON.stringify({
        action: "payment.updated",
        data: { id: "mp-unk" },
        status: "unknown_status",
      });
      expect(verifier.parse(mpUnknown, Gateway.MERCADOPAGO).newStatus).toBe("ERROR");

      const kushkiUnknown = JSON.stringify({
        transaction_id: "k-unk",
        transaction_status: "UNKNOWN",
      });
      expect(verifier.parse(kushkiUnknown, Gateway.KUSHKI).newStatus).toBe("ERROR");
    });

    /**
     * Regresión del defecto encontrado al revisar qué faltaba para cerrar PSE
     * (punto 46 del `architecture-log.md`).
     *
     * Cada pasarela traducía sus estados en dos lugares —el normalizador de
     * respuestas y el manejador de webhooks— y a la copia del webhook le faltaba
     * exactamente el **estado no final** en las tres que mapean estados. No es
     * casualidad: los webhooks se escribieron cuando el SDK solo cobraba con
     * tarjeta, donde la notificación llega con el pago ya resuelto. PSE rompe ese
     * supuesto, porque la primera notificación puede llegar mientras el pagador
     * todavía no volvió del banco.
     *
     * El efecto era que **la notificación de un pago en curso se reportaba como
     * `ERROR`**, que para el comercio es la diferencia entre esperar al pagador y
     * darle la orden por perdida.
     */
    describe("estados no finales, que PSE volvió alcanzables", () => {
      it("mapea PENDING de Wompi a PENDING y no a ERROR", () => {
        const wompiPending = JSON.stringify({
          data: { transaction: { id: "wompi-pse-1", status: "PENDING" } },
        });

        expect(verifier.parse(wompiPending, Gateway.WOMPI).newStatus).toBe("PENDING");
      });

      /**
       * `action_required` es el estado de una orden de PSE esperando la
       * transferencia, y `processed` el de una ya pagada. Los dos son de la Orders
       * API, que el manejador no conocía porque solo tenía el vocabulario de la
       * Payments API.
       */
      it("mapea los estados de la Orders API de Mercado Pago", () => {
        const waiting = JSON.stringify({
          action: "order.updated",
          data: { id: "ORD01M2V7ZQH9BAZ57V99VG1NY0K1" },
          status: "action_required",
        });
        const paid = JSON.stringify({
          action: "order.updated",
          data: { id: "ORD01M2V7ZQH9BAZ57V99VG1NY0K1" },
          status: "processed",
        });
        const expired = JSON.stringify({
          action: "order.updated",
          data: { id: "ORD01M2V7ZQH9BAZ57V99VG1NY0K1" },
          status: "expired",
        });

        expect(verifier.parse(waiting, Gateway.MERCADOPAGO).newStatus).toBe("PENDING");
        expect(verifier.parse(paid, Gateway.MERCADOPAGO).newStatus).toBe("APPROVED");
        expect(verifier.parse(expired, Gateway.MERCADOPAGO).newStatus).toBe("EXPIRED");
      });

      /** `INITIALIZED` es el estado no final de efectivo y transferencias en Kushki. */
      it("mapea INITIALIZED de Kushki a PENDING", () => {
        const initialized = JSON.stringify({
          transaction_id: "kushki-cash-1",
          transaction_status: "INITIALIZED",
        });

        expect(verifier.parse(initialized, Gateway.KUSHKI).newStatus).toBe("PENDING");
      });

      /**
       * La razón de fondo por la que el defecto existía: dos tablas para lo mismo.
       * Ahora el webhook y el normalizador comparten la fuente, así que un estado
       * que uno entiende el otro también.
       */
      it("coincide con el normalizador para el mismo estado nativo", () => {
        const normalizer = new ResponseNormalizer();

        const wompiResponse = {
          data: {
            id: "wompi-pse-1",
            status: "PENDING",
            amount_in_cents: 15000000,
            currency: "COP",
            reference: "ord-1",
            customer_email: "cliente@example.com",
          },
        };
        const wompiWebhook = JSON.stringify({
          data: { transaction: { id: "wompi-pse-1", status: "PENDING" } },
        });

        expect(verifier.parse(wompiWebhook, Gateway.WOMPI).newStatus).toBe(
          normalizer.normalize(wompiResponse, Gateway.WOMPI).getStatus(),
        );
      });
    });

    it("lanza error si el gateway no es reconocido", () => {
      expect(() => verifier.parse("{}", "UNKNOWN_GW" as unknown as Gateway)).toThrow(
        "WebhookVerifier.parse: Gateway desconocido"
      );
      expect(() => verifier.verify("{}", {}, "secret", "UNKNOWN_GW" as unknown as Gateway)).toThrow(
        "WebhookVerifier.verify: Gateway desconocido"
      );
    });
  });
});
