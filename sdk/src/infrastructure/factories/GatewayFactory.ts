import { Gateway } from "../../domain/value-objects/Gateway"
import { PaymentGatewayPort } from "../../application/ports/PaymentGatewayPort"

export class GatewayFactory {
    create(_gateway: Gateway) : PaymentGatewayPort {
        throw new Error("aun no esta implementado");
    }
}