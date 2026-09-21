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
import { buildRapydHeaders, serializeBody } from "./rapyd-signature";
import {
  PaymentResult,
  transactionResult,
  redirectRequired,
} from "../../domain/value-objects/PaymentResult";
import { extractRapydRedirect } from "../../application/services/normalizers/rapyd-redirect";
import {
  buildCheckoutPayload,
  checkoutToPaymentResponse,
  isRapydCheckoutId,
} from "./rapyd-checkout";
import { assertSupportedPaymentMethod } from "./payment-method-support";
import {
  assertPseRequirements,
  buildCustomerPayload,
  buildPsePaymentPayload,
  extractCustomerId,
  parseRapydPseBanks,
} from "./rapyd-pse";
import type { PseBank } from "../../domain/value-objects/PseBank";

/**
 * URL raíz de la API de Rapyd (o de su mock en simulator-api, issue #52).
 *
 * **Cambió con PSE, y es un cambio incompatible.** Antes apuntaba a la colección
 * de pagos (`.../rapyd/payments`), porque el adaptador solo hablaba con ese
 * recurso. PSE obliga a hablar con tres: `POST /customers` antes del pago,
 * `/payments` para cobrar y `/payment_methods/country` para la lista de bancos.
 * Con la URL apuntando a un recurso concreto, las otras dos solo se podían
 * alcanzar recortando la cadena, que es la clase de truco que después nadie
 * entiende.
 *
 * Es el mismo cambio que hizo el adaptador de Mercado Pago cuando entró PSE
 * (punto 45), y deja a los cuatro adaptadores con la misma convención: `baseUrl`
 * es la raíz y cada método arma su ruta. Contra el sandbox real el valor
 * equivalente es `https://sandboxapi.rapyd.net/v1`.
 */
const DEFAULT_RAPYD_URL = "http://localhost:3000/v1/sim/rapyd";

/**
 * Adapter concreto de Rapyd Collect. Traduce las llamadas genéricas de
 * PaymentGatewayPort a peticiones HTTP contra la API de Rapyd (o su simulador
 * local), siguiendo el patrón de manejo de errores que fija WompiAdapter:
 * nunca construir KitPagosError inline, siempre delegar a ErrorHandler, e
 * instanciarlo dentro de los métodos para no inflar el CBO.
 *
 * Rapyd es la más exigente de las cuatro pasarelas y se separa de Wompi en tres
 * puntos, todos ellos detalles de infraestructura que no tocan el dominio:
 *
 * 1. **Autenticación por firma en cada petición**, no un Bearer fijo. El
 *    algoritmo vive en rapyd-signature.ts, que tiene especificación externa y
 *    vector de prueba oficial propios.
 * 2. **El monto viaja en pesos con decimales**, no en centavos. Este adaptador
 *    no llama a `toMinorUnits()`; usa `toFixedScale()`.
 * 3. **Estados propios** (`ACT`, `CLO`, `ERR`, `EXP`, `REV`), que traduce
 *    ResponseNormalizer en su rama `Gateway.RAPYD`.
 */
export class RapydAdapter implements PaymentGatewayPort {
  private readonly baseUrl: string;
  private readonly credentials?: Credentials;
  /** Ver la nota de WompiAdapter: fuera del constructor para no inflar el CBO. */
  private readonly normalizer = new ResponseNormalizer();
  private readonly webhookVerifier: WebhookVerifier;

