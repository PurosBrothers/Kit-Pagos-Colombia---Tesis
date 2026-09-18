import {
  PaymentGatewayPort,
  CreatePaymentRequest,
} from "../../application/ports/PaymentGatewayPort";
import { Transaction } from "../../domain/entities/Transaction";
import {
  PaymentResult,
  transactionResult,
} from "../../domain/value-objects/PaymentResult";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { ResponseNormalizer } from "../../application/services/ResponseNormalizer";
import { WebhookVerifier } from "../../domain/services/WebhookVerifier";
import { ErrorHandler } from "../../application/services/ErrorHandler";
import { TaxBreakdown } from "../../domain/value-objects/TaxBreakdown";

const DEFAULT_KUSHKI_BASE_URL =
  "http://localhost:3000/v1/sim/kushki/charges";

export class KushkiAdapter implements PaymentGatewayPort {
  private readonly baseUrl: string;
  private readonly credentials?: Credentials;
  /** Ver la nota de WompiAdapter: fuera del constructor para no inflar el CBO. */
  private readonly normalizer = new ResponseNormalizer();
  private readonly webhookVerifier: WebhookVerifier;

  constructor(
    baseUrl: string = DEFAULT_KUSHKI_BASE_URL,
    credentials?: Credentials,
    webhookVerifier: WebhookVerifier = new WebhookVerifier(),
  ) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.webhookVerifier = webhookVerifier;
  }

  /**
   * Devuelve PaymentResult en vez de Transaction desde el issue #64. El cobro
   * con tarjeta de Kushki es sincrono —el resultado viene en la respuesta del
   * POST y no existe un estado intermedio—, asi que este adaptador siempre toma
   * la rama TRANSACTION. La rama de redireccion le corresponde a Transfer In,
   * que es el PSE de Kushki y no esta implementado todavia.
   */
  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    /*
     * Kushki requires the amount to be split into subtotalIva0,
     * subtotalIva, iva and ice.
     *
     * The domain does not model Colombian tax rules yet, so when the
     * merchant does not provide a tax breakdown we deliberately treat
     * the complete amount as exempt.
     */
    const taxBreakdown =
        request.taxBreakdown ??
        TaxBreakdown.exempt(request.amount, request.currency);

        if (!taxBreakdown.getTotal().equals(request.amount)) {
            throw new Error(
                "Kushki tax breakdown does not match the payment amount",
            );
    }

    const payload = {
        token: "simulated-token",
        amount: {
            // Kushki recibe los componentes tributarios en pesos nominales.
            // Para COP, 50.000 COP se representa como 50000, no 5000000.
            subtotalIva0: Number(taxBreakdown.subtotalIva0.getValue()),
            subtotalIva: Number(taxBreakdown.subtotalIva.getValue()),
            iva: Number(taxBreakdown.iva.getValue()),
            ice: Number(taxBreakdown.ice.getValue()),
            currency: request.currency.getCode(),
        },
        contactDetails: {
            email: request.payer.email,
        },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.credentials) {
      headers["Private-Merchant-Id"] = this.credentials.privateKey;
    }

    let response: Response;

    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.KUSHKI);
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
        {
          status: response.status,
          body: errorBody,
        },
        Gateway.KUSHKI,
      );
    }

    let rawResponse: unknown;

    try {
      rawResponse = await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.KUSHKI);
    }

    return transactionResult(
      this.normalizer.normalize(rawResponse, Gateway.KUSHKI),
    );
  }

  async getStatus(gatewayTransactionId: string): Promise<Transaction> {
    const statusUrl = `${this.baseUrl}/${gatewayTransactionId}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.credentials) {
      headers["Private-Merchant-Id"] = this.credentials.privateKey;
    }

    let response: Response;

    try {
      response = await fetch(statusUrl, {
        method: "GET",
        headers,
      });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.KUSHKI);
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
        {
          status: response.status,
          body: errorBody,
        },
        Gateway.KUSHKI,
      );
    }

    let rawResponse: unknown;

    try {
      rawResponse = await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.KUSHKI);
    }

    return this.normalizer.normalize(rawResponse, Gateway.KUSHKI);
  }

  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    return this.webhookVerifier.verify(
      payload,
      headers,
      secret,
      Gateway.KUSHKI,
    );
  }
}
