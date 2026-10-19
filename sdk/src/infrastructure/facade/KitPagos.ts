import { Transaction } from "../../domain/entities/Transaction";
import { PaymentResult } from "../../domain/value-objects/PaymentResult";
import { WebhookEvent } from "../../domain/value-objects/WebhookEvent";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { SdkConfigurator, SDKOptions } from "../config/SDKConfigurator";
import { GatewayFactory } from "../factories/GatewayFactory";
import {
  IncomingWebhook,
  WebhookSigningContext,
  WebhookVerifier,
  WebhookVerificationOptions,
} from "../../domain/services/WebhookVerifier";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { RetryHandler } from "../../application/services/RetryHandler";
import { PseBank } from "../../domain/value-objects/PseBank";
import { Gateway } from "../../domain/value-objects/Gateway";

export { WebhookVerificationOptions } from "../../domain/services/WebhookVerifier";

/**
 * Opciones de `validateWebhook()`.
 *
 * Extiende las de verificación en vez de reemplazarlas porque `gateway` no es una opción de
 * verificación: los manejadores de firma no deben saber a cuál pasarela pertenecen, solo
 * cómo verificar lo que les llega. La frescura sí baja hasta ellos; el enrutamiento se queda
 * en la fachada.
 */
export interface ValidateWebhookOptions extends WebhookVerificationOptions {
  /** Pasarela emisora. Por defecto: la activa. Solo necesita estar en `credentials`, no activa. */
  gateway?: Gateway;
  /**
   * Parámetros de la URL con que llegó el webhook (`req.query`). Mercado Pago firma el
   * `data.id` que viaja ahí y no el del cuerpo; sin ellos se verifica con el del cuerpo,
   * que coincide en la Payments API pero no en los ids alfanuméricos de la Orders API.
   */
  query?: Record<string, string>;
}

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
    return this.factory.create(
      gateway,
      credentials,
      this.configurator.getBaseUrl(gateway),
      this.configurator.getTimeoutMs(),
    );
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
    const gateway = this.configurator.getActiveGateway();
    assertValidCreatePaymentRequest(request, gateway);
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


  /**
   * Verifica la firma de un webhook y devuelve el evento normalizado (RF-04).
   *
   * El tercer parámetro es una bolsa de opciones, toda opcional. `gateway` existe porque sin
   * él **este método no servía justo en el caso que el SDK dice resolver**: en una migración,
   * el comercio cobra por la pasarela nueva y sigue recibiendo webhooks de la vieja durante
   * semanas —pagos ya iniciados, conciliaciones, reembolsos— y todos esos llegan de una
   * pasarela que no es la activa. La única salida era instanciar un segundo `KitPagos` con
   * otra configuración, que es exactamente la contorsión que el framework existe para evitar.
   *
   * ```ts
   * app.post("/webhooks/:pasarela", (req, res) => {
   *   const evento = kit.validateWebhook(req.rawBody, req.headers, {
   *     gateway: PASARELAS[req.params.pasarela],
   *     query: req.query,
   *   });
   * });
   * ```
   *
   * Va aquí y no en la configuración porque **quién manda el webhook lo decide el endpoint que
   * lo recibió, no el estado del SDK**: el comercio ya sabe de quién es, y hacerlo elegir por
   * configuración obligaría a mutar el SDK entre dos peticiones HTTP concurrentes. La pasarela
   * solo tiene que estar en `credentials`, no activa. `toleranceSeconds` es lo contrario: tiene
   * un valor global razonable en `SDKOptions`, y aquí solo se sobreescribe cuando un endpoint
   * concreto necesita otra ventana.
   *
   * Agregar un parámetro opcional no rompe a nadie que ya llame con dos argumentos, lo cual
   * importa porque este cambio entra justo antes de publicar en npm.
   */
  validateWebhook(
    payload: string,
    headers: Record<string, string>,
    options?: ValidateWebhookOptions,
  ): WebhookEvent {
    const gateway = options?.gateway ?? this.configurator.getActiveGateway();
    const credentials = this.configurator.getCredentials(gateway);

    /*
     * El secreto de webhooks no es la llave de API en tres de las cuatro pasarelas, así
     * que se prefiere `webhookSecret` y se cae a `privateKey` cuando falta. El respaldo es
     * correcto en Rapyd, que reutiliza su llave de verdad, y es solo compatibilidad hacia
     * atrás en las otras tres, donde contra la pasarela real va a fallar la verificación.
     * La tabla de dónde sale el valor en cada una está en `Credentials.webhookSecret`.
     */
    const context: WebhookSigningContext = {
      secret: credentials.webhookSecret ?? credentials.privateKey,
      publicKey: credentials.publicKey,
      webhookUrl: credentials.webhookUrl,
    };
    const webhook: IncomingWebhook = { payload, headers, query: options?.query };

    const verificationOptions: WebhookVerificationOptions = {
      toleranceSeconds: options?.toleranceSeconds ?? this.configurator.getWebhookToleranceSeconds(),
      currentTimestamp: options?.currentTimestamp,
    };
    let isValid: boolean;
    try {
      isValid = this.verifier.verify(webhook, context, gateway, verificationOptions);
    } catch (error) {
      // Una configuración incompleta llega ya tipada y no es un webhook malformado:
      // reportarla como tal escondería al comercio que el problema es suyo.
      if (error instanceof KitPagosError) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : "Malformed webhook payload or headers";
      throw new KitPagosError(
        KitPagosErrorCode.MALFORMED_RESPONSE,
        gateway,
        null,
        `Malformed webhook: ${msg}`,
      );
    }

    if (!isValid) {
      throw new KitPagosError(
        KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID,
        gateway,
        null,
        "Invalid webhook signature",
      );
    }

    try {
      return this.verifier.parse(webhook, gateway);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to parse webhook payload";
      throw new KitPagosError(
        KitPagosErrorCode.MALFORMED_RESPONSE,
        gateway,
        null,
        `Malformed webhook: ${msg}`,
      );
    }
  }
}

/**
 * Valida la presencia de los objetos de valor obligatorios en CreatePaymentRequest.
 * Se extrae como función pura de módulo para no sumar WMC ni MAX_CC a la clase KitPagos.
 */
function assertValidCreatePaymentRequest(
  request: CreatePaymentRequest,
  gateway: Gateway,
): void {
  const missing: string[] = [];
  if (!request?.amount) missing.push("amount");
  if (!request?.currency) missing.push("currency");
  if (!request?.orderReference) missing.push("orderReference");
  if (!request?.payer) missing.push("payer");

  if (missing.length > 0) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      gateway,
      null,
      `CreatePaymentRequest requiere los siguientes campos obligatorios: ${missing.join(", ")}`,
    );
  }
}
