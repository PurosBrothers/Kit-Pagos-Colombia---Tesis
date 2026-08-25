import { Gateway } from "../../domain/value-objects/Gateway";
import { Transaction } from "../../domain/entities/Transaction";

export class ResponseNormalizer {
    normalize(rawResponse: unknown, gateway: Gateway): Transaction {
        throw new Error("Aun no esta implementado");
    }
}