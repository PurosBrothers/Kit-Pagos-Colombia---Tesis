import { Transaction } from "../../domain/entities/Transaction";
import { WebhookEvent } from "../../domain/value-objects/WebhookEvent";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { SdkConfigurator, SDKOptions } from "../config/SDKConfigurator";
import { GatewayFactory } from "../factories/GatewayFactory";
import { WebhookVerifier } from "../../domain/services/WebhookVerifier";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";

/**
 * Unica clase que el desarrollador que consume el SDK instancia directamente.
 * Fuente: SAD, seccion 9.1.1 (Payment Facade) y Component Diagram - C4.png,
 * que coinciden en createPayment(), getPaymentStatus() y validateWebhook()
 * como los tres metodos publicos del SDK. La seccion 15.2 usa nombres
 * distintos (getStatus, verifyWebhook); se prioriza la version que coincide
 * en mas artefactos del SAD (ver docs/architecture/architecture-log.md,
 * punto 1).
 *
 * validateWebhook() retorna WebhookEvent en lugar de boolean para cumplir
 * RF-04 ("retornar un evento normalizado si la firma es valida"), ver
 * docs/architecture/architecture-log.md, punto 6.
 *
 * El diagrama de clases hexagonal del SAD muestra que esta fachada envuelve
 * la llamada en RetryHandler. Todavia no lo hace, porque RetryHandler sigue
 * siendo un esqueleto y reintentar contra la API de Simulacion, que responde
 * de forma determinista, no ejercitaria nada. Se integra en la Iteracion 2
 * junto con las pasarelas reales (ver docs/architecture/architecture-log.md,
 * punto 20).
 */


export class KitPagos {
  private configurator: SdkConfigurator;
  private factory: GatewayFactory;
  private verifier: WebhookVerifier;

  constructor(options?:SDKOptions) {
    this.configurator = new SdkConfigurator();
    this.factory = new GatewayFactory();
    this.verifier = new WebhookVerifier();

    if (options){
       // Aquí se alimenta nuestro SdkConfigurator con las credenciales:
      this.configurator.configure(options);
    }
  }

  /**
   * Resuelve el Adapter de la pasarela activa.
   *
   * Los tipos de la pasarela, sus credenciales y el puerto quedan inferidos y
   * no se anotan: son detalle interno de la fachada, cuya firma publica solo
   * debe hablar de CreatePaymentRequest y Transaction.
   */
  private resolveAdapter() {
    const gateway = this.configurator.getActiveGateway();
    const credentials = this.configurator.getCredentials(gateway);
    return this.factory.create(gateway, credentials, this.configurator.getBaseUrl());
  }

  async createPayment(request: CreatePaymentRequest): Promise<Transaction> {
    const adapter = this.resolveAdapter();
    return adapter.createPayment(request);
  }

  /**
   * Para Wompi propaga SdkError(UNSUPPORTED_OPERATION): la API de Simulacion
   * todavia no expone consulta de estado, solo creacion (issue #27).
   */
  async getPaymentStatus(id: string): Promise<Transaction> {
    const adapter = this.resolveAdapter();
    return adapter.getStatus(id);
  }

  validateWebhook(
    payload: string,
    headers: Record<string, string>,
  ): WebhookEvent {
    const gateway = this.configurator.getActiveGateway();
    const credentials = this.configurator.getCredentials(gateway);
    const secret = credentials.privateKey;
    let isValid = false;
    try {
      isValid = this.verifier.verify(payload, headers, secret, gateway);
    } catch {
      isValid = false;
    }

    if (!isValid) {
      throw new SdkError(
        SdkErrorCode.WEBHOOK_SIGNATURE_INVALID,
        gateway,
        null,
        "Invalid webhook signature",
      );
    }
    return this.verifier.parse(payload, gateway);
  }
}
