import * as crypto from "crypto";
import { WebhookVerifier, IncomingWebhook, WebhookSigningContext } from "./WebhookVerifier";
import { Gateway } from "../value-objects/Gateway";
import { KitPagosError } from "../errors/KitPagosError";
import { KitPagosErrorCode } from "../value-objects/KitPagosErrorCode";
// Se compara contra el normalizador a propósito: la causa del defecto del punto
// 46 era que las dos piezas traducían el mismo estado por separado.
import { ResponseNormalizer } from "../../application/services/ResponseNormalizer";

const incoming = (
  payload: string,
  headers: Record<string, string> = {},
  query?: Record<string, string>,
): IncomingWebhook => ({ payload, headers, query });

describe("WebhookVerifier", () => {
  const verifier = new WebhookVerifier();

  /*
   * Los firmantes de esta sección se escriben a partir de la documentación oficial de
   * cada pasarela y no a partir del SDK. Hasta el punto 66 las pruebas firmaban con la
   * misma fórmula que el verificador, y por eso pasaban mientras Rapyd y Wompi
   * rechazaban cualquier webhook real.
   */
  describe("verify()", () => {
    describe("Wompi", () => {
      const secret = "test_events_secret_wompi";
      const timestamp = Math.floor(Date.now() / 1000);
      const transaction = { id: "1234-1610641025-49201", status: "APPROVED", amount_in_cents: 4490000 };
      const properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];

      // docs.wompi.co/docs/colombia/eventos/, pasos 1 a 4: los valores de `data` en el
      // orden de `properties`, el timestamp y el secreto, en SHA-256.
      const checksum = crypto
        .createHash("sha256")
        .update(`1234-1610641025-49201APPROVED4490000${timestamp}${secret}`)
        .digest("hex");

      const eventWith = (overrides: Record<string, unknown> = {}) =>
        JSON.stringify({
          event: "transaction.updated",
          data: { transaction },
          environment: "test",
          signature: { properties, checksum },
          timestamp,
          ...overrides,
        });

      const context: WebhookSigningContext = { secret };

      it("should accept a checksum built from the data object, as the official documentation specifies", () => {
        const webhook = incoming(eventWith(), { "x-event-checksum": checksum });
        expect(verifier.verify(webhook, context, Gateway.WOMPI)).toBe(true);
      });

      it("should accept the checksum in uppercase, as the documentation prints it", () => {
        const webhook = incoming(eventWith(), { "x-event-checksum": checksum.toUpperCase() });
        expect(verifier.verify(webhook, context, Gateway.WOMPI)).toBe(true);
      });

      it("should reject properties written relative to the body root", () => {
        const rootRelative = eventWith({
          signature: { properties: properties.map((p) => `data.${p}`), checksum },
        });
        const webhook = incoming(rootRelative, { "x-event-checksum": checksum });
        expect(verifier.verify(webhook, context, Gateway.WOMPI)).toBe(false);
      });

      it("should reject a tampered status", () => {
        const tampered = eventWith().replace("APPROVED", "DECLINED");
        const webhook = incoming(tampered, { "x-event-checksum": checksum });
        expect(verifier.verify(webhook, context, Gateway.WOMPI)).toBe(false);
      });

      it("should reject a signature that differs in a single character", () => {
        const altered = (checksum[0] === "a" ? "b" : "a") + checksum.slice(1);
        const webhook = incoming(eventWith(), { "x-event-checksum": altered });
        expect(verifier.verify(webhook, context, Gateway.WOMPI)).toBe(false);
      });

      /**
       * El ataque que motivó exigir las propiedades del punto 66: la lista viaja sin
       * firmar, así que se la puede apuntar a un campo nuevo que repita la
       * concatenación original y cambiar el estado sin alterar el checksum.
       */
      it("should reject an event whose properties were redirected to keep the checksum while changing the status", () => {
        const forged = JSON.stringify({
          event: "transaction.updated",
          data: {
            transaction: {
              ...transaction,
              status: "DECLINED",
              note: "1234-1610641025-49201APPROVED4490000",
            },
          },
          signature: { properties: ["transaction.note"], checksum },
          timestamp,
        });
        const webhook = incoming(forged, { "x-event-checksum": checksum });
        expect(verifier.verify(webhook, context, Gateway.WOMPI)).toBe(false);
      });

      it("should reject a transaction event whose signature does not cover the status", () => {
        const idOnlyChecksum = crypto
          .createHash("sha256")
          .update(`1234-1610641025-49201${timestamp}${secret}`)
          .digest("hex");
        const payload = eventWith({
          signature: { properties: ["transaction.id"], checksum: idOnlyChecksum },
        });
        const webhook = incoming(payload, { "x-event-checksum": idOnlyChecksum });
        expect(verifier.verify(webhook, context, Gateway.WOMPI)).toBe(false);
      });
    });

    describe("Rapyd", () => {
      // docs.rapyd.net/en/webhook-authentication.html: BASE64(HMAC-SHA256(url_path + salt +
      // timestamp + access_key + secret_key + body_string)). El base64 va sobre el texto
      // hexadecimal, como en el ejemplo oficial de docs.rapyd.net/en/request-signatures.html,
      // y url_path es la URL completa registrada en el panel.
      const secretKey = "rapyd_secret_key_test";
      const accessKey = "rapyd_access_key_test";
      const webhookUrl = "https://comercio-ejemplo.com/webhooks/rapyd";
      const salt = "Oac/iU3wivthSAIvTJdE/A==";
      const timestamp = String(Math.floor(Date.now() / 1000));

      const payload = JSON.stringify({
        id: "wh_e0afb507504b5eb901449993fadba20f",
        type: "PAYMENT_COMPLETED",
        data: { id: "payment_f5e668f17ecc4b83a4d10aaa68260862", status: "CLO", paid: true },
      });

      const sign = (url: string, key: string, body = payload) => {
        const hex = crypto
          .createHmac("sha256", secretKey)
          .update(url + salt + timestamp + key + secretKey + body)
          .digest("hex");
        return Buffer.from(hex).toString("base64");
      };

      // docs.rapyd.net/en/webhook-format.html: estas son todas las cabeceras que Rapyd manda.
      const headersFor = (signature: string, extra: Record<string, string> = {}) => ({
        "content-type": "application/json",
        timestamp,
        salt,
        signature,
        ...extra,
      });

      const context: WebhookSigningContext = { secret: secretKey, publicKey: accessKey, webhookUrl };

      it("should accept a signature sent with only the headers Rapyd documents", () => {
        const webhook = incoming(payload, headersFor(sign(webhookUrl, accessKey)));
        expect(verifier.verify(webhook, context, Gateway.RAPYD)).toBe(true);
      });

      it("should reject a raw base64 digest, which is not what Rapyd sends", () => {
        const rawBase64 = crypto
          .createHmac("sha256", secretKey)
          .update(webhookUrl + salt + timestamp + accessKey + secretKey + payload)
          .digest("base64");
        const webhook = incoming(payload, headersFor(rawBase64));
        expect(verifier.verify(webhook, context, Gateway.RAPYD)).toBe(false);
      });

      it("should ignore an x-webhook-url header and verify against the configured URL", () => {
        const otherUrl = "https://otro-comercio.example.com/webhooks/rapyd";
        const webhook = incoming(
          payload,
          headersFor(sign(otherUrl, accessKey), { "x-webhook-url": otherUrl }),
        );
        expect(verifier.verify(webhook, context, Gateway.RAPYD)).toBe(false);
      });

      it("should ignore an access_key header and verify against the configured access key", () => {
        const otherKey = "rapyd_access_key_other";
        const webhook = incoming(
          payload,
          headersFor(sign(webhookUrl, otherKey), { access_key: otherKey }),
        );
        expect(verifier.verify(webhook, context, Gateway.RAPYD)).toBe(false);
      });

      it("should reject a tampered body", () => {
        const tampered = payload.replace("PAYMENT_COMPLETED", "PAYMENT_FAILED");
        const webhook = incoming(tampered, headersFor(sign(webhookUrl, accessKey)));
        expect(verifier.verify(webhook, context, Gateway.RAPYD)).toBe(false);
      });

      it("should reject a wrong secret", () => {
        const webhook = incoming(payload, headersFor(sign(webhookUrl, accessKey)));
        expect(verifier.verify(webhook, { ...context, secret: "wrong_secret" }, Gateway.RAPYD)).toBe(false);
      });

      it("should reject a missing signature header", () => {
        const webhook = incoming(payload, { timestamp, salt });
        expect(verifier.verify(webhook, context, Gateway.RAPYD)).toBe(false);
      });

      it.each([
        ["missing", undefined],
        ["relative", "/webhooks/rapyd"],
        ["padded with whitespace", ` ${webhookUrl}`],
        ["not http", "ftp://comercio-ejemplo.com/webhooks/rapyd"],
      ])("should throw INVALID_CREDENTIALS when the configured webhook URL is %s", (_label, url) => {
        const webhook = incoming(payload, headersFor(sign(webhookUrl, accessKey)));
        const verify = () => verifier.verify(webhook, { ...context, webhookUrl: url }, Gateway.RAPYD);
        expect(verify).toThrow(KitPagosError);
        expect(verify).toThrow(expect.objectContaining({ code: KitPagosErrorCode.INVALID_CREDENTIALS }));
      });

      it("should throw INVALID_CREDENTIALS when the access key is not configured", () => {
        const webhook = incoming(payload, headersFor(sign(webhookUrl, accessKey)));
        expect(() =>
          verifier.verify(webhook, { ...context, publicKey: undefined }, Gateway.RAPYD),
        ).toThrow(expect.objectContaining({ code: KitPagosErrorCode.INVALID_CREDENTIALS }));
      });
    });

    describe("Mercado Pago", () => {
      // mercadopago.com/developers, "Webhooks": el manifiesto es
      // id:[data.id_url];request-id:[x-request-id_header];ts:[ts_header]; con el data.id
      // del query string, en minúsculas si es alfanumérico.
      const secret = "mp_webhook_secret_test";
      const requestId = "2066ca19-c6f1-498a-be75-1923005edd06";
      const ts = String(Math.floor(Date.now() / 1000));
      const context: WebhookSigningContext = { secret };

      const signManifest = (id: string) =>
        crypto
          .createHmac("sha256", secret)
          .update(`id:${id};request-id:${requestId};ts:${ts};`)
          .digest("hex");

      const headersFor = (v1: string) => ({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId });

      it("should verify a numeric Payments API id taken from the body when there is no query", () => {
        const payload = JSON.stringify({ action: "payment.updated", data: { id: "12345678" } });
        const webhook = incoming(payload, headersFor(signManifest("12345678")));
        expect(verifier.verify(webhook, context, Gateway.MERCADOPAGO)).toBe(true);
      });

      it("should sign the data.id from the query string, lowercased", () => {
        const orderId = "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3";
        const payload = JSON.stringify({ action: "order.processed", data: { id: orderId } });
        const webhook = incoming(payload, headersFor(signManifest(orderId.toLowerCase())), {
          "data.id": orderId,
        });
        expect(verifier.verify(webhook, context, Gateway.MERCADOPAGO)).toBe(true);
      });

      it("should reject an alphanumeric id signed without lowercasing it", () => {
        const orderId = "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3";
        const payload = JSON.stringify({ action: "order.processed", data: { id: orderId } });
        const webhook = incoming(payload, headersFor(signManifest(orderId)), { "data.id": orderId });
        expect(verifier.verify(webhook, context, Gateway.MERCADOPAGO)).toBe(false);
      });

      it("should reject a body whose data.id differs from the signed query id", () => {
        const payload = JSON.stringify({ action: "payment.updated", data: { id: "99999999" } });
        const webhook = incoming(payload, headersFor(signManifest("12345678")), { "data.id": "12345678" });
        expect(verifier.verify(webhook, context, Gateway.MERCADOPAGO)).toBe(false);
      });

      it("should reject a wrong secret", () => {
        const payload = JSON.stringify({ action: "payment.updated", data: { id: "12345678" } });
        const webhook = incoming(payload, headersFor(signManifest("12345678")));
        expect(verifier.verify(webhook, { secret: "wrong_secret" }, Gateway.MERCADOPAGO)).toBe(false);
      });
    });

    describe("Kushki", () => {
      const secret = "kushki_signature_id";
      const kushkiId = String(Math.floor(Date.now() / 1000));
      const context: WebhookSigningContext = { secret };

      const payload = JSON.stringify({
        transaction_status: "APPROVAL",
        transaction_id: "781482485839103928",
      });

      const signature = crypto
        .createHmac("sha256", secret)
        .update(`${payload}.${kushkiId}`)
        .digest("hex");

      const headers = { "x-kushki-signature": signature, "x-kushki-id": kushkiId };

      it("should accept a valid HMAC signature", () => {
        expect(verifier.verify(incoming(payload, headers), context, Gateway.KUSHKI)).toBe(true);
      });

      it("should reject a tampered body", () => {
        const tampered = payload.replace("APPROVAL", "DECLINED");
        expect(verifier.verify(incoming(tampered, headers), context, Gateway.KUSHKI)).toBe(false);
      });
    });

    describe("replay protection: timestamp tolerance", () => {
      const secret = "test_events_secret_wompi";
      const txId = "tx-replay-1";
      const status = "APPROVED";
      const now = Math.floor(Date.now() / 1000);
      const context: WebhookSigningContext = { secret };

      function createWompiWebhook(ts: number): IncomingWebhook {
        const checksum = crypto
          .createHash("sha256")
          .update(`${txId}${status}${ts}${secret}`)
          .digest("hex");

        const body = JSON.stringify({
          event: "transaction.updated",
          data: { transaction: { id: txId, status } },
          timestamp: ts,
          signature: {
            properties: ["transaction.id", "transaction.status"],
            checksum,
          },
        });
        return incoming(body, { "x-event-checksum": checksum });
      }

      it("should reject a webhook more than 300 seconds in the past", () => {
        expect(verifier.verify(createWompiWebhook(now - 301), context, Gateway.WOMPI)).toBe(false);
      });

      it("should reject a webhook more than 300 seconds in the future", () => {
        expect(verifier.verify(createWompiWebhook(now + 305), context, Gateway.WOMPI)).toBe(false);
      });

      it("should accept an old webhook when toleranceSeconds is 0", () => {
        expect(
          verifier.verify(createWompiWebhook(now - 10000), context, Gateway.WOMPI, { toleranceSeconds: 0 }),
        ).toBe(true);
      });

      it("should accept an old webhook within an extended tolerance", () => {
        expect(
          verifier.verify(createWompiWebhook(now - 800), context, Gateway.WOMPI, { toleranceSeconds: 900 }),
        ).toBe(true);
      });

      it("should accept an old webhook when currentTimestamp matches it", () => {
        const oldTimestamp = 1602113476;
        expect(
          verifier.verify(createWompiWebhook(oldTimestamp), context, Gateway.WOMPI, {
            currentTimestamp: oldTimestamp + 10,
          }),
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

      const event = verifier.parse(incoming(payload), Gateway.WOMPI);
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

      const event = verifier.parse(incoming(payload), Gateway.RAPYD);
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

      const event = verifier.parse(incoming(payload), Gateway.RAPYD);
      expect(event.newStatus).toBe("PENDING");
    });

    it("normaliza eventos de Rapyd expirados (PAYMENT_EXPIRED)", () => {
      const payload = JSON.stringify({
        id: "wh_exp001",
        type: "PAYMENT_EXPIRED",
        data: { id: "payment_rapyd-tx-exp", status: "EXP" },
      });

      const event = verifier.parse(incoming(payload), Gateway.RAPYD);
      expect(event.newStatus).toBe("EXPIRED");
    });

    it("normaliza eventos de Rapyd cancelados (PAYMENT_CANCELED)", () => {
      const payload = JSON.stringify({
        id: "wh_can001",
        type: "PAYMENT_CANCELED",
        data: { id: "payment_rapyd-tx-can", status: "CAN" },
      });

      const event = verifier.parse(incoming(payload), Gateway.RAPYD);
      expect(event.newStatus).toBe("VOIDED");
    });

    it("should report PENDING for Mercado Pago even when the unsigned body carries a status", () => {
      const forged = JSON.stringify({
        action: "payment.updated",
        data: { id: "mp-123", status: "processed" },
        status: "approved",
      });

      const event = verifier.parse(incoming(forged), Gateway.MERCADOPAGO);
      expect(event.eventType).toBe("payment.updated");
      expect(event.gatewayTransactionId).toBe("mp-123");
      expect(event.newStatus).toBe("PENDING");
      expect(event.gateway).toBe(Gateway.MERCADOPAGO);
    });

    it("normaliza notificaciones nativas de Mercado Pago sin status a PENDING (flujo de 2 pasos)", () => {
      const payload = JSON.stringify({
        action: "payment.created",
        data: { id: "mp-native-999" },
      });

      const event = verifier.parse(incoming(payload), Gateway.MERCADOPAGO);
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

      const event = verifier.parse(incoming(payload), Gateway.MERCADOPAGO);
      expect(event.eventType).toBe("payment");
      expect(event.gatewayTransactionId).toBe("mp-type-888");
      expect(event.newStatus).toBe("PENDING");
      expect(event.gateway).toBe(Gateway.MERCADOPAGO);
    });

    it("should report the signed query data.id as the Mercado Pago transaction id", () => {
      const payload = JSON.stringify({ action: "order.processed", data: { id: "ord01jq4s4ky8hwq6na5pxb65b3d3" } });

      const event = verifier.parse(
        incoming(payload, {}, { "data.id": "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3" }),
        Gateway.MERCADOPAGO,
      );

      expect(event.gatewayTransactionId).toBe("ORD01JQ4S4KY8HWQ6NA5PXB65B3D3");
    });

    it("normaliza eventos de Kushki con APPROVAL a APPROVED", () => {
      const payload = JSON.stringify({
        transaction_id: "kushki-tx-789",
        transaction_status: "APPROVAL",
      });

      const event = verifier.parse(incoming(payload), Gateway.KUSHKI);
      expect(event.eventType).toBe("transaction.updated");
      expect(event.gatewayTransactionId).toBe("kushki-tx-789");
      expect(event.newStatus).toBe("APPROVED");
      expect(event.gateway).toBe(Gateway.KUSHKI);
    });

    it("mapea estados de rechazo correctamente", () => {
      const wompiDeclined = JSON.stringify({
        data: { transaction: { id: "1", status: "DECLINED" } },
      });
      expect(verifier.parse(incoming(wompiDeclined), Gateway.WOMPI).newStatus).toBe("DECLINED");

      // Rapyd usa el prefijo de failure_code para distinguir un rechazo de
      // negocio (del procesador de tarjeta) de un fallo tecnico, ya que
      // data.status es "ERR" en ambos casos. Ver docs.rapyd.net/en/card-network-errors.html.
      const rapydCardDeclined = JSON.stringify({
        id: "wh_def456",
        type: "PAYMENT_FAILED",
        data: { id: "payment_2", status: "ERR", failure_code: "ERROR_PROCESSING_CARD - [51]" },
      });
      expect(verifier.parse(incoming(rapydCardDeclined), Gateway.RAPYD).newStatus).toBe("DECLINED");

      const rapydTechnicalError = JSON.stringify({
        id: "wh_def789",
        type: "PAYMENT_FAILED",
        data: { id: "payment_3", status: "ERR", failure_code: "MISSING_AUTHENTICATION_HEADERS" },
      });
      expect(verifier.parse(incoming(rapydTechnicalError), Gateway.RAPYD).newStatus).toBe("ERROR");

      const kushkiDeclined = JSON.stringify({ transaction_id: "4", transaction_status: "DECLINED" });
      expect(verifier.parse(incoming(kushkiDeclined), Gateway.KUSHKI).newStatus).toBe("DECLINED");
    });

    it("mapea estados adicionales como VOIDED, ERROR y PENDING", () => {
      const wompiVoided = JSON.stringify({
        data: { transaction: { id: "1", status: "VOIDED" } },
      });
      expect(verifier.parse(incoming(wompiVoided), Gateway.WOMPI).newStatus).toBe("VOIDED");

      const wompiError = JSON.stringify({
        data: { transaction: { id: "1", status: "ERROR" } },
      });
      expect(verifier.parse(incoming(wompiError), Gateway.WOMPI).newStatus).toBe("ERROR");

      const wompiUnknown = JSON.stringify({
        data: { transaction: { id: "1", status: "OTHER" } },
      });
      expect(verifier.parse(incoming(wompiUnknown), Gateway.WOMPI).newStatus).toBe("ERROR");

      const rapydUnknown = JSON.stringify({
        type: "OTHER_EVENT",
        data: { id: "payment_unk" },
      });
      expect(verifier.parse(incoming(rapydUnknown), Gateway.RAPYD).newStatus).toBe("ERROR");

      const kushkiUnknown = JSON.stringify({
        transaction_id: "k-unk",
        transaction_status: "UNKNOWN",
      });
      expect(verifier.parse(incoming(kushkiUnknown), Gateway.KUSHKI).newStatus).toBe("ERROR");
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

        expect(verifier.parse(incoming(wompiPending), Gateway.WOMPI).newStatus).toBe("PENDING");
      });

      /**
       * La notificación de una orden trae su estado en `data.status`, pero fuera de
       * la firma. El vocabulario de la Orders API se traduce ahora solo al consultar
       * con `getPaymentStatus()`, y lo cubre `ResponseNormalizer.test.ts` (punto 69).
       */
      it("should report PENDING for an official Orders API notification, whose data.status is unsigned", () => {
        const processed = JSON.stringify({
          action: "order.processed",
          api_version: "v1",
          data: {
            id: "ORD01M28P44G5FG8RJPM579EH56FV",
            status: "processed",
            status_detail: "accredited",
          },
          live_mode: false,
          type: "order",
        });

        expect(verifier.parse(incoming(processed), Gateway.MERCADOPAGO).newStatus).toBe("PENDING");
      });

      /** `INITIALIZED` es el estado no final de efectivo y transferencias en Kushki. */
      it("mapea INITIALIZED de Kushki a PENDING", () => {
        const initialized = JSON.stringify({
          transaction_id: "kushki-cash-1",
          transaction_status: "INITIALIZED",
        });

        expect(verifier.parse(incoming(initialized), Gateway.KUSHKI).newStatus).toBe("PENDING");
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

        expect(verifier.parse(incoming(wompiWebhook), Gateway.WOMPI).newStatus).toBe(
          normalizer.normalize(wompiResponse, Gateway.WOMPI).getStatus(),
        );
      });
    });

    it("lanza error si el gateway no es reconocido", () => {
      expect(() => verifier.parse(incoming("{}"), "UNKNOWN_GW" as unknown as Gateway)).toThrow(
        "WebhookVerifier.parse: Gateway desconocido"
      );
      expect(() => verifier.verify(incoming("{}"), { secret: "secret" }, "UNKNOWN_GW" as unknown as Gateway)).toThrow(
        "WebhookVerifier.verify: Gateway desconocido"
      );
    });
  });
});