  /**
   * Las credenciales llegan resueltas desde el SdkConfigurator vía
   * GatewayFactory. Son opcionales porque el mock de la API de Simulación no
   * verifica la firma, de modo que el Adapter siga siendo instanciable sin
   * configuración en pruebas.
   *
   * Mapeo sobre el objeto de valor `Credentials`, que es común a las cuatro
   * pasarelas: `publicKey` es el `access_key` de Rapyd (identifica a la
   * organización y viaja en claro en un header) y `privateKey` es el
   * `secret_key` (nunca se transmite solo, únicamente como parte de la firma).
   * La correspondencia es exacta, así que Rapyd no obligó a cambiar el objeto de
   * valor pese a nombrar sus llaves de otra forma.
   */
  constructor(
    baseUrl: string = DEFAULT_RAPYD_URL,
    credentials?: Credentials,
    webhookVerifier: WebhookVerifier = new WebhookVerifier()
  ) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.webhookVerifier = webhookVerifier;
  }

  /**
   * Devuelve PaymentResult en vez de Transaction desde el issue #64. Es el único
   * de los tres adaptadores existentes que puede tomar la rama REDIRECT_REQUIRED
   * hoy, porque su flujo 3DS ya devuelve `redirect_url`.
   */
  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    assertSupportedPaymentMethod(request.paymentMethod, Gateway.RAPYD, [
      "CARD",
      "PSE",
    ]);

    if (request.paymentMethod?.type === "PSE") {
      return this.createPsePayment(request);
    }

    return this.createHostedCheckout(request);
  }

  /**
   * Cobra con tarjeta por la página de pago de Rapyd.
   *
   * ## Por qué no es un cobro servidor-a-servidor como en las otras tres
   *
   * Porque Rapyd no lo permite sin la tarjeta en la mano. Se midió: cobrar un token de
   * tarjeta guardado responde `400 ERROR_CARD_NOT_AUTHENTICATED`, con cliente y pidiendo
   * 3DS también, y el único camino que responde `200` exige `payment_method.fields.number`,
   * o sea el número de la tarjeta en la petición. Aceptarlo metería al SDK y a todo
   * comercio que lo integre en alcance PCI DSS. Todo el razonamiento y lo medido están en
   * `rapyd-checkout.ts`.
   *
   * El resultado es una redirección, igual que PSE: la misma rama del puerto, sin ningún
   * campo nuevo en la API pública.
   */
  private async createHostedCheckout(
    request: CreatePaymentRequest,
  ): Promise<PaymentResult> {
    const rawResponse = await this.send(
      "post",
      "/checkout",
      buildCheckoutPayload(request),
    );

    // `extractRapydRedirect` sirve tal cual para el checkout: lee `data.redirect_url` y
    // `data.id`, que es lo que la respuesta trae, y no depende del `next_action` (punto 39).
    const redirect = extractRapydRedirect(rawResponse);
    if (redirect) {
      return redirectRequired(redirect);
    }

    // Sin URL no hay página a la que mandar al pagador. Normalizar deja que el error se
    // reporte como respuesta malformada, que es la verdad, en vez de devolver una
    // transacción pendiente que nunca va a avanzar.
    return transactionResult(
      this.normalizer.normalize(rawResponse, Gateway.RAPYD),
    );
  }

  /**
   * Consulta el estado de un pago.
   *
   * A diferencia de Wompi, que se conforma con la llave pública como Bearer para
   * consultar, Rapyd no tiene un esquema reducido de solo lectura: la consulta se
   * firma igual que la creación. Lo único que cambia es que el método es `get` y
   * el cuerpo firmado es un string vacío.
   */
  async getStatus(gatewayTransactionId: string): Promise<Transaction> {
    // Un cobro con tarjeta devuelve el id de un checkout, no de un pago, y Rapyd los
    // tiene en recursos distintos: se midió que un id de checkout en `/payments/{id}`
    // responde `400 ERROR_GET_PAYMENT`. La ruta se elige por el prefijo, que Rapyd pone
    // en todos sus identificadores.
    if (isRapydCheckoutId(gatewayTransactionId)) {
      const rawResponse = await this.send(
        "get",
        `/checkout/${gatewayTransactionId}`,
      );
      return this.normalizer.normalize(
        checkoutToPaymentResponse(rawResponse),
        Gateway.RAPYD,
      );
    }

    const rawResponse = await this.send(
      "get",
      `/payments/${gatewayTransactionId}`,
    );
    return this.normalizer.normalize(rawResponse, Gateway.RAPYD);
  }

  /**
   * Cobra por PSE, que en Rapyd son **dos llamadas**: primero el cliente y
   * después el pago.
   *
   * ## Por qué la secuencia queda escondida acá y no en el puerto
   *
   * Porque el número de llamadas antes de redirigir es distinto en cada pasarela
   * —una en Wompi y Mercado Pago, dos acá, tres en Kushki— y es un detalle del
   * proveedor, no del cobro. Meterlo en el contrato le impondría a las pasarelas
   * de una llamada una ceremonia que no necesitan, y expondría en la API pública
   * una diferencia entre proveedores, que es justamente el criterio con el que el
   * issue #64 define un puerto mal cortado.
   *
   * El costo de esconderla es real y conviene nombrarlo: si la segunda llamada
   * falla, el cliente ya quedó creado en Rapyd y nadie lo va a limpiar. Se midió
   * que eso pasa de verdad —un pago sin `payer.email` crea el cliente y recién
   * después rechaza con `[EMAIL]`—, y por eso `assertPseRequirements()` corre
   * **antes** de la primera llamada: no elimina el estado a medias, pero saca del
   * camino la causa que sí se podía prevenir sin salir del proceso. Queda la
   * causa que no: una caída de red entre las dos.
   */
  private async createPsePayment(
    request: CreatePaymentRequest,
  ): Promise<PaymentResult> {
    assertPseRequirements(request);

    const customerResponse = await this.send(
      "post",
      "/customers",
      buildCustomerPayload(request),
    );
    const customerId = extractCustomerId(customerResponse);

    const paymentResponse = await this.send(
      "post",
      "/payments",
      buildPsePaymentPayload(request, customerId),
    );

    // Rapyd devuelve la redirección en la respuesta de creación, sin sondeo: se
    // midió `status: "ACT"`, `next_action: "pending_confirmation"` y
    // `redirect_url` presente. `extractRapydRedirect` la detecta por la presencia
    // de la URL y no por el `next_action`, así que PSE entró sin tocarlo, aunque
    // su `next_action` no existía en el catálogo conocido cuando se eligió esa
    // regla (punto 39).
    const redirect = extractRapydRedirect(paymentResponse);
    if (redirect) {
      return redirectRequired(redirect);
    }

    // Sin URL no hay a dónde mandar al pagador. Normalizar deja que el pipeline
    // de errores lo reporte como respuesta malformada, que es la verdad, en vez
    // de devolver una transacción pendiente que nunca va a avanzar.
    return transactionResult(
      this.normalizer.normalize(paymentResponse, Gateway.RAPYD),
    );
  }

  /**
   * Lista los bancos de PSE filtrando el catálogo de métodos de pago de Colombia.
   *
   * Rapyd es la única de las cuatro sin lista de bancos: PSE son 47
   * `payment_method_type` dentro de un catálogo de 97 para Colombia, así que la
   * lista se arma filtrando por el prefijo `co_pse_`. El país está fijo en `CO`
   * porque el SDK es de pasarelas colombianas y PSE no existe fuera de Colombia.
   */
  async getPseBanks(): Promise<PseBank[]> {
    const rawResponse = await this.send(
      "get",
      "/payment_methods/country?country=CO",
    );
    return parseRapydPseBanks(rawResponse);
  }

  /**
   * Firma, manda y valida una petición contra Rapyd.
   *
   * Extraída al implementar PSE: la creación de pago, la de cliente, la consulta
   * y la lista de bancos hacen exactamente lo mismo salvo el método, la ruta y el
   * cuerpo. Sin esto habría cuatro copias del mismo armado de firma, y la firma de
   * Rapyd es precisamente lo que no conviene tener escrito cuatro veces: se
   * calcula sobre el cuerpo serializado exacto, así que cualquier diferencia entre
   * copias produce un 401 difícil de rastrear.
   */
  private async send(
    httpMethod: "get" | "post",
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const bodyString = payload ? serializeBody(payload) : "";
    const headers = buildRapydHeaders(httpMethod, url, bodyString, this.credentials);

    let response: Response;
    try {
      response = await fetch(url, {
        method: httpMethod.toUpperCase(),
        headers,
        body: payload ? bodyString : undefined,
      });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.RAPYD);
    }

    return this.readRawResponse(response);
  }

  /**
   * Valida el código HTTP, parsea el cuerpo y normaliza hacia Transaction.
   *
   * Está extraído porque la creación y la consulta hacen exactamente lo mismo a
   * partir de la respuesta; duplicarlo en los dos métodos solo daría dos sitios
   * donde arreglar el mismo error.
   */
  private async readTransaction(response: Response): Promise<Transaction> {
    const rawResponse = await this.readRawResponse(response);
    return this.normalizer.normalize(rawResponse, Gateway.RAPYD);
  }

  /**
   * Valida el código HTTP y devuelve el cuerpo crudo, sin normalizar.
   *
   * Se separó de `readTransaction` en el issue #64 porque la creación de pago ya
   * no siempre produce una `Transaction`: cuando Rapyd exige redirección, hay que
   * mirar el cuerpo crudo antes de normalizar. La consulta de estado sigue
   * normalizando siempre, así que las dos comparten esta parte y difieren en la
   * siguiente.
   */
  private async readRawResponse(response: Response): Promise<unknown> {
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
        Gateway.RAPYD
      );
    }

    try {
      return await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.RAPYD);
    }
  }

  /**
   * Valida la firma del webhook delegando al servicio de dominio
   * WebhookVerifier, que ya implementa la fórmula de Rapyd (distinta de la de
   * las peticiones salientes que calcula rapyd-signature.ts).
   */
  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string
  ): boolean {
    return this.webhookVerifier.verify(payload, headers, secret, Gateway.RAPYD);
  }
}
