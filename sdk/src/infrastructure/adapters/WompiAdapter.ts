import {
  PaymentGatewayPort,
  CreatePaymentRequest,
} from "../../application/ports/PaymentGatewayPort";
import { Transaction } from "../../domain/entities/Transaction";
import { Gateway } from "../../domain/value-objects/Gateway";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";
import { ResponseNormalizer } from "../../application/services/ResponseNormalizer";
import { WebhookVerifier } from "../../domain/services/WebhookVerifier";

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
 */
export class WompiAdapter implements PaymentGatewayPort {
  private readonly baseUrl: string;
  private readonly normalizer: ResponseNormalizer;
  private readonly webhookVerifier: WebhookVerifier;

  constructor(
    baseUrl: string = DEFAULT_WOMPI_URL,
    normalizer: ResponseNormalizer = new ResponseNormalizer(),
    webhookVerifier: WebhookVerifier = new WebhookVerifier()
  ) {
    this.baseUrl = baseUrl;
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

    let response: Response;

    // 2. Realizar petición HTTP con fetch nativo de Node.js
    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (networkError) {
      // Captura fallos de red (DNS, socket timeout, conexión rechazada)
      throw new SdkError(
        SdkErrorCode.CONNECTION_FAILED,
        Gateway.WOMPI,
        networkError,
        `Failed to connect to Wompi gateway: ${networkError instanceof Error ? networkError.message : String(networkError)}`
      );
    }

    // 3. Verificación de código de estado HTTP exitoso
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      throw new SdkError(
        SdkErrorCode.GATEWAY_SERVER_ERROR,
        Gateway.WOMPI,
        errorBody,
        `Wompi gateway returned an HTTP error status ${response.status}`
      );
    }

    // 4. Parseo de la respuesta JSON cruda
    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch (parseError) {
      throw new SdkError(
        SdkErrorCode.MALFORMED_RESPONSE,
        Gateway.WOMPI,
        parseError,
        "Failed to parse JSON response from Wompi gateway"
      );
    }

    // 5. Normalización hacia la entidad Transaction del dominio
    return this.normalizer.normalize(rawResponse, Gateway.WOMPI);
  }

  /**
   * El mock de Wompi (simulator-api) todavía no expone un endpoint de consulta
   * de estado; solo soporta la creación de transacciones.
   */
  async getStatus(_gatewayTransactionId: string): Promise<Transaction> {
    throw new SdkError(
      SdkErrorCode.UNSUPPORTED_OPERATION,
      Gateway.WOMPI,
      null,
      "WompiAdapter.getStatus: status query is not supported by the Wompi mock endpoint"
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
