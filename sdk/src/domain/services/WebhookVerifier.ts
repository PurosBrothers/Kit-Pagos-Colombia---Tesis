import { Gateway } from "../value-objects/Gateway";
import { WebhookEvent } from "../value-objects/WebhookEvent";
import { GatewayWebhookHandler } from "./webhooks/GatewayWebhookHandler";
import { WompiWebhookHandler } from "./webhooks/WompiWebhookHandler";
import { RapydWebhookHandler } from "./webhooks/RapydWebhookHandler";
import { MercadoPagoWebhookHandler } from "./webhooks/MercadoPagoWebhookHandler";
import { KushkiWebhookHandler } from "./webhooks/KushkiWebhookHandler";

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
  private readonly handlers: Record<Gateway, GatewayWebhookHandler> = {
    [Gateway.WOMPI]: new WompiWebhookHandler(),
    [Gateway.RAPYD]: new RapydWebhookHandler(),
    [Gateway.MERCADOPAGO]: new MercadoPagoWebhookHandler(),
    [Gateway.KUSHKI]: new KushkiWebhookHandler(),
  };

  /**
   * Verifica la autenticidad de un webhook contra la firma de su pasarela.
   *
   * @param payload Cuerpo crudo tal como llego, sin reserializar.
   * @param headers Cabeceras de la peticion, en minusculas.
   * @param secret Secreto de webhooks de la pasarela.
   */
  verify(
    payload: string,
    headers: Record<string, string>,
    secret: string,
    gateway: Gateway,
  ): boolean {
    return this.handlerFor(gateway, "verify").verify(payload, headers, secret);
  }

  /** Traduce el cuerpo de un webhook ya verificado al evento del dominio. */
  parse(payload: string, gateway: Gateway): WebhookEvent {
    return this.handlerFor(gateway, "parse").parse(payload);
  }

  /**
   * Resuelve el manejador de la pasarela.
   *
   * El nombre de la operacion entra como argumento para conservar el mensaje de
   * error que cada metodo publico producia antes de la division, del que dependen
   * las pruebas de contrato.
   */
  private handlerFor(gateway: Gateway, operation: string): GatewayWebhookHandler {
    const handler = this.handlers[gateway];
    if (!handler) {
      throw new Error(
        `WebhookVerifier.${operation}: Gateway desconocido: ${gateway}`,
      );
    }
    return handler;
  }
}
