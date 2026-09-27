import { Gateway } from "../value-objects/Gateway";
import { WebhookEvent } from "../value-objects/WebhookEvent";
import {
  GatewayWebhookHandler,
  IncomingWebhook,
  WebhookSigningContext,
  WebhookVerificationOptions,
} from "./webhooks/GatewayWebhookHandler";
import { WompiWebhookHandler } from "./webhooks/WompiWebhookHandler";
import { RapydWebhookHandler } from "./webhooks/RapydWebhookHandler";
import { MercadoPagoWebhookHandler } from "./webhooks/MercadoPagoWebhookHandler";
import { KushkiWebhookHandler } from "./webhooks/KushkiWebhookHandler";

export {
  IncomingWebhook,
  WebhookSigningContext,
  WebhookVerificationOptions,
} from "./webhooks/GatewayWebhookHandler";

/**
 * Servicio de dominio sin estado propio.
 *
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "WebhookVerifier se
 * implementa como servicio de dominio sin estado propio, con un unico metodo
 * publico verify(payload, headers, secret, gateway) que delega internamente en
 * la logica de verificacion de firma correspondiente al Gateway recibido."
 *
 * parse() se agrega como segundo metodo publico para cerrar la brecha de RF-04,
 * que exige un evento normalizado despues de validar la firma. Esta es una
 * desviacion deliberada del "unico metodo publico" de la seccion 15.1 (ver
 * architecture-log.md, punto 6).
 *
 * ## Estructura
 *
 * La delegacion que la seccion 15.1 describe es ahora explicita: cada pasarela
 * tiene su manejador bajo `webhooks/`, y esta clase solo despacha. Antes las
 * cuatro implementaciones vivian como ramas de sendos `switch` en verify() y
 * parse(), lo que dejaba a parse() en complejidad ciclomatica 36 y a la clase en
 * WMC 47. Ver architecture-log.md, punto 34.
 */
export class WebhookVerifier {
  /**
   * Verifica la autenticidad de un webhook contra la firma de su pasarela y su frescura temporal.
   *
   * @param webhook La notificación tal como llegó: cuerpo crudo, cabeceras en minúsculas y query.
   * @param context Secreto y demás valores firmados que salen de la configuración del comercio.
   * @param gateway Pasarela emisora.
   * @param options Opciones de verificación de frescura (replay protection).
   */
  verify(
    webhook: IncomingWebhook,
    context: WebhookSigningContext,
    gateway: Gateway,
    options?: WebhookVerificationOptions,
  ): boolean {
    return handlerFor(gateway, "verify").verify(webhook, context, options);
  }

  /** Traduce un webhook ya verificado al evento del dominio. */
  parse(webhook: IncomingWebhook, gateway: Gateway): WebhookEvent {
    return handlerFor(gateway, "parse").parse(webhook);
  }
}

/*
 * Los manejadores no tienen estado, así que el mapa y su resolución viven en el módulo:
 * como método privado, `GatewayWebhookHandler` entraba en las firmas de la clase y le
 * costaba CBO (ver el punto 66 y la regla de funciones de módulo del punto 34).
 */
const HANDLERS: Record<Gateway, GatewayWebhookHandler> = {
  [Gateway.WOMPI]: new WompiWebhookHandler(),
  [Gateway.RAPYD]: new RapydWebhookHandler(),
  [Gateway.MERCADOPAGO]: new MercadoPagoWebhookHandler(),
  [Gateway.KUSHKI]: new KushkiWebhookHandler(),
};

/**
 * Resuelve el manejador de la pasarela.
 *
 * El nombre de la operacion entra como argumento para conservar el mensaje de
 * error que cada metodo publico producia antes de la division, del que dependen
 * las pruebas de contrato.
 */
function handlerFor(gateway: Gateway, operation: string): GatewayWebhookHandler {
  const handler = HANDLERS[gateway];
  if (!handler) {
    throw new Error(
      `WebhookVerifier.${operation}: Gateway desconocido: ${gateway}`,
    );
  }
  return handler;
}
