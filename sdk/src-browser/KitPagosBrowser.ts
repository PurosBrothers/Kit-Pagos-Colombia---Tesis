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
 * al servidor del comercio para cobrar con `PaymentMethod.card(result.token)` o
 * mediante `POST /v1/api/payments`.
 *
 * PCI DSS: esta clase y sus tokenizadores nunca transmiten datos de tarjeta
 * (número, cvc, expiración) al backend del comercio ni a servidores intermediarios.
 * No acepta URLs: el destino sale del catálogo cerrado de cada tokenizador según el
 * `environment`, para que no exista forma de mandar la tarjeta a otro host.
 */
export class KitPagosBrowser {
  private readonly defaultEnvironment: BrowserEnvironment;

  constructor(options?: KitPagosBrowserOptions) {
    this.defaultEnvironment = options?.environment ?? "sandbox";
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
    // El tipo solo admite WOMPI y MERCADOPAGO, pero quien llama desde JavaScript
    // puede mandar cualquier cadena, así que se normaliza y se valida en ejecución.
    const rawGateway = String(params.gateway ?? "").toUpperCase();

    if (rawGateway === Gateway.WOMPI) {
      return WompiTokenizer.tokenize({ ...params, environment });
    }

    if (rawGateway === Gateway.MERCADOPAGO) {
      return MercadoPagoTokenizer.tokenize({
        ...params,
        environment,
      });
    }

    // Se atribuye el error a la pasarela que se pidió, aunque no sea del enum, para
    // que quien lee el error vea "STRIPE" y no una pasarela que nunca usó.
    throw new KitPagosError(
      KitPagosErrorCode.UNSUPPORTED_OPERATION,
      rawGateway as Gateway,
      null,
      `La tokenización de tarjeta en el navegador solo está soportada para ${Gateway.WOMPI} y ${Gateway.MERCADOPAGO}. La pasarela '${String(params.gateway)}' no admite tokenización en frontend.`,
    );
  }

  /**
   * Método de conveniencia estático para tokenizar sin instanciar la clase.
   */
  static async tokenizeCard(params: TokenizeCardParams): Promise<CardTokenResult> {
    return new KitPagosBrowser({ environment: params.environment }).tokenizeCard(params);
  }
}
