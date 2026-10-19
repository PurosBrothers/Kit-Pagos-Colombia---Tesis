import vm from "vm";
import { ErrorHandler, ErrorFamily, classifyError, isRetriable } from "./ErrorHandler";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

describe("ErrorHandler", () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler();
  });

  describe("classifyError() and isRetriable()", () => {
    it("classifies transient network and server errors (KitPagosError) as RETRIABLE", () => {
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

    it("classifies non-recoverable business or validation errors (KitPagosError) as FINAL", () => {
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

    it("classifies string error codes directly", () => {
      expect(classifyError(KitPagosErrorCode.CONNECTION_FAILED)).toBe(ErrorFamily.RETRIABLE);
      expect(classifyError(KitPagosErrorCode.INVALID_CREDENTIALS)).toBe(ErrorFamily.FINAL);
    });

    it("classifies native JavaScript errors by network code or message", () => {
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

  describe("handle() with the rejection of an AbortSignal", () => {
    /** El motivo real con que Node aborta la señal, no un objeto que lo imite. */
    async function timeoutReason(): Promise<unknown> {
      const signal = AbortSignal.timeout(1);
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      return signal.reason;
    }

    it("maps the AbortSignal.timeout DOMException TimeoutError to GATEWAY_TIMEOUT without failing on its numeric code", async () => {
      const reason = await timeoutReason();
      expect((reason as { code: unknown }).code).toBe(23);

      const result = errorHandler.handle(reason, Gateway.KUSHKI);

      expect(result.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
      expect(result.gateway).toBe(Gateway.KUSHKI);
      expect(result.originalPayload).toBe(reason);
      expect(result.message).toContain("Gateway request timed out for Kushki");
      expect(isRetriable(reason)).toBe(true);
    });

    it("maps the AbortController.abort() AbortError to GATEWAY_TIMEOUT", () => {
      const controller = new AbortController();
      controller.abort();

      const result = errorHandler.handle(controller.signal.reason, Gateway.WOMPI);

      expect(result.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
    });

    it("decides by name and not by the message text", () => {
      const renamed = Object.assign(new Error("deadline reached"), { name: "TimeoutError" });

      expect(errorHandler.handle(renamed, Gateway.RAPYD).code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
      expect(classifyError(renamed)).toBe(ErrorFamily.RETRIABLE);
    });

    it("ignores a non-text code instead of failing", () => {
      const numericCode = Object.assign(new Error("something odd"), { code: 7 });

      expect(errorHandler.handle(numericCode, Gateway.WOMPI).code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
      expect(isRetriable(numericCode)).toBe(false);
    });
  });

  describe("handle() with raw exceptions", () => {
    it("returns the instance as is if it is already a KitPagosError", () => {
      const existing = new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.WOMPI, null);
      const result = errorHandler.handle(existing, Gateway.WOMPI);
      expect(result).toBe(existing);
    });

    it("maps connection failures to CONNECTION_FAILED", () => {
      const error = new Error("fetch failed");
      const result = errorHandler.handle(error, Gateway.WOMPI);

      expect(result).toBeInstanceOf(KitPagosError);
      expect(result.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
      expect(result.gateway).toBe(Gateway.WOMPI);
      expect(result.originalPayload).toBe(error);
      expect(result.message).toContain("Failed to connect to Wompi gateway");
    });

    it("resolves the asymmetry by mapping errors with a 'network' message or ENETUNREACH code to a retriable CONNECTION_FAILED", () => {
      const networkError = new Error("network error occurred during request");
      expect(isRetriable(networkError)).toBe(true);

      const handled = errorHandler.handle(networkError, Gateway.WOMPI);
      expect(handled.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
      expect(handled.gateway).toBe(Gateway.WOMPI);
      expect(isRetriable(handled)).toBe(true);

      const unreachableErr = Object.assign(new Error("Network is unreachable"), { code: "ENETUNREACH" });
      expect(isRetriable(unreachableErr)).toBe(true);
      const handledUnreachable = errorHandler.handle(unreachableErr, Gateway.RAPYD);
      expect(handledUnreachable.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
      expect(isRetriable(handledUnreachable)).toBe(true);
    });

    it("maps errors with ECONNREFUSED / ENOTFOUND / ECONNRESET codes to CONNECTION_FAILED", () => {
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

    it("maps socket or request timeouts to GATEWAY_TIMEOUT", () => {
      const error = Object.assign(new Error("operation timed out"), { code: "ETIMEDOUT" });
      const result = errorHandler.handle(error, Gateway.KUSHKI);

      expect(result.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
      expect(result.gateway).toBe(Gateway.KUSHKI);
      expect(result.message).toContain("Gateway request timed out for Kushki");

      const abortErr = new Error("The user aborted a request.");
      expect(errorHandler.handle(abortErr, Gateway.WOMPI).code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
    });

    it("maps JSON parse errors to MALFORMED_RESPONSE", () => {
      const error = new SyntaxError("Unexpected token in JSON at position 0");
      const result = errorHandler.handle(error, Gateway.WOMPI);

      expect(result.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
      expect(result.gateway).toBe(Gateway.WOMPI);
      expect(result.message).toContain("Failed to parse JSON response from Wompi gateway");

      const jsonErr = new Error("Invalid json format received");
      expect(errorHandler.handle(jsonErr, Gateway.RAPYD).code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
    });

    it("maps unsupported operations to UNSUPPORTED_OPERATION", () => {
      const error = new Error("status query is not supported by this gateway");
      const result = errorHandler.handle(error, Gateway.WOMPI);

      expect(result.code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
      expect(result.gateway).toBe(Gateway.WOMPI);
      expect(result.originalPayload).toBeNull();
      expect(result.message).toBe("status query is not supported by this gateway");

      const unsupportedErr = new Error("unsupported feature requested");
      expect(errorHandler.handle(unsupportedErr, Gateway.RAPYD).code).toBe(KitPagosErrorCode.UNSUPPORTED_OPERATION);
    });

    it("handles generic Error errors", () => {
      const generic = new Error("Something unexpected broke");
      const result = errorHandler.handle(generic, Gateway.WOMPI);

      expect(result.code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
      expect(result.message).toBe("Something unexpected broke");
    });

    it("handles strings or unknown primitive types as UNKNOWN_ERROR", () => {
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

    it("formats gateway names properly, including the default case", () => {
      const error = new Error("fetch failed");
      const customGw = "CUSTOM_GATEWAY" as Gateway;
      const result = errorHandler.handle(error, customGw);
      expect(result.message).toContain("Failed to connect to CUSTOM_GATEWAY gateway");
    });
  });

  describe("handle() with HTTP response objects ({ status, body / data })", () => {
    it("maps 401 and 403 to INVALID_CREDENTIALS", () => {
      const res401 = errorHandler.handle({ status: 401, body: { error: "unauthorized" } }, Gateway.WOMPI);
      expect(res401.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
      expect(res401.originalPayload).toEqual({ error: "unauthorized" });
      expect(res401.message).toContain("Wompi gateway returned an HTTP error status 401");

      const res403 = errorHandler.handle({ status: 403, data: { error: "forbidden" } }, Gateway.WOMPI);
      expect(res403.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
      expect(res403.originalPayload).toEqual({ error: "forbidden" });
    });

    it("maps 404 to RESOURCE_NOT_FOUND", () => {
      const result = errorHandler.handle({ status: 404, body: "Not Found" }, Gateway.WOMPI);
      expect(result.code).toBe(KitPagosErrorCode.RESOURCE_NOT_FOUND);
      expect(result.originalPayload).toBe("Not Found");
    });

    it("maps 408 to GATEWAY_TIMEOUT", () => {
      const result = errorHandler.handle({ status: 408, body: "Request Timeout" }, Gateway.WOMPI);
      expect(result.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
    });

    it("maps 429 to RATE_LIMIT_EXCEEDED", () => {
      const result = errorHandler.handle({ status: 429, body: "Too Many Requests" }, Gateway.WOMPI);
      expect(result.code).toBe(KitPagosErrorCode.RATE_LIMIT_EXCEEDED);
    });

    it("maps 400 and 422 to INVALID_REQUEST", () => {
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

    it("should map 409 to INVALID_REQUEST and not retry it", () => {
      const result = errorHandler.handle(
        { status: 409, body: { error: { type: "DUPLICATE_TRANSACTION" } } },
        Gateway.WOMPI,
      );

      expect(result.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
      expect(classifyError(result)).toBe(ErrorFamily.FINAL);
    });

    it("maps 5xx codes to GATEWAY_SERVER_ERROR", () => {
      const res500 = errorHandler.handle({ status: 500, body: "Internal Server Error" }, Gateway.WOMPI);
      expect(res500.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);

      const res502 = errorHandler.handle({ status: 502, body: "Bad Gateway" }, Gateway.WOMPI);
      expect(res502.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);

      const res503 = errorHandler.handle({ status: 503, body: "Service Unavailable" }, Gateway.WOMPI);
      expect(res503.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
    });

    it("maps other unhandled HTTP codes to UNKNOWN_ERROR", () => {
      const result = errorHandler.handle({ status: 418, body: "I'm a teapot" }, Gateway.WOMPI);
      expect(result.code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
    });

    it("uses the whole object as originalPayload if it contains neither body nor data", () => {
      const rawHttpObj = { status: 500 };
      const result = errorHandler.handle(rawHttpObj, Gateway.WOMPI);
      expect(result.originalPayload).toBe(rawHttpObj);
    });
  });

  describe("Security and sanitization (RF-08)", () => {
    it("never leaks private keys (prv_...) in the error message", () => {
      const sensitiveMessage = "Failed when using private key prv_test_987654321_secret";
      const error = errorHandler.handle(new Error(sensitiveMessage), Gateway.WOMPI);

      expect(error.message).not.toContain("prv_test_987654321_secret");
      expect(error.message).toContain("[REDACTED_PRIVATE_KEY]");
    });

    it("never leaks public keys (pub_...) in the error message", () => {
      const sensitiveMessage = "Request with public key pub_prod_abcdef123456 rejected";
      const error = errorHandler.handle(new Error(sensitiveMessage), Gateway.WOMPI);

      expect(error.message).not.toContain("pub_prod_abcdef123456");
      expect(error.message).toContain("[REDACTED_PUBLIC_KEY]");
    });

    it("never leaks authorization tokens or Bearer headers in the error message", () => {
      const sensitiveMessage =
        "Network failure sending Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const error = errorHandler.handle(new Error(sensitiveMessage), Gateway.WOMPI);

      expect(error.message).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
      expect(error.message).toContain("Authorization: Bearer [REDACTED]");

      const standaloneBearer = "Failed Bearer abc123def456";
      const bearerErr = errorHandler.handle(new Error(standaloneBearer), Gateway.WOMPI);
      expect(bearerErr.message).toContain("Bearer [REDACTED]");
    });

    it("redacts credential patterns in JSON or query string format inside the message", () => {
      const error = errorHandler.handle(
        new Error('Server failed processing privateKey: "super_secret_val" and apiKey: "api_999"'),
        Gateway.WOMPI
      );

      expect(error.message).not.toContain("super_secret_val");
      expect(error.message).not.toContain("api_999");
      expect(error.message).toContain('privateKey: "[REDACTED]"');
      expect(error.message).toContain('apiKey: "[REDACTED]"');
    });

    it("redacts both Wompi secrets, which are neither the private key nor the same one", () => {
      // La lista de `sanitize()` es por nombre, así que **cada campo nuevo de
      // `Credentials` hay que agregarlo o se filtra**. `webhookSecret` entró con el
      // issue #92 y esta prueba es la que evita que el próximo campo se olvide:
      // `integritySecret` firma lo que sale y `webhookSecret` valida lo que entra.
      const error = errorHandler.handle(
        new Error(
          'Request failed with integritySecret: "int_wompi_abc" and webhookSecret: "evt_wompi_xyz"',
        ),
        Gateway.WOMPI,
      );

      expect(error.message).not.toContain("int_wompi_abc");
      expect(error.message).not.toContain("evt_wompi_xyz");
      expect(error.message).toContain('integritySecret: "[REDACTED]"');
      expect(error.message).toContain('webhookSecret: "[REDACTED]"');
    });

    it("preserves the original errorBody in originalPayload for auditing without exposing it in message", () => {
      const rawPayload = {
        wompiError: "GWS_999",
        internalDetails: "Internal database timeout on host 10.0.0.1",
      };

      const error = errorHandler.handle({ status: 500, body: rawPayload }, Gateway.WOMPI);

      expect(error.originalPayload).toBe(rawPayload);
      expect(error.message).not.toContain("10.0.0.1");
    });
  });

  /**
   * Dentro de Jest, los errores que crean el `fetch` y el `JSON.parse` de Node nacen en
   * otro reino de JavaScript, y `instanceof Error` da `false` aunque sean errores normales.
   * `vm.runInNewContext` los fabrica igual, sin depender de una red.
   */
  describe("native errors from another JavaScript realm", () => {
    const foreignSyntaxError = vm.runInNewContext(
      '(() => { try { JSON.parse("<html>"); } catch (e) { return e; } })()',
    ) as unknown;
    const foreignFetchFailed = vm.runInNewContext(
      'new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } })',
    ) as unknown;
    const foreignSocketFailure = vm.runInNewContext(
      'new TypeError("request failed", { cause: { code: "ECONNRESET" } })',
    ) as unknown;

    it("the factories really produce errors from another realm", () => {
      expect(foreignSyntaxError).not.toBeInstanceOf(Error);
      expect(foreignFetchFailed).not.toBeInstanceOf(Error);
    });

    it("maps a JSON.parse SyntaxError to MALFORMED_RESPONSE", () => {
      const error = errorHandler.handle(foreignSyntaxError, Gateway.WOMPI);

      expect(error.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
      expect(error.originalPayload).toBe(foreignSyntaxError);
    });

    it("maps `fetch failed` with an ECONNREFUSED cause to CONNECTION_FAILED", () => {
      const error = errorHandler.handle(foreignFetchFailed, Gateway.RAPYD);

      expect(error.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
      expect(isRetriable(foreignFetchFailed)).toBe(true);
    });

    it("takes the network code from `cause.code` even if the message does not say it", () => {
      expect(errorHandler.handle(foreignSocketFailure, Gateway.KUSHKI).code).toBe(
        KitPagosErrorCode.CONNECTION_FAILED,
      );
      expect(isRetriable(foreignSocketFailure)).toBe(true);
    });

    it.each([
      ["un objeto sin message", { name: "Error" }],
      ["un message que no es texto", { message: 42 }],
      ["null", null],
    ])("does not mistake %s for a native error", (_scenario, raw) => {
      expect(errorHandler.handle(raw, Gateway.WOMPI).code).toBe(KitPagosErrorCode.UNKNOWN_ERROR);
      expect(isRetriable(raw)).toBe(false);
    });
  });
});
