import { Gateway } from "../../domain/value-objects/Gateway"; 
import { KitPagosError } from "../../domain/errors/KitPagosError";

export class ErrorHandler {
    handle(_rawError: unknown, _gateway: Gateway) : KitPagosError {
        throw new Error("aun no esta implementado");
    }
}