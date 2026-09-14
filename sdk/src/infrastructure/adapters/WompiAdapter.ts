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
 * Default base URL for the Wompi mock endpoint (simulator-api, issue #27).
 * Configurable through the constructor to support testing and different environments.
 */
const DEFAULT_WOMPI_BASE_URL = "http://localhost:3000/v1/sim/wompi/transactions";

/**
 * Concrete Wompi adapter. Translates generic PaymentGatewayPort calls into
 * HTTP requests against the Wompi API (or its local simulator). Complies with
 * the hexagonal architecture (ADR-01): no native Wompi detail leaks into the
 * domain; responses are translated to Transaction through ResponseNormalizer.
 *
 * REFERENCE PATTERN FOR ADAPTERS (Iteration 2):
 * All gateway adapters (RapydAdapter, KushkiAdapter, MercadoPagoAdapter)
 * must follow this same error handling pattern:
 * 1. NEVER build KitPagosError directly or inline inside the adapter.
 * 2. Delegate translation, classification and sanitization to ErrorHandler.
 * 3. Instantiate ErrorHandler inside the method body instead of receiving it
 *    in the constructor, respecting the Coupling Between Objects threshold
 *    (CBO <= 5) required by the Definition of Done.
 */
export class WompiAdapter implements PaymentGatewayPort {
  private readonly baseUrl: string;
  private readonly credentials?: Credentials;
  private readonly normalizer: ResponseNormalizer;
  private readonly webhookVerifier: WebhookVerifier;

  /**
   * Credentials are resolved by SdkConfigurator via GatewayFactory; the
   * adapter never reads them from the environment. They are optional because
   * the simulation API mock endpoint does not authenticate, so the adapter
   * remains instantiable without configuration in tests.
   */
  constructor(
    baseUrl: string = DEFAULT_WOMPI_BASE_URL,
    credentials?: Credentials,
    normalizer: ResponseNormalizer = new ResponseNormalizer(),
    webhookVerifier: WebhookVerifier = new WebhookVerifier(),
  ) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.normalizer = normalizer;
    this.webhookVerifier = webhookVerifier;
  }

  async createPayment(request: CreatePaymentRequest): Promise<Transaction> {
    // 1. Map domain value objects to native Wompi fields.
    //
    //    `toMinorUnits()` returns a digit string, and Wompi expects a JSON
    //    integer in `amount_in_cents`. The conversion to `number` happens here,
    //    at the boundary between the SDK and the wire format: JSON only has the
    //    `number` type (an IEEE 754 double) and there is no way around it. It
    //    is safe because the value is already an integer of cents, well below
    //    Number.MAX_SAFE_INTEGER, so the conversion loses no precision. What the
    //    domain guarantees is that the integer was computed without floating-point
    //    arithmetic.
    const payload = {
      amount_in_cents: Number(request.amount.toMinorUnits(request.currency)),
      currency: request.currency.getCode(),
      reference: request.orderReference.getValue(),
      customer_email: request.payer.email,
    };

    // 2. Authentication: Wompi identifies the merchant with its public key as a
    //    Bearer token. The header is omitted when there are no credentials so
    //    the mock endpoint, which does not authenticate, remains consumable
    //    without configuration.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.credentials) {
      headers["Authorization"] = `Bearer ${this.credentials.publicKey}`;
    }

    let response: Response;

    // 3. Perform HTTP request with Node.js native fetch.
    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.WOMPI);
    }

    // 4. Verify successful HTTP status code.
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle({ status: response.status, body: errorBody }, Gateway.WOMPI);
    }

    // 5. Parse raw JSON response.
    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.WOMPI);
    }

    // 6. Normalize to the domain Transaction entity.
    return this.normalizer.normalize(rawResponse, Gateway.WOMPI);
  }

  /**
   * Queries the status of a transaction by its native Wompi identifier.
   *
   * Calls GET /v1/sim/wompi/transactions/:id on the simulator, normalizes the
   * response with ResponseNormalizer and returns the updated Transaction.
   * A non-existent id produces an HTTP 404 that ErrorHandler translates to
   * KitPagosError(RESOURCE_NOT_FOUND).
   */
  async getStatus(gatewayTransactionId: string): Promise<Transaction> {
    const statusUrl = `${this.baseUrl}/${gatewayTransactionId}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.credentials) {
      headers["Authorization"] = `Bearer ${this.credentials.publicKey}`;
    }

    let response: Response;

    // 1. Perform GET request to the status endpoint.
    try {
      response = await fetch(statusUrl, {
        method: "GET",
        headers,
      });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.WOMPI);
    }

    // 2. A 404 from the simulator means the id does not exist in the store.
    //    ErrorHandler maps it to KitPagosError(RESOURCE_NOT_FOUND).
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle({ status: response.status, body: errorBody }, Gateway.WOMPI);
    }

    // 3. Parse raw JSON response.
    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.WOMPI);
    }

    // 4. Normalize to the domain Transaction entity.
    return this.normalizer.normalize(rawResponse, Gateway.WOMPI);
  }

  /**
   * Validates a webhook signature by delegating to the WebhookVerifier domain service.
   */
  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    return this.webhookVerifier.verify(payload, headers, secret, Gateway.WOMPI);
  }
}