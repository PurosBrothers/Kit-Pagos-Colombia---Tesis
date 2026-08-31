import { SdkError } from "./SdkError";
import { SdkErrorCode } from "../value-objects/SdkErrorCode";
import { Gateway } from "../value-objects/Gateway";


describe("SdkError", () => {
     
    describe("constructor", () => {
        it("preserva code, gateway y originalPayload sin transformarlos", () => {
            const payload = {
                transactionId: "123",
            }
            const error = new SdkError(SdkErrorCode.GATEWAY_TIMEOUT, Gateway.WOMPI, payload);
            expect(error.code).toBe(SdkErrorCode.GATEWAY_TIMEOUT);
            expect(error.gateway).toBe(Gateway.WOMPI);
            expect(error.originalPayload).toBe(payload);
        });
        it("funciona igual con otro code y otro gateway", () => {
            const payload = {
                transactionId: "123",
            }
            const error = new SdkError(SdkErrorCode.INVALID_REQUEST, Gateway.MERCADOPAGO, payload);
            expect(error.code).toBe(SdkErrorCode.INVALID_REQUEST);
            expect(error.gateway).toBe(Gateway.MERCADOPAGO);
            expect(error.originalPayload).toBe(payload);
        });
    });

    describe("message", () => {
        it("usa el code como mensaje por defecto cuando no se pasa un mensaje", () => {
            const error = new SdkError(SdkErrorCode.RATE_LIMIT_EXCEEDED, Gateway.KUSHKI, { transactionId: "123" });
            expect(error.message).toBe(SdkErrorCode.RATE_LIMIT_EXCEEDED);
        });
        it("usa el mensaje personalizado cuando se pasa un mensaje", () => {
            const error = new SdkError(SdkErrorCode.WEBHOOK_SIGNATURE_INVALID, Gateway.WOMPI, { transactionId: "123" }, "test message");
            expect(error.message).toBe("test message");
        });
        it("conserva un mensaje vacio en vez de caer al code por defecto", () => {
            const error = new SdkError(SdkErrorCode.MALFORMED_RESPONSE, Gateway.MERCADOPAGO, { transactionId: "123" }, "");
            expect(error.message).toBe("");
        });
    });

    describe("name", () => {
        it("siempre es SdkError", () => {
            const error = new SdkError(SdkErrorCode.UNSUPPORTED_OPERATION, Gateway.KUSHKI, { transactionId: "123" });
            expect(error.name).toBe("SdkError");
        });
    });

    describe("herencia de Error", () => {
        it("es una instancia de Error", () => {
            const error = new SdkError(SdkErrorCode.MAX_RETRIES_EXCEEDED, Gateway.WOMPI, { transactionId: "123" });
            expect(error).toBeInstanceOf(SdkError);
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
            }
            const error = new SdkError(SdkErrorCode.GATEWAY_SERVER_ERROR, Gateway.MERCADOPAGO, payload);
            expect(error.originalPayload).toBe(payload);
        });
        it("conserva valores primitivos o null sin transformarlos", () => {
            const error = new SdkError(SdkErrorCode.UNKNOWN_ERROR, Gateway.KUSHKI, null);
            expect(error.originalPayload).toBeNull();
        });
    });
});
