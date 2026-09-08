// Facade principal
export { KitPagos } from "./infrastructure/facade/KitPagos";


// Error tipado del SDK: el comercio necesita la clase (no solo el tipo) para
// poder hacer `catch (e) { if (e instanceof KitPagosError) ... }`.
// Renombrado a KitPagosError para evitar colisiones con otros SDKs (architecture-log.md, punto 23).
export { KitPagosError } from "./domain/errors/KitPagosError";

// Entidad y objetos de valor del dominio
export { Transaction } from "./domain/entities/Transaction";
export { Amount } from "./domain/value-objects/Amount";
export { Currency } from "./domain/value-objects/Currency";
export { Gateway } from "./domain/value-objects/Gateway";
export {GatewayTransactionId} from "./domain/value-objects/GatewayTransactionId";
export {OrderReference} from "./domain/value-objects/OrderReference";
export { Payer } from "./domain/value-objects/Payer";
export { RejectionCategory } from "./domain/value-objects/RejectionCategory";
export { RejectionReason } from "./domain/value-objects/RejectionReason";
export { ReturnUrlConfig } from "./domain/value-objects/ReturnUrlConfig";
export { KitPagosErrorCode } from "./domain/value-objects/KitPagosErrorCode";
export { TransactionStatus } from "./domain/value-objects/TransactionStatus";
export { WebhookEvent } from "./domain/value-objects/WebhookEvent";

// Tipos del puerto y de la entrada de un pago
export type {PaymentGatewayPort, CreatePaymentRequest} from "./application/ports/PaymentGatewayPort";

// Tipos de configuracion: sin ellos el comercio no puede tipar el objeto que
// le pasa al constructor de KitPagos.
export type { SDKOptions } from "./infrastructure/config/SDKConfigurator";
export type { Credentials } from "./domain/value-objects/Credentials";
