import { randomUUID } from "crypto";
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
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { ResponseNormalizer } from "../../application/services/ResponseNormalizer";
import { WebhookVerifier } from "../../domain/services/WebhookVerifier";
import { ErrorHandler } from "../../application/services/ErrorHandler";
import {
  assertSupportedPaymentMethod,
  requireCardToken,
  resolveInstallments,
} from "./payment-method-support";
import {
  assertPseRequirements,
  buildPseOrderPayload,
  extractOrderRedirect,
  isOrderId,
  parseMercadoPagoPseBanks,
} from "./mercadopago-pse";
import type { PseBank } from "../../domain/value-objects/PseBank";

/**
 * Raíz de la API de Mercado Pago en la API de Simulación.
 *
 * Desde el issue #64 esto es la **raíz** y no el endpoint de pagos. El cambio lo
 * forzó PSE, que no se cobra por la Payments API sino por la Orders API, o sea
 * que el adaptador pasó a necesitar dos rutas (`/payments` y `/orders`) y un
 * `baseUrl` que apuntaba a una sola no tenía dónde colgar la otra. En producción
 * apuntaría a `https://api.mercadopago.com/v1`.
 *
 * Es un cambio incompatible para quien sobrescribiera `baseUrl`, y se hace ahora
 * a propósito por lo mismo que en Wompi: el paquete todavía no está publicado en
 * npm (issue #88), así que es el único momento en que corregirlo no le cuesta
 * nada a nadie.
 */
