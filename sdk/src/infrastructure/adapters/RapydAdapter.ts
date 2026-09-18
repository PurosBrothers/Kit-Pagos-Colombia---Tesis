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
import { assertSupportedPaymentMethod } from "./payment-method-support";

/**
 * URL del endpoint de pagos del mock de Rapyd (simulator-api, issue #52).
 *
 * Es la URL de la colección de pagos, siguiendo la misma convención que los
 * adaptadores de Wompi y Mercado Pago: `baseUrl` apunta al recurso que se crea
 * con POST, y la consulta de estado le agrega `/{id}`. Contra el sandbox real de
 * Rapyd el valor equivalente es `https://sandboxapi.rapyd.net/v1/payments`.
 */
const DEFAULT_RAPYD_URL = "http://localhost:3000/v1/sim/rapyd/payments";

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
    // PSE en Rapyd son 47 métodos `co_pse_{banco}_bank` y exige crear el
    // `customer` antes del pago, o sea dos llamadas (issue #68). Queda fuera de
    // este issue, y hasta que entre hay que fallar explícito en vez de cobrar con
    // tarjeta algo que el pagador quiso pagar por PSE.
    assertSupportedPaymentMethod(request.paymentMethod, Gateway.RAPYD, ["CARD"]);

    // 1. Mapeo del dominio a campos nativos de Rapyd.
    //
    //    El monto va en pesos, NO en centavos: `toMinorUnits()` no se usa acá, y
    //    usarlo multiplicaría el cobro por cien. Se envía como string y con la
    //    escala fija de la divisa por indicación explícita de Rapyd, que
    //    documenta que JSON.stringify convierte `12.00` en `12` y que eso rompe
    //    el cálculo de la firma, recomendando enviar los montos con ceros a la
    //    derecha como strings numéricos. `toFixedScale()` produce justamente eso.
    const payload: Record<string, unknown> = {
      amount: request.amount.toFixedScale(
        request.currency.getMinorUnitExponent()
      ),
      currency: request.currency.getCode(),
      merchant_reference_id: request.orderReference.getValue(),
      // Rapyd no modela un email de pagador obligatorio como las otras tres
      // pasarelas; `receipt_email` (opcional) es el campo equivalente más
      // cercano y sirve para que el pagador reciba el recibo.
      receipt_email: request.payer.email,
    };

    if (request.returnUrlConfig) {
      const completeUrl = request.returnUrlConfig.resolveFor("APPROVED");
      const errorUrl = request.returnUrlConfig.resolveFor("DECLINED");
      if (completeUrl) {
        payload.complete_payment_url = completeUrl;
      }
      if (errorUrl) {
        payload.error_payment_url = errorUrl;
      }
    }

    // 2. Serializar una sola vez. Este mismo string se firma y se envía.
    //    serializeBody usa JSON.stringify sin espacios, que es lo que Rapyd exige.
    const bodyString = serializeBody(payload);
    const url = this.baseUrl;
    const headers = buildRapydHeaders("post", url, bodyString, this.credentials);

    // 3. Petición HTTP
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: bodyString,
      });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.RAPYD);
    }

    // 4. Rapyd puede exigir un paso del pagador por fuera del SDK: 3DS devuelve
    //    `status: "ACT"` con `next_action: "3d_verification"` y un `redirect_url`.
    //    Antes del issue #64 ese `redirect_url` se descartaba en silencio, porque
    //    el normalizador traduce "ACT" a PENDING y `Transaction` no tenía dónde
    //    guardar la URL. El comercio recibía una transacción pendiente sin señal
    //    de que faltaba redirigir, y el pago se quedaba colgado hasta expirar.
    const rawResponse = await this.readRawResponse(response);
    const redirect = extractRapydRedirect(rawResponse);
    if (redirect) {
      return redirectRequired(redirect);
    }

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
    const url = `${this.baseUrl}/${gatewayTransactionId}`;
    const headers = buildRapydHeaders("get", url, "", this.credentials);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET", headers });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.RAPYD);
    }

    return this.readTransaction(response);
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
