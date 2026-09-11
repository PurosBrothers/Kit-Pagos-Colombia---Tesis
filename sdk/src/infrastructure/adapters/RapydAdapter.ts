import { createHmac, randomBytes } from "node:crypto";
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
 * URL del endpoint de pagos del mock de Rapyd (simulator-api, issue #52).
 *
 * Es la URL de la colección de pagos, siguiendo la misma convención que los
 * adaptadores de Wompi y Mercado Pago: `baseUrl` apunta al recurso que se crea
 * con POST, y la consulta de estado le agrega `/{id}`. Contra el sandbox real de
 * Rapyd el valor equivalente es `https://sandboxapi.rapyd.net/v1/payments`.
 */
const DEFAULT_RAPYD_URL = "http://localhost:3000/v1/sim/rapyd/payments";

/**
 * Longitud del salt. Rapyd recomienda entre 8 y 16 caracteres; se usan 8 bytes
 * aleatorios en hexadecimal (16 caracteres), el tope del rango recomendado.
 */
const SALT_BYTES = 8;

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
 * 1. **Autenticación por firma en cada petición**, no un Bearer fijo. Está
 *    aislada en `sign()`.
 * 2. **El monto viaja en pesos con decimales**, no en centavos. Este adaptador
 *    no llama a `toMinorUnits()`; usa `toFixedScale()`.
 * 3. **Estados propios** (`ACT`, `CLO`, `ERR`, `EXP`, `REV`), que traduce
 *    ResponseNormalizer en su rama `Gateway.RAPYD`.
 */
export class RapydAdapter implements PaymentGatewayPort {
  private readonly baseUrl: string;
  private readonly credentials?: Credentials;
  private readonly normalizer: ResponseNormalizer;
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
    normalizer: ResponseNormalizer = new ResponseNormalizer(),
    webhookVerifier: WebhookVerifier = new WebhookVerifier()
  ) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.normalizer = normalizer;
    this.webhookVerifier = webhookVerifier;
  }

  /**
   * Calcula la firma de una petición saliente de Rapyd.
   *
   * Fórmula oficial (`docs.rapyd.net/en/request-signatures.html`):
   *
   *   signature = BASE64( HEX( HMAC-SHA256_secret( http_method + url_path +
   *               salt + timestamp + access_key + secret_key + body_string ) ) )
   *
   * Cuatro detalles que la vuelven fácil de implementar mal, y que son la razón
   * de que esté aislada en un método propio con pruebas contra el vector de la
   * documentación oficial:
   *
   * 1. El resultado del HMAC se serializa primero a **hexadecimal** y ese texto
   *    hex es lo que se codifica en Base64. No es `digest("base64")`: eso
   *    produce una firma distinta y Rapyd la rechaza.
   * 2. El método HTTP va en **minúsculas**.
   * 3. La `secret_key` aparece **dos veces**: como parte de la cadena que se
   *    firma y como llave del HMAC. No es una redundancia del código, está así
   *    en el contrato.
   * 4. Un cuerpo vacío se firma como string vacío, **no** como `"{}"`.
   *
   * Nótese que esta fórmula NO es la del webhook, que excluye el método HTTP y
   * usa la URL completa en vez del path relativo. Son dos fórmulas distintas que
   * comparten casi todos los componentes; la del webhook vive en
   * WebhookVerifier.
   */
  private sign(
    credentials: Credentials,
    httpMethod: string,
    urlPath: string,
    salt: string,
    timestamp: number,
    bodyString: string
  ): string {
    const { publicKey: accessKey, privateKey: secretKey } = credentials;

    const toSign =
      httpMethod.toLowerCase() +
      urlPath +
      salt +
      timestamp +
      accessKey +
      secretKey +
      bodyString;

    const hmac = createHmac("sha256", secretKey);
    hmac.update(toSign);

    return Buffer.from(hmac.digest("hex")).toString("base64");
  }

  /**
   * Construye los headers de una petición firmada.
   *
   * `bodyString` debe ser exactamente el mismo texto que se envía como cuerpo:
   * si se serializara dos veces, cualquier diferencia (orden de claves, un
   * espacio) produciría una firma que no corresponde al cuerpo enviado. Por eso
   * el llamador serializa una sola vez y pasa el string, en vez de pasar el
   * objeto.
   *
   * Cuando no hay credenciales se devuelven solo los headers básicos: el mock no
   * verifica la firma, y firmar con llaves vacías sería teatro.
   */
  private buildHeaders(
    httpMethod: string,
    urlPath: string,
    bodyString: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (!this.credentials) {
      return headers;
    }

    const salt = randomBytes(SALT_BYTES).toString("hex");
    // Rapyd exige el timestamp en segundos Unix y rechaza los que se desvíen
    // más de 60 segundos del reloj real.
    const timestamp = Math.floor(Date.now() / 1000);

    headers["access_key"] = this.credentials.publicKey;
    headers["salt"] = salt;
    headers["timestamp"] = String(timestamp);
    headers["signature"] = this.sign(
      this.credentials,
      httpMethod,
      urlPath,
      salt,
      timestamp,
      bodyString
    );

    return headers;
  }

  /**
   * Extrae el path que participa en la firma.
   *
   * Rapyd firma la porción de la URL posterior al host, incluida la query string
   * si existe. Se deriva con el parser de URL en vez de concatenar strings a
   * mano para que la firma siga siendo correcta sin importar cómo se haya
   * configurado la base: contra el sandbox real el path firmado es
   * `/v1/payments`, y contra el simulador local es `/v1/sim/rapyd/payments`.
   */
  private static extractUrlPath(url: string): string {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  }

  async createPayment(request: CreatePaymentRequest): Promise<Transaction> {
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
    //    JSON.stringify no introduce espacios, que es lo que Rapyd exige del
    //    cuerpo firmado.
    const bodyString = JSON.stringify(payload);

    const url = this.baseUrl;
    const headers = this.buildHeaders(
      "post",
      RapydAdapter.extractUrlPath(url),
      bodyString
    );

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

    return this.readTransaction(response);
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
    const headers = this.buildHeaders(
      "get",
      RapydAdapter.extractUrlPath(url),
      ""
    );

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

    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.RAPYD);
    }

    return this.normalizer.normalize(rawResponse, Gateway.RAPYD);
  }

  /**
   * Valida la firma del webhook delegando al servicio de dominio
   * WebhookVerifier, que ya implementa la fórmula de Rapyd (distinta de la de
   * las peticiones salientes que calcula `sign()`).
   */
  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string
  ): boolean {
    return this.webhookVerifier.verify(payload, headers, secret, Gateway.RAPYD);
  }
}
