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
 * URL base por defecto del endpoint mock de Mercado Pago (simulator-api).
 * En producción apuntaría a https://api.mercadopago.com/v1/payments.
 */
const DEFAULT_MERCADOPAGO_URL =
  "http://localhost:3000/v1/sim/mercadopago/payments";

/**
 * Adapter concreto de Mercado Pago.
 * Traduce las operaciones de PaymentGatewayPort hacia la API de Mercado Pago.
 *
 * Cumple con:
 * - Arquitectura Hexagonal (ADR-01): ningún detalle nativo de Mercado Pago sale del adaptador.
 * - Métrica CBO <= 5: ErrorHandler se instancia en el cuerpo de los métodos en caso de error.
 * - RF-08: Delegación a ErrorHandler para sanitizar tokens y credenciales.
 * - Monto en pesos decimales (`transaction_amount`), sin llamar a toMinorUnits().
 */
export class MercadoPagoAdapter implements PaymentGatewayPort {
  private readonly baseUrl: string;
  private readonly credentials?: Credentials;
  private readonly normalizer: ResponseNormalizer;
  private readonly webhookVerifier: WebhookVerifier;

  constructor(
    baseUrl: string = DEFAULT_MERCADOPAGO_URL,
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
    // 1. Mapeo de objetos de valor del dominio a campos nativos de Mercado Pago.
    //    A diferencia de Wompi, el monto viaja en pesos en `transaction_amount`,
    //    por lo que se usa getValue() en lugar de toMinorUnits().
    const payload = {
      transaction_amount: Number(request.amount.getValue()),
      description: request.orderReference.getValue(),
      external_reference: request.orderReference.getValue(),
      payer: {
        email: request.payer.email,
      },
    };

    // 2. Autenticación con Access Token privado de Mercado Pago
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.credentials?.privateKey) {
      headers["Authorization"] = `Bearer ${this.credentials.privateKey}`;
    }

    let response: Response;

    // 3. Petición HTTP POST
    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.MERCADOPAGO);
    }

    // 4. Verificación de respuesta HTTP no exitosa
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(
        { status: response.status, body: errorBody },
        Gateway.MERCADOPAGO
      );
    }

    // 5. Parseo de respuesta JSON cruda
    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.MERCADOPAGO);
    }

    // 6. Normalización hacia Transaction
    return this.normalizer.normalize(rawResponse, Gateway.MERCADOPAGO);
  }

  /**
   * Consulta el estado de un pago existente en Mercado Pago mediante GET /v1/payments/:id.
   */
  async getStatus(gatewayTransactionId: string): Promise<Transaction> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/${gatewayTransactionId}`;

    const headers: Record<string, string> = {};
    if (this.credentials?.privateKey) {
      headers["Authorization"] = `Bearer ${this.credentials.privateKey}`;
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        headers,
      });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.MERCADOPAGO);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(
        { status: response.status, body: errorBody },
        Gateway.MERCADOPAGO
      );
    }

    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.MERCADOPAGO);
    }

    return this.normalizer.normalize(rawResponse, Gateway.MERCADOPAGO);
  }

  /**
   * Valida la firma del webhook delegando en WebhookVerifier.
   */
  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string
  ): boolean {
    return this.webhookVerifier.verify(
      payload,
      headers,
      secret,
      Gateway.MERCADOPAGO
    );
  }
}
