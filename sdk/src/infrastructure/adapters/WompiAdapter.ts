import {
  PaymentGatewayPort,
  CreatePaymentRequest,
} from "../../application/ports/PaymentGatewayPort";
import { Transaction } from "../../domain/entities/Transaction";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { ResponseNormalizer } from "../../application/services/ResponseNormalizer";
import { WebhookVerifier } from "../../domain/services/WebhookVerifier";
import { ErrorHandler } from "../../application/services/ErrorHandler";

/**
 * URL base por defecto del endpoint mock de Wompi (simulator-api, issue #27).
 * Es configurable a través del constructor para permitir testing y ambientes diversos.
 */
const DEFAULT_WOMPI_URL = "http://localhost:3000/v1/sim/wompi/transactions";

/**
 * Adapter concreto de Wompi. Traduce las llamadas genéricas de
 * PaymentGatewayPort a peticiones HTTP contra la API de Wompi
 * (o su simulador local). Cumple con la arquitectura hexagonal (ADR-01):
 * ningún detalle nativo de Wompi se escapa hacia el dominio; las respuestas
 * son traducidas a Transaction a través de ResponseNormalizer.
 *
 * PATRÓN DE REFERENCIA PARA ADAPTADORES (Iteración 2):
 * Todos los adaptadores de pasarela (RapydAdapter, KushkiAdapter, MercadoPagoAdapter)
 * deben seguir este mismo patrón de manejo de errores:
 * 1. NUNCA construir KitPagosError directamente ni inline en el adaptador.
 * 2. Delegar la traducción, clasificación y sanitización al servicio de aplicación ErrorHandler.
 * 3. Instanciar ErrorHandler dentro del cuerpo de los métodos en vez de recibirlo en el constructor,
 *    respetando el umbral de Acoplamiento entre Objetos (CBO <= 5) exigido por el Definition of Done.
 */
export class WompiAdapter implements PaymentGatewayPort {
  private readonly baseUrl: string;
  private readonly credentials?: Credentials;
  private readonly normalizer: ResponseNormalizer;
  private readonly webhookVerifier: WebhookVerifier;

  /**
   * Las credenciales llegan resueltas desde el SdkConfigurator via
   * GatewayFactory; el Adapter nunca las lee del entorno. Son opcionales
   * porque el endpoint mock de la API de Simulacion no autentica, de modo que
   * el Adapter siga siendo instanciable sin configuracion en pruebas.
   */
  constructor(
    baseUrl: string = DEFAULT_WOMPI_URL,
    credentials?: Credentials,
    normalizer: ResponseNormalizer = new ResponseNormalizer(),
    webhookVerifier: WebhookVerifier = new WebhookVerifier()
  ) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.normalizer = normalizer;
    this.webhookVerifier = webhookVerifier;
  }

  async createPayment(request: CreatePaymentRequest): Promise<Transaction> {
    // 1. Mapeo de objetos de valor del dominio a campos nativos de Wompi
    const payload = {
      amount_in_cents: request.amount.toMinorUnits(),
      currency: request.currency.getCode(),
      reference: request.orderReference.getValue(),
      customer_email: request.payer.email,
    };

    // 2. Autenticación: Wompi identifica al comercio con su llave pública como
    //    Bearer token. Se omite el header cuando no hay credenciales para que el
    //    endpoint mock, que no autentica, siga siendo consumible sin configurar.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.credentials) {
      headers["Authorization"] = `Bearer ${this.credentials.publicKey}`;
    }

    let response: Response;

    // 3. Realizar petición HTTP con fetch nativo de Node.js
    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (networkError) {
      // Captura y traduce fallos de red delegando a ErrorHandler
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.WOMPI);
    }

    // 4. Verificación de código de estado HTTP exitoso
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      // Delegar error HTTP a ErrorHandler pasando { status, body }
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle({ status: response.status, body: errorBody }, Gateway.WOMPI);
    }

    // 5. Parseo de la respuesta JSON cruda
    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.WOMPI);
    }

    // 6. Normalización hacia la entidad Transaction del dominio
    return this.normalizer.normalize(rawResponse, Gateway.WOMPI);
  }

  /**
   * El mock de Wompi (simulator-api) todavía no expone un endpoint de consulta
   * de estado; solo soporta la creación de transacciones.
   */
  async getStatus(_gatewayTransactionId: string): Promise<Transaction> {
    const errorHandler = new ErrorHandler();
    throw errorHandler.handle(
      new Error("status query is not supported by the Wompi mock endpoint"),
      Gateway.WOMPI
    );
  }

  /**
   * Valida la firma del webhook delegando al servicio de dominio WebhookVerifier.
   */
  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string
  ): boolean {
    return this.webhookVerifier.verify(payload, headers, secret, Gateway.WOMPI);
  }
}
