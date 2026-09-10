import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { PaymentGatewayPort } from "../../application/ports/PaymentGatewayPort";
import { WompiAdapter } from "../adapters/WompiAdapter";
import { MercadoPagoAdapter } from "../adapters/MercadoPagoAdapter";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

export class GatewayFactory {
  /**
   * Construye el Adapter de la pasarela pedida.
   *
   * Recibe las credenciales y el endpoint ya resueltos por el SdkConfigurator
   * en lugar de leerlos por su cuenta: la Factory decide QUE clase instanciar,
   * no DE DONDE sale la configuracion. Ambos son opcionales para que un
   * Adapter siga siendo construible con sus valores por defecto.
   */
  create(
    gateway: Gateway,
    credentials?: Credentials,
    baseUrl?: string,
  ): PaymentGatewayPort {
    switch (gateway) {
      case Gateway.WOMPI:
        return new WompiAdapter(baseUrl, credentials);

      // Los adaptadores para RAPYD y KUSHKI se incorporan en la Iteración 2
      case Gateway.MERCADOPAGO:
        return new MercadoPagoAdapter(baseUrl, credentials);
      case Gateway.RAPYD:
      case Gateway.KUSHKI:
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
