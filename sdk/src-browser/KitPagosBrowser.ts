import { Gateway } from "../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../src/domain/value-objects/KitPagosErrorCode";
import { KitPagosError } from "../src/domain/errors/KitPagosError";
import {
  BrowserEnvironment,
  CardTokenResult,
  KitPagosBrowserOptions,
  TokenizeCardParams,
} from "./types";
import { WompiTokenizer } from "./tokenizers/WompiTokenizer";
import { MercadoPagoTokenizer } from "./tokenizers/MercadoPagoTokenizer";

/**
 * Fachada principal de Kit Pagos para el navegador.
 *
 * Expone la tokenización de tarjeta unificada en el frontend del pagador.
 * Permite obtener un token seguro (`CardTokenResult.token`) que luego se envía
 * al servidor del comercio para cobrar con `PaymentMethod.card(token)` o
 * mediante `POST /v1/api/payments`.
 *
 * PCI DSS: Esta clase y sus tokenizadores nunca transmiten datos de tarjeta
 * (número, cvc, expiración) al backend del comercio ni a servidores intermediarios.
 */
export class KitPagosBrowser {
  private readonly defaultEnvironment: BrowserEnvironment;
  private readonly defaultBaseUrl?: string;

  constructor(options?: KitPagosBrowserOptions) {
    this.defaultEnvironment = options?.environment ?? "sandbox";
    this.defaultBaseUrl = options?.baseUrl;
  }

  /**
   * Tokeniza una tarjeta directamente contra la pasarela indicada.
   *
   * @param params Parámetros de tokenización (pasarela, clave pública, tarjeta y ambiente opcional).
   * @returns Resultado con el `token` emitido por la pasarela.
   * @throws KitPagosError(UNSUPPORTED_OPERATION) si la pasarela no admite tokenización en navegador.
   */
  async tokenizeCard(params: TokenizeCardParams): Promise<CardTokenResult> {
    const environment = params.environment ?? this.defaultEnvironment;
    const baseUrl = params.baseUrl ?? this.defaultBaseUrl;
    const rawGateway = (params.gateway ?? "").toString().toUpperCase();

    if (rawGateway === Gateway.WOMPI) {
      return WompiTokenizer.tokenize({
        ...params,
        environment,
        baseUrl,
      });
    }

    if (rawGateway === Gateway.MERCADOPAGO) {
      return MercadoPagoTokenizer.tokenize({
        ...params,
        environment,
        baseUrl,
      });
    }

    const targetGateway = Object.values(Gateway).includes(rawGateway as Gateway)
      ? (rawGateway as Gateway)
      : Gateway.WOMPI;

    throw new KitPagosError(
      KitPagosErrorCode.UNSUPPORTED_OPERATION,
      targetGateway,
      null,
      `La tokenización de tarjeta en el navegador solo está soportada para ${Gateway.WOMPI} y ${Gateway.MERCADOPAGO}. La pasarela '${params.gateway}' no admite tokenización en frontend.`,
    );
  }

  /**
   * Método de conveniencia estático para tokenizar sin instanciar la clase.
   */
  static async tokenizeCard(params: TokenizeCardParams): Promise<CardTokenResult> {
    const browser = new KitPagosBrowser({
      environment: params.environment,
      baseUrl: params.baseUrl,
    });
    return browser.tokenizeCard(params);
  }
}
