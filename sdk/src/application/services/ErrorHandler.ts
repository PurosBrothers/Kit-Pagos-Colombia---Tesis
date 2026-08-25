import { Gateway } from "../../domain/value-objects/Gateway"; 
import { SdkError } from "../../domain/errors/SdkError";

export class ErrorHandler {
    handle(rawError: unknown, gateway: Gateway) : SdkError {
        throw new Error("Aun no esta implementado");
    }
}