import { KitPagosError } from "./KitPagosError";
import { KitPagosErrorCode } from "../value-objects/KitPagosErrorCode";
import { Gateway } from "../value-objects/Gateway";

describe("KitPagosError", () => {
    describe("constructor", () => {
        it("preserves code, gateway and originalPayload without transforming them", () => {
            const payload = {
                transactionId: "123",
            };
            const error = new KitPagosError(KitPagosErrorCode.GATEWAY_TIMEOUT, Gateway.WOMPI, payload);
            expect(error.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
            expect(error.gateway).toBe(Gateway.WOMPI);
            expect(error.originalPayload).toBe(payload);
        });
        it("works the same with another code and another gateway", () => {
            const payload = {
                transactionId: "123",
            };
            const error = new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.MERCADOPAGO, payload);
            expect(error.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
            expect(error.gateway).toBe(Gateway.MERCADOPAGO);
            expect(error.originalPayload).toBe(payload);
        });
    });

    describe("cause", () => {
        it("stores the cause as a non-enumerable property, like Error in ES2022", () => {
            const original = new KitPagosError(KitPagosErrorCode.GATEWAY_TIMEOUT, Gateway.WOMPI, null);
            const error = new KitPagosError(KitPagosErrorCode.MAX_RETRIES_EXCEEDED, Gateway.WOMPI, null, "agotado", { cause: original });
            expect(error.cause).toBe(original);
            expect(Object.keys(error)).not.toContain("cause");
            expect(JSON.stringify(error)).not.toContain("GATEWAY_TIMEOUT");
        });
        it("does not define cause when it is not passed", () => {
            const error = new KitPagosError(KitPagosErrorCode.GATEWAY_TIMEOUT, Gateway.WOMPI, null);
            expect(error.cause).toBeUndefined();
            expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
        });
    });

    describe("message", () => {
        it("uses the code as the default message when no message is passed", () => {
            const error = new KitPagosError(KitPagosErrorCode.RATE_LIMIT_EXCEEDED, Gateway.KUSHKI, { transactionId: "123" });
            expect(error.message).toBe(KitPagosErrorCode.RATE_LIMIT_EXCEEDED);
        });
        it("uses the custom message when a message is passed", () => {
            const error = new KitPagosError(KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID, Gateway.WOMPI, { transactionId: "123" }, "test message");
            expect(error.message).toBe("test message");
        });
        it("keeps an empty message instead of falling back to the default code", () => {
            const error = new KitPagosError(KitPagosErrorCode.MALFORMED_RESPONSE, Gateway.MERCADOPAGO, { transactionId: "123" }, "");
            expect(error.message).toBe("");
        });
    });

    describe("name", () => {
        it("is always KitPagosError", () => {
            const error = new KitPagosError(KitPagosErrorCode.UNSUPPORTED_OPERATION, Gateway.KUSHKI, { transactionId: "123" });
            expect(error.name).toBe("KitPagosError");
        });
    });

    describe("Error inheritance", () => {
        it("is an instance of KitPagosError and of the native Error", () => {
            const error = new KitPagosError(KitPagosErrorCode.MAX_RETRIES_EXCEEDED, Gateway.WOMPI, { transactionId: "123" });
            expect(error).toBeInstanceOf(KitPagosError);
            expect(error).toBeInstanceOf(Error);
        });
    });

    describe("instanceof across copies of the class", () => {
        const brand = Symbol.for("kit-pagos-colombia.KitPagosError");

        it("recognizes an object with the global brand, like the one the browser bundle copy creates", () => {
            const fromOtherCopy = Object.assign(new Error("x"), { [brand]: true });
            expect(fromOtherCopy instanceof KitPagosError).toBe(true);
        });
        it("does not recognize an Error without the brand nor values that are not objects", () => {
            expect(new Error("x") instanceof KitPagosError).toBe(false);
            expect({ [brand]: "true" } instanceof KitPagosError).toBe(false);
            expect((null as unknown) instanceof KitPagosError).toBe(false);
            expect(("KitPagosError" as unknown) instanceof KitPagosError).toBe(false);
        });
        it("a subclass only accepts its own instances, not any branded error", () => {
            class SubclassError extends KitPagosError {}
            const sub = new SubclassError(KitPagosErrorCode.UNKNOWN_ERROR, Gateway.WOMPI, null);
            const base = new KitPagosError(KitPagosErrorCode.UNKNOWN_ERROR, Gateway.WOMPI, null);
            expect(sub instanceof SubclassError).toBe(true);
            expect(sub instanceof KitPagosError).toBe(true);
            expect(base instanceof SubclassError).toBe(false);
        });
        it("the brand is non-enumerable and read-only", () => {
            const error = new KitPagosError(KitPagosErrorCode.UNKNOWN_ERROR, Gateway.WOMPI, null);
            const descriptor = Object.getOwnPropertyDescriptor(error, brand);
            expect(descriptor).toMatchObject({ value: true, enumerable: false, writable: false });
        });
    });

    describe("originalPayload", () => {
        it("keeps an object by reference, not a copy", () => {
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
        it("keeps primitive values or null without transforming them", () => {
            const error = new KitPagosError(KitPagosErrorCode.UNKNOWN_ERROR, Gateway.KUSHKI, null);
            expect(error.originalPayload).toBeNull();
        });
    });
});
