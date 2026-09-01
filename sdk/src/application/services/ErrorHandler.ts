import { Gateway } from "../../domain/value-objects/Gateway"; 
import { SdkError } from "../../domain/errors/SdkError";

export class ErrorHandler {
    handle(_rawError: unknown, _gateway: Gateway) : SdkError {
        throw new Error("aun no esta implementado");
    }
}