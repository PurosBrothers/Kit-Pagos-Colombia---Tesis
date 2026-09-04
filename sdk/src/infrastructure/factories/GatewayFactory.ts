import { Gateway } from "../../domain/value-objects/Gateway";
import { PaymentGatewayPort } from "../../application/ports/PaymentGatewayPort";
import { WompiAdapter } from "../adapters/WompiAdapter";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";

export class GatewayFactory {
  create(gateway: Gateway): PaymentGatewayPort {
    switch (gateway) {
      case Gateway.WOMPI:
        return new WompiAdapter();

      // Los adaptadores para RAPYD, MERCADOPAGO y KUSHKI se incorporan en la Iteración 2
      case Gateway.RAPYD:
      case Gateway.MERCADOPAGO:
      case Gateway.KUSHKI:
      default:
        throw new SdkError(
          SdkErrorCode.UNSUPPORTED_OPERATION,
          gateway,
          null,
          `Pasarela no soportada en esta iteración: ${gateway}`
        );
    }
  }
}