const DEFAULT_MERCADOPAGO_BASE_URL = "http://localhost:3000/v1/sim/mercadopago";

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
  /** Ver la nota de WompiAdapter: fuera del constructor para no inflar el CBO. */
  private readonly normalizer = new ResponseNormalizer();
  private readonly webhookVerifier: WebhookVerifier;

  constructor(
    baseUrl: string = DEFAULT_MERCADOPAGO_BASE_URL,
    credentials?: Credentials,
    webhookVerifier: WebhookVerifier = new WebhookVerifier()
  ) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.webhookVerifier = webhookVerifier;
  }

  /**
   * Crea un pago con tarjeta o con PSE.
   *
   * Los dos caminos usan APIs distintas de Mercado Pago, no solo payloads
   * distintos: tarjeta va por la Payments API y resuelve en la misma respuesta,
   * PSE va por la Orders API y devuelve una redirección. El detalle de por qué,
   * con lo que se midió contra la API real, está en `mercadopago-pse.ts`.
   */
  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    assertSupportedPaymentMethod(request.paymentMethod, Gateway.MERCADOPAGO, [
      "CARD",
      "PSE",
    ]);

    if (request.paymentMethod?.type === "PSE") {
      // Se valida antes de armar el payload para que un dato faltante no se
      // descubra por un HTTP 400: la Orders API exige nombre, teléfono,
      // dirección e IP del pagador, que el dominio deja opcionales.
      assertPseRequirements(request);

      const rawResponse = await this.request(
        `${this.baseUrl}/orders`,
        "POST",
        JSON.stringify(buildPseOrderPayload(request)),
      );

      // La URL del banco ya viene en la creación, así que no hay sondeo como en
      // Wompi. Ver el punto 4 de `mercadopago-pse.ts`.
      return redirectRequired(extractOrderRedirect(rawResponse));
    }

    // Mapeo de objetos de valor del dominio a campos nativos de Mercado Pago.
    // A diferencia de Wompi, el monto viaja en pesos en `transaction_amount`,
    // por lo que se usa getValue() en lugar de toMinorUnits().
    //
    // `token` e `installments` son obligatorios y están medidos contra la API real: sin
    // token responde `400 "payment_method_id attribute can't be null"` y sin cuotas
    // `400 "Invalid installments"`. Lo que **no** hace falta es `payment_method_id`: con
    // el token, Mercado Pago deduce la marca y la devuelve resuelta en la respuesta
    // (`"visa"`). Por eso el SDK no le pide al comercio un dato de pasarela que la
    // pasarela ya sabe: sería el primer campo específico de proveedor en la API pública.
    const payload = {
      transaction_amount: Number(request.amount.getValue()),
      description: request.orderReference.getValue(),
      external_reference: request.orderReference.getValue(),
      token: requireCardToken(
        request.paymentMethod,
        Gateway.MERCADOPAGO,
        "POST /v1/card_tokens",
      ),
      installments: resolveInstallments(request.paymentMethod),
      payer: {
        email: request.payer.email,
      },
    };

    const rawResponse = await this.request(
      `${this.baseUrl}/payments`,
      "POST",
      JSON.stringify(payload),
    );

    return transactionResult(
      this.normalizer.normalize(rawResponse, Gateway.MERCADOPAGO),
    );
  }

  /**
   * Consulta el estado de un pago existente.
   *
   * Elige el endpoint según la forma del identificador porque Mercado Pago tiene
   * dos familias de recursos: las órdenes de PSE se consultan en `/orders/{id}` y
   * los pagos con tarjeta en `/payments/{id}`. Ver `isOrderId()`.
   */
  async getStatus(gatewayTransactionId: string): Promise<Transaction> {
    const root = this.baseUrl.replace(/\/+$/, "");
    const resource = isOrderId(gatewayTransactionId) ? "orders" : "payments";
    const rawResponse = await this.request(
      `${root}/${resource}/${gatewayTransactionId}`,
      "GET",
    );

    return this.normalizer.normalize(rawResponse, Gateway.MERCADOPAGO);
  }

  /**
   * Lista los bancos habilitados para PSE.
   *
   * Mercado Pago no tiene endpoint de bancos: tiene uno de métodos de pago, y las
   * entidades vienen anidadas en la entrada `pse`. Por eso la ruta acá es
   * `/payment_methods` y el filtrado vive en `parseMercadoPagoPseBanks`, que es
   * donde se conoce la forma nativa.
   */
  async getPseBanks(): Promise<PseBank[]> {
    const rawResponse = await this.request(
      `${this.baseUrl}/payment_methods`,
      "GET",
    );
    return parseMercadoPagoPseBanks(rawResponse);
  }

  /**
   * Una petición HTTP con su manejo de errores y su parseo.
   *
   * Consolidada por la misma razón que en WompiAdapter: estaba duplicada entre
   * `createPayment` y `getStatus`, y con PSE habría quedado tres veces.
   *
   * ## `X-Idempotency-Key` en cada POST
   *
   * Mercado Pago **no crea nada sin ese header**, y es la única de las cuatro que lo exige.
   * Medido con las pruebas de contra sandbox (`test/sandbox/`): `POST /v1/payments` responde
   * `400 "Header X-Idempotency-Key can't be null"` y `POST /v1/orders`, que es por donde va
   * PSE, `400 "Missing HTTP header: X-Idempotency-Key."`. O sea que sin esto el SDK no podía
   * cobrar en Mercado Pago **por ningún método**, y no se había visto porque las mediciones a
   * mano mandaban el header y el simulador no lo pedía.
   *
   * Es un valor nuevo por llamada y no derivado de `orderReference`, que era la alternativa
   * tentadora: con la referencia como llave, dos intentos de cobrar la misma orden producirían
   * un solo cobro, lo cual suena a más seguridad. El problema es que Mercado Pago devuelve la
   * respuesta original para una llave repetida, así que un cobro rechazado quedaría
   * incobrable: reintentarlo con otra tarjeta sobre la misma orden devolvería el rechazo
   * viejo. La protección contra el doble débito en este SDK es otra y ya está tomada:
   * `createPayment()` es la única operación que **no** se envuelve en `RetryHandler`
   * (punto 35 del `architecture-log.md`).
   */
  private async request(url: string, method: string, body?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.credentials?.privateKey) {
      headers["Authorization"] = `Bearer ${this.credentials.privateKey}`;
    }
    if (method === "POST") {
      headers["X-Idempotency-Key"] = randomUUID();
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (networkError) {
      throw new ErrorHandler().handle(networkError, Gateway.MERCADOPAGO);
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
        Gateway.MERCADOPAGO,
      );
    }

    try {
      return await response.json();
    } catch (parseError) {
      throw new ErrorHandler().handle(parseError, Gateway.MERCADOPAGO);
    }
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
