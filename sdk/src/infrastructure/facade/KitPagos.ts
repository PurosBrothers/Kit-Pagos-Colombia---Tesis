import { Transaction } from "../../domain/entities/Transaction";
import { PaymentResult } from "../../domain/value-objects/PaymentResult";
import { WebhookEvent } from "../../domain/value-objects/WebhookEvent";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { SdkConfigurator, SDKOptions } from "../config/SDKConfigurator";
import { GatewayFactory } from "../factories/GatewayFactory";
import { WebhookVerifier } from "../../domain/services/WebhookVerifier";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { RetryHandler } from "../../application/services/RetryHandler";
import { PseBank } from "../../domain/value-objects/PseBank";

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
 * La operacion getPaymentStatus() esta envuelta en RetryHandler con retroceso
 * exponencial y jitter para tolerar fallos transitorios de red (SAD seccion 2.13).
 * Por seguridad transaccional e idempotencia, createPayment() NO se envuelve
 * en RetryHandler para evitar duplicidad de cobros (doble debito) ante timeouts
 * (ver docs/architecture/architecture-log.md, punto 35).
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

  /**
   * Crea un pago.
   *
   * Devuelve `PaymentResult` y no `Transaction` desde el issue #64. Hay que
   * distinguir los dos casos antes de usar el resultado:
   *
   * ```ts
   * const result = await kit.createPayment(request);
   * if (result.outcome === "REDIRECT_REQUIRED") {
   *   return res.redirect(result.redirect.redirectUrl);
   * }
   * console.log(result.transaction.getStatus());
   * ```
   *
   * El compilador obliga a esa distinción a propósito: con un campo opcional en
   * `Transaction`, olvidar la redirección compilaba y dejaba el pago colgado.
   */
  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    const adapter = this.resolveAdapter();
    return adapter.createPayment(request);
  }

  /**
   * Consulta el estado de una transaccion por su identificador.
   * Envuelto en RetryHandler para tolerar fallos transitorios de red con retroceso exponencial.
   */
  async getPaymentStatus(id: string): Promise<Transaction> {
    const adapter = this.resolveAdapter();
    const retryHandler = new RetryHandler({
      maxRetries: this.configurator.getMaxRetries(),
    });
    return retryHandler.execute(() => adapter.getStatus(id));
  }

  /**
   * Lista los bancos habilitados para PSE en la pasarela activa.
   *
   * Los `code` que devuelve van derecho a `PaymentMethod.pse({ bankCode })` sin
   * transformarlos, y **solo sirven en la pasarela que los dio**: cambiar de
   * pasarela obliga a volver a pedir la lista. Eso no es una fuga de la
   * abstracción sino la consecuencia de que cada pasarela identifique a los bancos
   * a su manera; lo que el SDK garantiza es que el comercio nunca tenga que saber
   * de qué manera.
   *
   * Va envuelto en `RetryHandler` como la consulta de estado, y por el mismo
   * motivo: es una lectura idempotente, así que reintentarla no puede cobrar dos
   * veces. `createPayment()` no lo está, precisamente porque no lo es.
   */
  async getPseBanks(): Promise<PseBank[]> {
    const adapter = this.resolveAdapter();
    const retryHandler = new RetryHandler({
      maxRetries: this.configurator.getMaxRetries(),
    });
    return retryHandler.execute(() => adapter.getPseBanks());
  }


  validateWebhook(
    payload: string,
    headers: Record<string, string>,
  ): WebhookEvent {
    const gateway = this.configurator.getActiveGateway();
    const credentials = this.configurator.getCredentials(gateway);
    const secret = credentials.privateKey;
    let isValid: boolean;
    try {
      isValid = this.verifier.verify(payload, headers, secret, gateway);
    } catch {
      isValid = false;
    }

    if (!isValid) {
      throw new KitPagosError(
        KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID,
        gateway,
        null,
        "Invalid webhook signature",
      );
    }
    return this.verifier.parse(payload, gateway);
  }
}
