import { randomUUID } from "crypto";
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
import { httpFailure } from "./http-failure";
import {
  assertSupportedPaymentMethod,
  requireCardToken,
} from "./payment-method-support";
import {
  acceptFailedOrder,
  assertPseRequirements,
  buildPseOrderPayload,
  isOrderId,
  parseMercadoPagoPseBanks,
  resolveOrderOutcome,
} from "./mercadopago-pse";
import { buildCardOrderPayload, resolveCardPaymentMethod } from "./mercadopago-card";
import type { PseBank } from "../../domain/value-objects/PseBank";
import { DEFAULT_REQUEST_TIMEOUT_MS, withRequestTimeout } from "../config/request-timeout";

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
 * - Monto en pesos enteros (`total_amount`), sin llamar a toMinorUnits().
 */
export class MercadoPagoAdapter implements PaymentGatewayPort {
  private readonly baseUrl: string;
  private readonly credentials?: Credentials;
  /** Ver la nota de WompiAdapter: fuera del constructor para no inflar el CBO. */
  private readonly normalizer = new ResponseNormalizer();
  private readonly webhookVerifier: WebhookVerifier;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string = DEFAULT_MERCADOPAGO_BASE_URL,
    credentials?: Credentials,
    webhookVerifier: WebhookVerifier = new WebhookVerifier(),
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.timeoutMs = timeoutMs;
    this.webhookVerifier = webhookVerifier;
  }

  /**
   * Crea un pago con tarjeta o con PSE.
   *
   * Desde la versión 0.6.0 los dos van por la Orders API (`POST /orders`). Tarjeta resuelve en
   * la misma respuesta; PSE devuelve una redirección, o una transacción si la orden nace sin
   * URL. Lo medido está en `mercadopago-card.ts` y en `mercadopago-pse.ts`.
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
      // Wompi; una orden cuyo pago falló llega con 402 y se normaliza DECLINED, y
      // una que nace sin URL vuelve como transacción. Ver los puntos 3, 4 y 7 de
      // `mercadopago-pse.ts`.
      return resolveOrderOutcome(rawResponse, (raw) =>
        this.normalizer.normalize(raw, Gateway.MERCADOPAGO),
      );
    }

    const cardToken = requireCardToken(
      request.paymentMethod,
      Gateway.MERCADOPAGO,
      "POST /v1/card_tokens",
    );
    // La Orders API exige la marca y el tipo de la tarjeta, que el token no trae.
    const method = await resolveCardPaymentMethod(
      cardToken,
      this.credentials?.publicKey,
      (path) => this.request(`${this.baseUrl}${path}`, "GET"),
    );

    const rawResponse = await this.request(
      `${this.baseUrl}/orders`,
      "POST",
      JSON.stringify(buildCardOrderPayload(request, cardToken, method)),
    );

    // Un rechazo llega como el 402 de una orden fallida, que `request()` deja pasar y el
    // normalizador lee como DECLINED, igual que en PSE.
    return transactionResult(
      this.normalizer.normalize(rawResponse, Gateway.MERCADOPAGO),
    );
  }

  /**
   * Consulta el estado de un pago existente.
   *
   * Elige el endpoint según la forma del identificador porque Mercado Pago tiene
   * dos familias de recursos: las órdenes (PSE y, desde 0.6.0, tarjeta) se consultan en
   * `/orders/{id}`, y los pagos con tarjeta creados por la Payments API antes de 0.6.0 en
   * `/payments/{id}`. Ver `isOrderId()`.
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
   * entidades vienen anidadas en la entrada `pse`. Por eso la ruta aquí es
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
   * `400 "Header X-Idempotency-Key can't be null"` y `POST /v1/orders`, que es por donde van
   * PSE y, desde 0.6.0, tarjeta, `400 "Missing HTTP header: X-Idempotency-Key."`. O sea que
   * sin esto el SDK no podía cobrar en Mercado Pago **por ningún método**, y no se había visto
   * porque las mediciones a mano mandaban el header y el simulador no lo pedía.
   *
   * Es un valor nuevo por llamada y no derivado de `orderReference`, que era la alternativa
   * tentadora: con la referencia como llave, dos intentos de cobrar la misma orden producirían
   * un solo cobro, lo cual suena a más seguridad. Medido en la Orders API el 15 de octubre de
   * 2026 (`docs/testing-data/mercado-pago.md`): con la misma llave y el mismo cuerpo responde
   * una copia de la respuesta original, y con otro cuerpo responde `409
   * idempotency_key_already_used`. Así que un cobro rechazado quedaría incobrable:
   * reintentarlo con otra tarjeta sobre la misma orden daría `409`.
   *
   * La llave aleatoria no protege del doble cobro, y Mercado Pago tampoco lo hace por la
   * referencia: dos órdenes con el mismo `external_reference` y llaves distintas se crearon
   * y se cobraron las dos. La protección del SDK es que `createPayment()` es la única
   * operación que **no** se envuelve en `RetryHandler` (punto 35 del `architecture-log.md`);
   * antes de reintentar un cobro, el comercio confirma que el intento anterior no se cobró.
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

    return withRequestTimeout(
      this.timeoutMs,
      async (signal) => {
        let response: Response;
        try {
          response = await fetch(url, { method, headers, body, signal });
        } catch (networkError) {
          throw new ErrorHandler().handle(networkError, Gateway.MERCADOPAGO);
        }

        if (!response.ok) {
          // Lanza salvo en el 402 de una orden que se creó y falló, cuyo cuerpo `createPayment`
          // normaliza como DECLINED (punto 3 de `mercadopago-pse.ts` y `mercadopago-card.ts`).
          return acceptFailedOrder(
            response.status,
            await httpFailure(response, Gateway.MERCADOPAGO, this.credentials),
          );
        }

        try {
          return await response.json();
        } catch (parseError) {
          throw new ErrorHandler().handle(parseError, Gateway.MERCADOPAGO);
        }
      },
      (reason) => new ErrorHandler().handle(reason, Gateway.MERCADOPAGO),
    );
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
      { payload, headers },
      {
        secret,
        publicKey: this.credentials?.publicKey,
        webhookUrl: this.credentials?.webhookUrl,
      },
      Gateway.MERCADOPAGO,
    );
  }
}
