import { Gateway } from "../../domain/value-objects/Gateway"
import { PaymentGatewayPort } from "../../application/ports/PaymentGatewayPort"

export class GatewayFactory {
    create( gateway: Gateway) : PaymentGatewayPort {
        throw new Error(" Aun no esta implementado");
    }
}