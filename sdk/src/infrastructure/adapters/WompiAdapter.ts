import {
  PaymentGatewayPort,
  CreatePaymentRequest,
} from "../../application/ports/PaymentGatewayPort";
import { Transaction } from "../../domain/entities/Transaction";
import {
  PaymentResult,
  redirectRequired,
  transactionResult,
} from "../../domain/value-objects/PaymentResult";
import {
  buildPseFieldsFor,
  buildWompiPayload,
  extractAcceptanceToken,
  resolvePendingRedirect,
  parseWompiPseBanks,
} from "./wompi-pse";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { ResponseNormalizer } from "../../application/services/ResponseNormalizer";
import { WebhookVerifier } from "../../domain/services/WebhookVerifier";
import { ErrorHandler } from "../../application/services/ErrorHandler";
import { assertSupportedPaymentMethod } from "./payment-method-support";
import type { PseBank } from "../../domain/value-objects/PseBank";

/**
 * Raíz de la API de Wompi en la API de Simulación (issue #27).
 *
 * Desde el issue #64 esto es la **raíz** y no el endpoint de transacciones. El
 * cambio fue forzado por PSE: el flujo necesita `GET /merchants/{llave}` para el
 * token de aceptación, y con un `baseUrl` que apuntaba directamente a
 * `/transactions` esa segunda ruta no tenía dónde vivir. Un `baseUrl` que apunta
 * a un solo endpoint tampoco era una URL base.
 *
 * Es un cambio incompatible para quien sobrescribiera `baseUrl`, y se hizo ahora
 * a propósito: el paquete todavía no está publicado en npm (issue #88), así que
 * este es el único momento en que corregirlo no le cuesta nada a nadie.
 */
