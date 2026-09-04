// Facade principal
export { KitPagos } from "./infrastructure/facade/KitPagos";


// Entidad y objetos de valor del dominio
export { Transaction } from "./domain/entities/Transaction";
export { Amount } from "./domain/value-objects/Amount";
export { Currency } from "./domain/value-objects/Currency";
export { Gateway } from "./domain/value-objects/Gateway";
export {GatewayTransactionId} from "./domain/value-objects/GatewayTransactionId";
export {OrderReference} from "./domain/value-objects/OrderReference";
export { Payer } from "./domain/value-objects/Payer";
export { RejectionReason } from "./domain/value-objects/RejectionReason";
export { ReturnUrlConfig } from "./domain/value-objects/ReturnUrlConfig";
export { SdkErrorCode } from "./domain/value-objects/SdkErrorCode";
export { TransactionStatus } from "./domain/value-objects/TransactionStatus";
export { WebhookEvent } from "./domain/value-objects/WebhookEvent";

// Tipos del puerto
export {PaymentGatewayPort} from "./application/ports/PaymentGatewayPort";