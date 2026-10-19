import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { PaymentGatewayPort } from "../../application/ports/PaymentGatewayPort";
import { WompiAdapter } from "../adapters/WompiAdapter";
import { MercadoPagoAdapter } from "../adapters/MercadoPagoAdapter";
import { RapydAdapter } from "../adapters/RapydAdapter";
import { KushkiAdapter } from "../adapters/KushkiAdapter";
import { withCredentialRedaction } from "../adapters/redacting-gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

export class GatewayFactory {
  /**
   * Construye el Adapter de la pasarela pedida.
   *
   * Recibe las credenciales y el endpoint ya resueltos por el SdkConfigurator
   * en lugar de leerlos por su cuenta: la Factory decide QUE clase instanciar,
   * no DE DONDE sale la configuracion. Los tres son opcionales para que un
   * Adapter siga siendo construible con sus valores por defecto; el
   * `undefined` en tercera posicion deja el WebhookVerifier por defecto.
   *
   * El Adapter sale envuelto por `withCredentialRedaction()`: ningun error que
   * lance lleva un valor de `credentials` (punto 87 del architecture-log.md).
   */
  create(
    gateway: Gateway,
    credentials?: Credentials,
    baseUrl?: string,
    timeoutMs?: number,
  ): PaymentGatewayPort {
    return withCredentialRedaction(
      this.instantiate(gateway, credentials, baseUrl, timeoutMs),
      credentials,
    );
  }

  private instantiate(
    gateway: Gateway,
    credentials?: Credentials,
    baseUrl?: string,
    timeoutMs?: number,
  ): PaymentGatewayPort {
    switch (gateway) {
      case Gateway.WOMPI:
        return new WompiAdapter(baseUrl, credentials, undefined, timeoutMs);

      case Gateway.MERCADOPAGO:
        return new MercadoPagoAdapter(baseUrl, credentials, undefined, timeoutMs);

      case Gateway.RAPYD:
        return new RapydAdapter(baseUrl, credentials, undefined, timeoutMs);

      case Gateway.KUSHKI:
        return new KushkiAdapter(baseUrl, credentials, undefined, timeoutMs);
      default:
        throw new KitPagosError(
          KitPagosErrorCode.UNSUPPORTED_OPERATION,
          gateway,
          null,
          `Gateway not supported in this iteration: ${gateway}`
        );
    }
  }
}
