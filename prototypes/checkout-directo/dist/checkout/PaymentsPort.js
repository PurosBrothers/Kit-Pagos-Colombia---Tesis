"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentTechnicalError = void 0;
/**
 * Un fallo técnico que siguió después de reintentar: la pasarela no respondió, respondió
 * 5xx o con un cuerpo ilegible. No es un rechazo: el pago no se decidió.
 */
class PaymentTechnicalError extends Error {
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "PaymentTechnicalError";
    }
}
exports.PaymentTechnicalError = PaymentTechnicalError;
