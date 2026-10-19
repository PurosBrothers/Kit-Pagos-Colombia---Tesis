import Fastify from "fastify";
import { Writable } from "stream";
import {
  sanitizeHeaders,
  redactReqSerializer,
  fastifyLoggerConfig,
  REDACTED_TEXT,
} from "../src/logger/redactSerializer";

describe("Secret redaction in logs", () => {
  describe("sanitizeHeaders", () => {
    it("censors every sensitive header regardless of upper or lower case", () => {
      const headers = {
        "content-type": "application/json",
        "authorization": "Bearer super_secret_token",
        "X-Gateway-Private-Key": "prv_secret_key_123",
        "x-gateway-public-key": "pub_key_456",
        "X-GATEWAY-INTEGRITY-SECRET": "integrity_secret_789",
        "x-gateway-webhook-secret": "webhook_secret_abc",
        "user-agent": "jest-test",
      };

      const sanitized = sanitizeHeaders(headers);

      expect(sanitized).toBeDefined();
      expect(sanitized!["content-type"]).toBe("application/json");
      expect(sanitized!["user-agent"]).toBe("jest-test");

      expect(sanitized!["authorization"]).toBe(REDACTED_TEXT);
      expect(sanitized!["X-Gateway-Private-Key"]).toBe(REDACTED_TEXT);
      expect(sanitized!["x-gateway-public-key"]).toBe(REDACTED_TEXT);
      expect(sanitized!["X-GATEWAY-INTEGRITY-SECRET"]).toBe(REDACTED_TEXT);
      expect(sanitized!["x-gateway-webhook-secret"]).toBe(REDACTED_TEXT);
    });
  });

  describe("redactReqSerializer", () => {
    it("serializes the request with the censored headers", () => {
      const mockReq = {
        method: "POST",
        url: "/v1/charges",
        routerPath: "/v1/charges",
        params: { id: "123" },
        headers: {
          authorization: "Bearer secret_bearer_token",
          "x-gateway-private-key": "prv_my_private_key",
          host: "localhost:3000",
        },
      };

      const serialized = redactReqSerializer(mockReq);

      const headers = serialized.headers as Record<string, unknown>;
      expect(headers.host).toBe("localhost:3000");
      expect(headers.authorization).toBe(REDACTED_TEXT);
      expect(headers["x-gateway-private-key"]).toBe(REDACTED_TEXT);
    });
  });

  describe("Log capture in Fastify at runtime", () => {
    it("guarantees that no credential or token is written to the logger stream", async () => {
      let logBuffer = "";
      const customStream = new Writable({
        write(chunk, _encoding, callback) {
          logBuffer += chunk.toString();
          callback();
        },
      });

      const app = Fastify({
        logger: {
          stream: customStream,
          level: "info",
          serializers: fastifyLoggerConfig.serializers,
          redact: fastifyLoggerConfig.redact,
        },
      });

      app.post("/test-log", async (req) => {
        req.log.info({ req }, "Procesando petición con credenciales");
        return { success: true };
      });

      const PRIVATE_KEY = "prv_leak_test_secret_999";
      const BEARER_TOKEN = "bearer_secret_token_888";
      const INTEGRITY_SECRET = "integrity_test_secret_777";

      const res = await app.inject({
        method: "POST",
        url: "/test-log",
        headers: {
          authorization: `Bearer ${BEARER_TOKEN}`,
          "x-gateway-private-key": PRIVATE_KEY,
          "x-gateway-integrity-secret": INTEGRITY_SECRET,
          "content-type": "application/json",
        },
        payload: { amount: 50000 },
      });

      expect(res.statusCode).toBe(200);

      // Verificación estricta: ninguno de los valores sensibles debe figurar en el log
      expect(logBuffer).not.toContain(PRIVATE_KEY);
      expect(logBuffer).not.toContain(BEARER_TOKEN);
      expect(logBuffer).not.toContain(INTEGRITY_SECRET);

      // En su lugar, debe figurar la etiqueta de censura
      expect(logBuffer).toContain(REDACTED_TEXT);

      await app.close();
    });
  });
});
