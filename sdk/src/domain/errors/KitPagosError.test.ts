import { KitPagosError } from "./KitPagosError";
import { KitPagosErrorCode } from "../value-objects/KitPagosErrorCode";
import { Gateway } from "../value-objects/Gateway";

describe("KitPagosError", () => {
    describe("constructor", () => {
        it("preserva code, gateway y originalPayload sin transformarlos", () => {
            const payload = {
                transactionId: "123",
            };
            const error = new KitPagosError(KitPagosErrorCode.GATEWAY_TIMEOUT, Gateway.WOMPI, payload);
            expect(error.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
            expect(error.gateway).toBe(Gateway.WOMPI);
            expect(error.originalPayload).toBe(payload);
        });
        it("funciona igual con otro code y otro gateway", () => {
            const payload = {
                transactionId: "123",
            };
            const error = new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.MERCADOPAGO, payload);
            expect(error.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
            expect(error.gateway).toBe(Gateway.MERCADOPAGO);
            expect(error.originalPayload).toBe(payload);
        });
    });

    describe("message", () => {
        it("usa el code como mensaje por defecto cuando no se pasa un mensaje", () => {
            const error = new KitPagosError(KitPagosErrorCode.RATE_LIMIT_EXCEEDED, Gateway.KUSHKI, { transactionId: "123" });
            expect(error.message).toBe(KitPagosErrorCode.RATE_LIMIT_EXCEEDED);
        });
        it("usa el mensaje personalizado cuando se pasa un mensaje", () => {
            const error = new KitPagosError(KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID, Gateway.WOMPI, { transactionId: "123" }, "test message");
            expect(error.message).toBe("test message");
        });
        it("conserva un mensaje vacio en vez de caer al code por defecto", () => {
            const error = new KitPagosError(KitPagosErrorCode.MALFORMED_RESPONSE, Gateway.MERCADOPAGO, { transactionId: "123" }, "");
            expect(error.message).toBe("");
        });
    });

    describe("name", () => {
        it("siempre es KitPagosError", () => {
            const error = new KitPagosError(KitPagosErrorCode.UNSUPPORTED_OPERATION, Gateway.KUSHKI, { transactionId: "123" });
            expect(error.name).toBe("KitPagosError");
        });
    });

    describe("herencia de Error", () => {
        it("es una instancia de KitPagosError y de Error nativo", () => {
            const error = new KitPagosError(KitPagosErrorCode.MAX_RETRIES_EXCEEDED, Gateway.WOMPI, { transactionId: "123" });
            expect(error).toBeInstanceOf(KitPagosError);
            expect(error).toBeInstanceOf(Error);
        });
    });

    describe("originalPayload", () => {
        it("conserva un objeto por referencia, no una copia", () => {
            const payload = {
                transactionId: "123",
                amount: 100,
                currency: "USD",
                orderReference: "123",
                payer: {
                    name: "John Doe",
                    email: "john.doe@example.com",
                },
                status: "PENDING",
                rawStatus: "PENDING",
            };
            const error = new KitPagosError(KitPagosErrorCode.GATEWAY_SERVER_ERROR, Gateway.MERCADOPAGO, payload);
            expect(error.originalPayload).toBe(payload);
        });
        it("conserva valores primitivos o null sin transformarlos", () => {
            const error = new KitPagosError(KitPagosErrorCode.UNKNOWN_ERROR, Gateway.KUSHKI, null);
            expect(error.originalPayload).toBeNull();
        });
    });
});
