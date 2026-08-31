import { Gateway } from "../value-objects/Gateway";
import { WebhookEvent } from "../value-objects/WebhookEvent";
import { TransactionStatus } from "../value-objects/TransactionStatus";
import * as crypto from "crypto";


/**
 * Servicio de dominio sin estado propio.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "WebhookVerifier se
 * implementa como servicio de dominio sin estado propio, con un unico
 * metodo publico verify(payload, headers, secret, gateway) que delega
 * internamente en la logica de verificacion de firma correspondiente al
 * Gateway recibido."
 *
 * parse() se agrega como segundo metodo publico para cerrar la brecha de
 * RF-04, que exige un evento normalizado despues de validar la firma. Esta
 * es una desviacion deliberada del "unico metodo publico" de la seccion
 * 15.1 (ver docs/architecture/sad-inconsistencies.md, punto 6).
 */
export class WebhookVerifier {

  verify(
    payload: string,
    headers: Record<string, string>,
    secret: string,
    gateway: Gateway
  ): boolean {
    switch (gateway) {
      case Gateway.WOMPI: {
        // Wompi: firma viaja en header "x-event-checksum" o body signature.checksum.
        // Cadena: concatenación de valores en signature.properties + timestamp + secret de eventos.
        // Algoritmo: SHA-256 puro (sin clave HMAC).
        const receivedChecksum = headers["x-event-checksum"];
        const body = JSON.parse(payload);
        const properties: string[] = body.signature.properties;
        const values = properties.map((prop: string) =>
          prop.split(".").reduce((obj: Record<string, unknown>, key: string) => (obj ? (obj[key] as Record<string, unknown>) : ({} as Record<string, unknown>)), body)
        );
        const concatenated = values.join("") + body.timestamp + secret;
        const calculatedChecksum = crypto.createHash("sha256").update(concatenated).digest("hex");
        return receivedChecksum === calculatedChecksum;
      }
      case Gateway.RAPYD: {
        // Rapyd / PayU GPO (adq. 14 mar 2025): firma en header "signature" (Base64 HMAC-SHA256).
        // Cadena: url_path + salt + timestamp + access_key + secret_key + body_string
        // Fuente: https://docs.rapyd.net/en/webhook-authentication.html
        // Nota: el middleware del comercio debe inyectar "x-webhook-url-path" en headers
        //       con el path del endpoint receptor (ej. "/webhooks/rapyd") antes de llamar verify().
        const receivedSignature = headers["signature"] ?? "";
        const accessKey         = headers["access_key"] ?? "";
        const salt              = headers["salt"] ?? "";
        const timestamp         = headers["timestamp"] ?? "";
        const urlPath           = headers["x-webhook-url-path"] ?? "";

        const toSign = urlPath + salt + timestamp + accessKey + secret + payload;
        const calculatedSignature = crypto
          .createHmac("sha256", secret)
          .update(toSign)
          .digest("base64");
        return receivedSignature === calculatedSignature;
      }
      case Gateway.MERCADOPAGO: {
        // Mercado Pago: firma ("v1") viaja en header "x-signature" con formato "ts={timestamp},v1={hash}".
        // Cadena: id:{data.id};request-id:{x-request-id};ts:{ts}
        // Algoritmo: HMAC-SHA256 (con clave secreta de la aplicación).
        const xSignature = headers["x-signature"];
        const requestId = headers["x-request-id"];
        const body = JSON.parse(payload);
        const dataId = String(body.data.id);

        // Parsear ts y v1 del header
        const parts = Object.fromEntries(
          xSignature.split(",").map((p: string) => p.split("="))
        );
        const ts = parts["ts"];
        const receivedV1 = parts["v1"];

        const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
        const calculatedV1 = crypto.createHmac("sha256", secret)
          .update(manifest)
          .digest("hex");
        return receivedV1 === calculatedV1;
      }
      case Gateway.KUSHKI: {
        // Kushki: firma viaja en header "x-kushki-signature" (y timestamp en "x-kushki-id").
        // Cadena: JSON.stringify(body) + "." + x_kushki_id
        // Algoritmo: HMAC-SHA256 (con "Webhook signature ID" de la consola).
        const receivedSignature = headers["x-kushki-signature"];
        const kushkiId = headers["x-kushki-id"];
        const data = payload + "." + kushkiId;
        const calculatedSignature = crypto.createHmac("sha256", secret)
          .update(data)
          .digest("hex");
        return receivedSignature === calculatedSignature;
      }
      default:
        throw new Error(`WebhookVerifier.verify: Gateway desconocido: ${gateway}`);
    }
  }

