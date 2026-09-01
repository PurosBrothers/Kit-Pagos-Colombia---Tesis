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
        // Rapyd (adq. de PayU GPO, 14 mar 2025): firma en header "signature" (Base64 HMAC-SHA256).
        // Cadena: url_path + salt + timestamp + access_key + secret_key + body_string
        // Fuente: https://docs.rapyd.net/en/webhook-authentication.html
        // Nota: "url_path" aqui es la URL COMPLETA (protocolo + dominio + path) configurada
        //       en el panel de Rapyd para recibir el webhook, no un path relativo del request
        //       entrante (a diferencia de la firma de requests salientes, que si usa el path
        //       relativo). El SDK no puede derivarla del propio request, asi que el middleware
        //       del comercio debe inyectarla en el header sintetico "x-webhook-url" antes de
        //       llamar verify(). Ver docs/architecture/sad-inconsistencies.md, punto 16.
        const receivedSignature = headers["signature"] ?? "";
        const accessKey         = headers["access_key"] ?? "";
        const salt              = headers["salt"] ?? "";
        const timestamp         = headers["timestamp"] ?? "";
        const webhookUrl        = headers["x-webhook-url"] ?? "";

        const toSign = webhookUrl + salt + timestamp + accessKey + secret + payload;
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
        // Rapyd envia un webhook JSON distinto segun el resultado, no un unico
        // evento con un campo de estado variable como Wompi: "type" vale
        // "PAYMENT_SUCCEEDED", "PAYMENT_COMPLETED" o "PAYMENT_FAILED", y el
        // objeto "data" trae el id del pago y su status interno ("ACT" | "CLO" | "ERR").
        // Fuente: docs/architecture/ubiquitous-language.md, seccion 2 (columna
        // Rapyd Nativo) y Apendice EstadoTransaccion. Corrige la suposicion sin
        // cita que asumia el formato x-www-form-urlencoded de PayU (ver
        // docs/architecture/sad-inconsistencies.md, punto 16).
        const body = JSON.parse(payload);
        const eventType: string = body.type ?? "";
        const gatewayTransactionId = body.data?.id ?? "";

        let newStatus: TransactionStatus;
        switch (eventType) {
          case "PAYMENT_COMPLETED":
            newStatus = "APPROVED";
            break;
          case "PAYMENT_SUCCEEDED":
            // data.status "ACT": la solicitud fue recibida pero puede seguir
            // pendiente de un paso adicional (ej. 3DS).
            newStatus = "PENDING";
            break;
          case "PAYMENT_FAILED":
            // TODO: Rapyd no distingue aqui un rechazo de negocio (DECLINED,
            // ej. fondos insuficientes) de un fallo tecnico (ERROR); ambos
            // viajan mezclados en data.failure_code. Falta el catalogo
            // completo de failure_code (requiere sandbox real) para separar
            // los dos casos; se retoma al iniciar Iteracion 2, sin issue
            // creado aun. Mientras tanto se usa ERROR como valor conservador.
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