const DEFAULT_WOMPI_BASE_URL = "http://localhost:3000/v1/sim/wompi";

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
  /**
   * Se construye acá en vez de recibirse por constructor, por la misma razón que
   * ErrorHandler y que RetryHandler en la fachada (architecture-log.md, punto 35):
   * un colaborador en la firma del constructor cuenta para el CBO, y el umbral de
   * la Definition of Done es 5. No se pierde nada: el normalizador no tiene
   * estado ni configuración, y ninguna prueba lo sustituía.
   */
  private readonly normalizer = new ResponseNormalizer();
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
    webhookVerifier: WebhookVerifier = new WebhookVerifier(),
  ) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.webhookVerifier = webhookVerifier;
  }

  /**
   * Crea un pago con tarjeta o con PSE.
   *
   * Devuelve `PaymentResult` porque los dos caminos no terminan igual: la tarjeta
   * se resuelve en la respuesta, PSE no. Ver `wompi-pse.ts` para lo que se midió
   * contra el sandbox real y por qué PSE necesita un sondeo.
   */
  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    // Wompi es hoy la única que sabe cobrar por PSE. `CASH` (Efecty y
    // equivalentes) sigue sin implementarse en ninguna.
    assertSupportedPaymentMethod(request.paymentMethod, Gateway.WOMPI, ["CARD", "PSE"]);

    // `toMinorUnits()` devuelve una cadena de dígitos y Wompi espera un entero
    // JSON. La conversión a `number` ocurre acá, en la frontera entre el SDK y el
    // formato de cable: JSON solo tiene `number` (un IEEE 754 double) y no hay
    // manera de evitarlo. Es segura porque el valor ya es un entero de centavos
    // muy por debajo de Number.MAX_SAFE_INTEGER. Lo que el dominio garantiza es
    // que ese entero se calculó sin aritmética de punto flotante.
    const amountInCents = Number(request.amount.toMinorUnits(request.currency));
    const currency = request.currency.getCode();
    const reference = request.orderReference.getValue();

    const payload = buildWompiPayload({
      amountInCents,
      currency,
      reference,
      customerEmail: request.payer.email,
      pseFields: buildPseFieldsFor(request.paymentMethod, request.payer, reference),
      // Wompi acepta una sola URL de retorno, mientras que ReturnUrlConfig
      // admite una por resultado. Se resuelve con "PENDING" porque es el estado
      // en el que la transacción está cuando se redirige al pagador. Si el
      // comercio configuró URLs diferenciadas, las otras dos se pierden: es una
      // limitación de Wompi, no del SDK, y conviene que quede escrita.
      redirectUrl: request.returnUrlConfig?.resolveFor("PENDING") ?? undefined,
      acceptanceToken: await this.fetchAcceptanceToken(),
      integritySecret: this.credentials?.integritySecret,
    });

    const rawResponse = await this.request(
      `${this.baseUrl}/transactions`,
      "POST",
      JSON.stringify(payload),
    );

    if (request.paymentMethod?.type === "PSE") {
      // La respuesta de creación de un PSE no trae la URL de redirección, así que
      // hay que consultar hasta que aparezca. El lector se pasa como argumento
      // para que la mecánica del sondeo no necesite saber de HTTP.
      return redirectRequired(
        await resolvePendingRedirect(rawResponse, (id) =>
          this.request(`${this.baseUrl}/transactions/${id}`, "GET"),
        ),
      );
    }

    return transactionResult(this.normalizer.normalize(rawResponse, Gateway.WOMPI));
  }

  /**
   * Consulta el estado de una transacción por su identificador nativo.
   *
   * Un id inexistente produce un HTTP 404 que ErrorHandler traduce a
   * KitPagosError(RESOURCE_NOT_FOUND).
   */
  async getStatus(gatewayTransactionId: string): Promise<Transaction> {
    const rawResponse = await this.request(
      `${this.baseUrl}/transactions/${gatewayTransactionId}`,
      "GET",
    );
    return this.normalizer.normalize(rawResponse, Gateway.WOMPI);
  }

  /**
   * Lista los bancos habilitados para PSE.
   *
   * Wompi es la única de las cuatro con un endpoint dedicado a esto,
   * `GET /v1/pse/financial_institutions`, y se autentica con la llave pública
   * como el resto de sus lecturas.
   *
   * **En sandbox la lista no son bancos.** Devuelve tres entidades llamadas
   * "Banco que aprueba", "Banco que declina" y "Banco que simula un error", con
   * códigos 1, 2 y 3, que son las que fuerzan cada desenlace (punto 43). El SDK las
   * pasa tal cual: disimularlas con nombres que parezcan de producción le
   * esconderia al comercio contra qué entorno está apuntando.
   */
  async getPseBanks(): Promise<PseBank[]> {
    const rawResponse = await this.request(
      `${this.baseUrl}/pse/financial_institutions`,
      "GET",
    );
    return parseWompiPseBanks(rawResponse);
  }

  /**
   * Pide un token de aceptación de términos, que Wompi exige para crear.
   *
   * Es de un solo uso: hay que pedir uno nuevo por transacción, y reutilizarlo
   * da "El token de aceptación ya fue usado". Se omite sin credenciales porque
   * sin llave pública no hay a quién preguntarle, y la API de simulación no lo
   * valida.
   */
  private async fetchAcceptanceToken(): Promise<string | undefined> {
    if (!this.credentials) {
      return undefined;
    }
    const rawResponse = await this.request(
      `${this.baseUrl}/merchants/${this.credentials.publicKey}`,
      "GET",
    );
    return extractAcceptanceToken(rawResponse);
  }

  /**
   * Una petición HTTP con su manejo de errores y su parseo.
   *
   * Estaba duplicada entre `createPayment` y `getStatus`, y con PSE habría
   * quedado cuatro veces. Consolidarla bajó la complejidad de los dos métodos
   * públicos en vez de subirla, que era la preocupación de la Definition of Done
   * (el WompiAdapter ya estaba en CBO 5 de 5).
   */
  private async request(url: string, method: string, body?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.credentials) {
      headers["Authorization"] = `Bearer ${this.credentials.publicKey}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (networkError) {
      throw new ErrorHandler().handle(networkError, Gateway.WOMPI);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      throw new ErrorHandler().handle(
        { status: response.status, body: errorBody },
        Gateway.WOMPI,
      );
    }

    try {
      return await response.json();
    } catch (parseError) {
      throw new ErrorHandler().handle(parseError, Gateway.WOMPI);
    }
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