  parse(payload: string, gateway: Gateway): WebhookEvent {
    switch (gateway) {
      case Gateway.WOMPI: {
        const body = JSON.parse(payload);
        const eventType = body.event ?? "transaction.updated";
        const gatewayTransactionId = body.data?.transaction?.id ?? "";
        const rawStatus = body.data?.transaction?.status ?? "";

        let newStatus: TransactionStatus;
        switch (rawStatus) {
          case "APPROVED":
            newStatus = "APPROVED";
            break;
          case "DECLINED":
            newStatus = "DECLINED";
            break;
          case "VOIDED":
            newStatus = "VOIDED";
            break;
          case "ERROR":
            newStatus = "ERROR";
            break;
          default:
            newStatus = "ERROR";
        }

        return new WebhookEvent({
          eventType,
          gatewayTransactionId,
          newStatus,
          gateway: Gateway.WOMPI,
        });
      }
      case Gateway.RAPYD: {
        // Rapyd / PayU GPO: el body de confirmacion sigue siendo x-www-form-urlencoded
        // con el formato original de PayU (state_pol) durante el periodo de transicion.
        // La autenticacion del webhook cambio a HMAC-SHA256 (ver verify()), pero la
        // estructura del payload de notificacion no ha cambiado aun.
        const params = new URLSearchParams(payload);
        const eventType = "transaction.updated";
        const gatewayTransactionId = params.get("transaction_id") ?? "";
        const statePol = params.get("state_pol") ?? "";

        let newStatus: TransactionStatus;
        switch (statePol) {
          case "4":
            newStatus = "APPROVED";
            break;
          case "6":
            newStatus = "DECLINED";
            break;
          case "5":
            newStatus = "EXPIRED";
            break;
          case "7":
          case "10":
          case "12":
          case "14":
          case "15":
          case "18":
            newStatus = "PENDING";
            break;
          case "104":
            newStatus = "ERROR";
            break;
          default:
            newStatus = "ERROR";
        }

        return new WebhookEvent({
          eventType,
          gatewayTransactionId,
          newStatus,
          gateway: Gateway.RAPYD,
        });
      }
      case Gateway.MERCADOPAGO: {
        const body = JSON.parse(payload);
        const eventType = body.action ?? "payment.updated";
        const gatewayTransactionId = String(body.data?.id ?? "");
        const rawStatus = (body.status ?? "").toLowerCase();

        let newStatus: TransactionStatus;
        switch (rawStatus) {
          case "approved":
            newStatus = "APPROVED";
            break;
          case "rejected":
            newStatus = "DECLINED";
            break;
          case "pending":
            newStatus = "PENDING";
            break;
          default:
            newStatus = "ERROR";
        }

        return new WebhookEvent({
          eventType,
          gatewayTransactionId,
          newStatus,
          gateway: Gateway.MERCADOPAGO,
        });
      }
      case Gateway.KUSHKI: {
        const body = JSON.parse(payload);
        const eventType = "transaction.updated";
        const gatewayTransactionId = String(body.transaction_id ?? "");
        const rawStatus = body.transaction_status ?? "";

        let newStatus: TransactionStatus;
        switch (rawStatus) {
          case "APPROVAL":
            newStatus = "APPROVED";
            break;
          case "DECLINED":
            newStatus = "DECLINED";
            break;
          default:
            newStatus = "ERROR";
        }

        return new WebhookEvent({
          eventType,
          gatewayTransactionId,
          newStatus,
          gateway: Gateway.KUSHKI,
        });
      }
      default:
        throw new Error(`WebhookVerifier.parse: Gateway desconocido: ${gateway}`);
    }
  }
}
