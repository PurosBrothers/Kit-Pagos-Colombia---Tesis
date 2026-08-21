import { Gateway } from "../value-objects/Gateway";
import { WebhookEvent } from "../value-objects/WebhookEvent";

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
 *
 * TODO: implementar la logica de verificacion especifica por pasarela
 * (SHA-256 para Wompi, MD5/SHA-256 para PayU, HMAC-SHA256 para Mercado Pago
 * y Kushki), tal como se documenta en el ADR-04.
 */
export class WebhookVerifier {
  verify(
    _payload: string,
    _headers: Record<string, string>,
    _secret: string,
    _gateway: Gateway
  ): boolean {
    throw new Error("WebhookVerifier.verify aun no esta implementado");
  }

  parse(_payload: string, _gateway: Gateway): WebhookEvent {
    throw new Error("WebhookVerifier.parse aun no esta implementado");
  }
}
