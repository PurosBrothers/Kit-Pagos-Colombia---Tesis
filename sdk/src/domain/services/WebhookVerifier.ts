import { Gateway } from "../value-objects/Gateway";

/**
 * Servicio de dominio sin estado propio.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "WebhookVerifier se
 * implementa como servicio de dominio sin estado propio, con un unico
 * metodo publico verify(payload, headers, secret, gateway) que delega
 * internamente en la logica de verificacion de firma correspondiente al
 * Gateway recibido."
 *
 * TODO: implementar la logica de verificacion especifica por pasarela
 * (SHA-256 para Wompi, MD5/SHA-256 para PayU, HMAC-SHA256 para Mercado Pago
 * y Kushki), tal como se documenta en el ADR-04.
 */
export class WebhookVerifier {
  verify(
    payload: string,
    headers: Record<string, string>,
    secret: string,
    gateway: Gateway,
  ): boolean {
    throw new Error("WebhookVerifier.verify aun no esta implementado");
  }
}
