import { ErrorHandler, ErrorFamily, classifyError, isRetriable } from "./ErrorHandler";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

describe("ErrorHandler", () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler();
  });

  describe("classifyError() y isRetriable()", () => {
    it("clasifica como RETRIABLE los errores transitorios de red y servidor (KitPagosError)", () => {
      const retriableCodes = [
        KitPagosErrorCode.CONNECTION_FAILED,
        KitPagosErrorCode.GATEWAY_TIMEOUT,
        KitPagosErrorCode.GATEWAY_SERVER_ERROR,
        KitPagosErrorCode.RATE_LIMIT_EXCEEDED,
      ];

      for (const code of retriableCodes) {
        const error = new KitPagosError(code, Gateway.WOMPI, null);
        expect(classifyError(error)).toBe(ErrorFamily.RETRIABLE);
        expect(isRetriable(error)).toBe(true);
      }
    });

    it("clasifica como FINAL los errores no recuperables de negocio o validación (KitPagosError)", () => {
      const finalCodes = [
        KitPagosErrorCode.INVALID_CREDENTIALS,
        KitPagosErrorCode.INVALID_REQUEST,
        KitPagosErrorCode.RESOURCE_NOT_FOUND,
        KitPagosErrorCode.MALFORMED_RESPONSE,
        KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID,
        KitPagosErrorCode.UNSUPPORTED_OPERATION,
        KitPagosErrorCode.MAX_RETRIES_EXCEEDED,
        KitPagosErrorCode.UNKNOWN_ERROR,
      ];

      for (const code of finalCodes) {
        const error = new KitPagosError(code, Gateway.WOMPI, null);
        expect(classifyError(error)).toBe(ErrorFamily.FINAL);
        expect(isRetriable(error)).toBe(false);
      }
    });

    it("clasifica directamente códigos de error en formato string", () => {
      expect(classifyError(KitPagosErrorCode.CONNECTION_FAILED)).toBe(ErrorFamily.RETRIABLE);
      expect(classifyError(KitPagosErrorCode.INVALID_CREDENTIALS)).toBe(ErrorFamily.FINAL);
    });

    it("clasifica errores nativos de JavaScript por código o mensaje de red", () => {
      expect(classifyError(new Error("fetch failed"))).toBe(ErrorFamily.RETRIABLE);
      expect(classifyError(new Error("network error"))).toBe(ErrorFamily.RETRIABLE);
      expect(classifyError(new Error("connect ECONNRESET"))).toBe(ErrorFamily.RETRIABLE);
      expect(classifyError(new Error("ENOTFOUND service.local"))).toBe(ErrorFamily.RETRIABLE);
      expect(classifyError(new Error("request was aborted"))).toBe(ErrorFamily.RETRIABLE);

      const econnErr = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), {
        code: "ECONNREFUSED",
      });
      expect(classifyError(econnErr)).toBe(ErrorFamily.RETRIABLE);

      const timeoutErr = Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" });
      expect(classifyError(timeoutErr)).toBe(ErrorFamily.RETRIABLE);

      const genericErr = new Error("Some unexpected logic bug");
      expect(classifyError(genericErr)).toBe(ErrorFamily.FINAL);

      expect(classifyError(null)).toBe(ErrorFamily.FINAL);
      expect(classifyError(undefined)).toBe(ErrorFamily.FINAL);
      expect(classifyError(12345)).toBe(ErrorFamily.FINAL);
    });
  });

  describe("handle() con excepciones crudas", () => {
    it("retorna la instancia tal cual si ya es un KitPagosError", () => {
      const existing = new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.WOMPI, null);
      const result = errorHandler.handle(existing, Gateway.WOMPI);
      expect(result).toBe(existing);
    });

    it("traduce fallos de conexión a CONNECTION_FAILED", () => {
      const error = new Error("fetch failed");
      const result = errorHandler.handle(error, Gateway.WOMPI);

      expect(result).toBeInstanceOf(KitPagosError);
      expect(result.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
      expect(result.gateway).toBe(Gateway.WOMPI);
      expect(result.originalPayload).toBe(error);
      expect(result.message).toContain("Failed to connect to Wompi gateway");
    });

    it("traduce errores con código ECONNREFUSED / ENOTFOUND / ECONNRESET a CONNECTION_FAILED", () => {
      const error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      const result = errorHandler.handle(error, Gateway.RAPYD);

      expect(result.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
      expect(result.gateway).toBe(Gateway.RAPYD);
      expect(result.message).toContain("Failed to connect to Rapyd gateway");

      const resetErr = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
      expect(errorHandler.handle(resetErr, Gateway.KUSHKI).code).toBe(KitPagosErrorCode.CONNECTION_FAILED);

      const notFoundErr = Object.assign(new Error("domain not found"), { code: "ENOTFOUND" });
      expect(errorHandler.handle(notFoundErr, Gateway.MERCADOPAGO).code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
    });

    it("traduce timeouts de socket o petición a GATEWAY_TIMEOUT", () => {
      const error = Object.assign(new Error("operation timed out"), { code: "ETIMEDOUT" });
      const result = errorHandler.handle(error, Gateway.KUSHKI);

      expect(result.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
      expect(result.gateway).toBe(Gateway.KUSHKI);
      expect(result.message).toContain("Gateway request timed out for Kushki");

      const abortErr = new Error("The user aborted a request.");
      expect(errorHandler.handle(abortErr, Gateway.WOMPI).code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
    });

    it("traduce errores de parseo JSON a MALFORMED_RESPONSE", () => {
      const error = new SyntaxError("Unexpected token in JSON at position 0");
      const result = errorHandler.handle(error, Gateway.WOMPI);

      expect(result.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
      expect(result.gateway).toBe(Gateway.WOMPI);
      expect(result.message).toContain("Failed to parse JSON response from Wompi gateway");

      const jsonErr = new Error("Invalid json format received");
      expect(errorHandler.handle(jsonErr, Gateway.RAPYD).code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
    });

    it("traduce operaciones no soportadas a UNSUPPORTED_OPERATION", () => {
      const error = new Error("status query is not supported by this gateway");
      const result = errorHandler.handle(error, Gateway.WOMPI);

      expect(result.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
      expect(result.gateway).toBe(Gateway.WOMPI);
      expect(result.originalPayload).toBeNull();
      expect(result.message).toBe("status query is not supported by this gateway");

      const unsupportedErr = new Error("unsupported feature requested");
      expect(errorHandler.handle(unsupportedErr, Gateway.RAPYD).code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
    });

    it("maneja errores genéricos de Error", () => {
      const generic = new Error("Something unexpected broke");
      const result = errorHandler.handle(generic, Gateway.WOMPI);

      expect(result.code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
      expect(result.message).toBe("Something unexpected broke");
    });

    it("maneja strings o tipos primitivos desconocidos como UNKNOWN_ERROR", () => {
      const emptyResult = errorHandler.handle("", Gateway.WOMPI);
      expect(emptyResult.code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
      expect(emptyResult.message).toBe("");

      const result = errorHandler.handle("weird string error", Gateway.WOMPI);
      expect(result.code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
      expect(result.message).toBe("weird string error");

      const numResult = errorHandler.handle(12345, Gateway.WOMPI);
      expect(numResult.code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
      expect(numResult.message).toBe(KitPagosErrorCode.UNKNOWN_ERROR);

      const nullResult = errorHandler.handle(null, Gateway.WOMPI);
      expect(nullResult.code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);

      const undefinedResult = errorHandler.handle(undefined, Gateway.WOMPI);
      expect(undefinedResult.code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
    });

    it("da formato adecuado a los nombres de las pasarelas, incluyendo el caso por defecto", () => {
      const error = new Error("fetch failed");
      const customGw = "CUSTOM_GATEWAY" as Gateway;
      const result = errorHandler.handle(error, customGw);
      expect(result.message).toContain("Failed to connect to CUSTOM_GATEWAY gateway");
    });
  });

  describe("handle() con objetos de respuesta HTTP ({ status, body / data })", () => {
    it("traduce 401 y 403 a INVALID_CREDENTIALS", () => {
      const res401 = errorHandler.handle({ status: 401, body: { error: "unauthorized" } }, Gateway.WOMPI);
      expect(res401.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
      expect(res401.originalPayload).toEqual({ error: "unauthorized" });
      expect(res401.message).toContain("Wompi gateway returned an HTTP error status 401");

      const res403 = errorHandler.handle({ status: 403, data: { error: "forbidden" } }, Gateway.WOMPI);
      expect(res403.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
      expect(res403.originalPayload).toEqual({ error: "forbidden" });
    });

    it("traduce 404 a RESOURCE_NOT_FOUND", () => {
      const result = errorHandler.handle({ status: 404, body: "Not Found" }, Gateway.WOMPI);
      expect(result.code).toBe(KitPagosErrorCode.RESOURCE_NOT_FOUND);
      expect(result.originalPayload).toBe("Not Found");
    });

    it("traduce 408 a GATEWAY_TIMEOUT", () => {
      const result = errorHandler.handle({ status: 408, body: "Request Timeout" }, Gateway.WOMPI);
      expect(result.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
    });

    it("traduce 429 a RATE_LIMIT_EXCEEDED", () => {
      const result = errorHandler.handle({ status: 429, body: "Too Many Requests" }, Gateway.WOMPI);
      expect(result.code).toBe(KitPagosErrorCode.RATE_LIMIT_EXCEEDED);
    });

    it("traduce 400 y 422 a INVALID_REQUEST", () => {
      const res400 = errorHandler.handle(
        { status: 400, body: { message: "Invalid payload" } },
        Gateway.WOMPI
      );
      expect(res400.code).toBe(KitPagosErrorCode.INVALID_REQUEST);

      const res422 = errorHandler.handle(
        { status: 422, body: { message: "Unprocessable" } },
        Gateway.WOMPI
      );
      expect(res422.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
    });

    it("traduce códigos 5xx a GATEWAY_SERVER_ERROR", () => {
      const res500 = errorHandler.handle({ status: 500, body: "Internal Server Error" }, Gateway.WOMPI);
      expect(res500.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);

      const res502 = errorHandler.handle({ status: 502, body: "Bad Gateway" }, Gateway.WOMPI);
      expect(res502.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);

      const res503 = errorHandler.handle({ status: 503, body: "Service Unavailable" }, Gateway.WOMPI);
      expect(res503.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
    });

    it("traduce otros códigos HTTP no manejados a UNKNOWN_ERROR", () => {
      const result = errorHandler.handle({ status: 418, body: "I'm a teapot" }, Gateway.WOMPI);
      expect(result.code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
    });

    it("usa el objeto completo como originalPayload si no contiene ni body ni data", () => {
      const rawHttpObj = { status: 500 };
      const result = errorHandler.handle(rawHttpObj, Gateway.WOMPI);
      expect(result.originalPayload).toBe(rawHttpObj);
    });
  });

  describe("Seguridad y Sanitización (RF-08)", () => {
    it("nunca filtra llaves privadas (prv_...) en el mensaje del error", () => {
      const sensitiveMessage = "Failed when using private key prv_test_987654321_secret";
      const error = errorHandler.handle(new Error(sensitiveMessage), Gateway.WOMPI);

      expect(error.message).not.toContain("prv_test_987654321_secret");
      expect(error.message).toContain("[REDACTED_PRIVATE_KEY]");
    });

    it("nunca filtra llaves públicas (pub_...) en el mensaje del error", () => {
      const sensitiveMessage = "Request with public key pub_prod_abcdef123456 rejected";
      const error = errorHandler.handle(new Error(sensitiveMessage), Gateway.WOMPI);

      expect(error.message).not.toContain("pub_prod_abcdef123456");
      expect(error.message).toContain("[REDACTED_PUBLIC_KEY]");
    });

    it("nunca filtra tokens de autorización ni cabeceras Bearer en el mensaje del error", () => {
      const sensitiveMessage =
        "Network failure sending Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const error = errorHandler.handle(new Error(sensitiveMessage), Gateway.WOMPI);

      expect(error.message).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
      expect(error.message).toContain("Authorization: Bearer [REDACTED]");

      const standaloneBearer = "Failed Bearer abc123def456";
      const bearerErr = errorHandler.handle(new Error(standaloneBearer), Gateway.WOMPI);
      expect(bearerErr.message).toContain("Bearer [REDACTED]");
    });

    it("redacta patrones de credenciales en formato JSON o query string dentro del mensaje", () => {
      const error = errorHandler.handle(
        new Error('Server failed processing privateKey: "super_secret_val" and apiKey: "api_999"'),
        Gateway.WOMPI
      );

      expect(error.message).not.toContain("super_secret_val");
      expect(error.message).not.toContain("api_999");
      expect(error.message).toContain('privateKey: "[REDACTED]"');
      expect(error.message).toContain('apiKey: "[REDACTED]"');
    });

    it("preserva el errorBody original en originalPayload para auditoría sin exponerlo en message", () => {
      const rawPayload = {
        wompiError: "GWS_999",
        internalDetails: "Internal database timeout on host 10.0.0.1",
      };

      const error = errorHandler.handle({ status: 500, body: rawPayload }, Gateway.WOMPI);

      expect(error.originalPayload).toBe(rawPayload);
      expect(error.message).not.toContain("10.0.0.1");
    });
  });
});
