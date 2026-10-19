import { httpFailure, redactCredentials } from "./http-failure";
import { WompiAdapter } from "./WompiAdapter";
import { MercadoPagoAdapter } from "./MercadoPagoAdapter";
import { KushkiAdapter } from "./KushkiAdapter";
import { RapydAdapter } from "./RapydAdapter";
import { jsonErrorResponse } from "../../test-support/http-response";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Gateway } from "../../domain/value-objects/Gateway";
import type { Credentials } from "../../domain/value-objects/Credentials";

/**
 * El cuerpo del `401` de Wompi con la llave `garbage`, medido el 6 de octubre de 2026
 * (docs/testing-data/wompi.md, sección 1.3): el `reason` repite la llave recibida.
 */
const wompiEchoedKeyBody = {
  error: {
    type: "INVALID_ACCESS_TOKEN",
    reason: "La llave proporcionada no corresponde a este ambiente, se recibió: garbage",
  },
};

const credentials: Credentials = {
  publicKey: "garbage",
  privateKey: "prv_test_no_real",
  integritySecret: "integrity_no_real",
  webhookSecret: "events_no_real",
};

function asResponse(status: number, body: unknown): Response {
  return jsonErrorResponse(status, body) as unknown as Response;
}

describe("httpFailure()", () => {
  it("should not repeat a configured key that the gateway echoed in the body", async () => {
    const error = await httpFailure(asResponse(401, wompiEchoedKeyBody), Gateway.WOMPI, credentials);

    expect(error.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
    expect(JSON.stringify(error.originalPayload)).not.toContain("garbage");
    expect(error.message).not.toContain("garbage");
    expect(error.originalPayload).toEqual({
      error: {
        type: "INVALID_ACCESS_TOKEN",
        reason: "La llave proporcionada no corresponde a este ambiente, se recibió: [REDACTED]",
      },
    });
  });

  it("should leave the body untouched without credentials", async () => {
    const error = await httpFailure(asResponse(401, wompiEchoedKeyBody), Gateway.WOMPI);

    expect(error.originalPayload).toEqual(wompiEchoedKeyBody);
  });

  it("should redact a body that is not JSON", async () => {
    const response = {
      ok: false,
      status: 502,
      text: async () => "<html>upstream rejected prv_test_no_real</html>",
    } as unknown as Response;

    const error = await httpFailure(response, Gateway.WOMPI, credentials);

    expect(error.originalPayload).toBe("<html>upstream rejected [REDACTED]</html>");
  });
});

describe("redactCredentials()", () => {
  it.each([
    ["publicKey", "garbage"],
    ["privateKey", "prv_test_no_real"],
    ["integritySecret", "integrity_no_real"],
    ["webhookSecret", "events_no_real"],
  ])("should remove the %s from the message and from nested values", (_field, value) => {
    const error = new KitPagosError(
      KitPagosErrorCode.UNKNOWN_ERROR,
      Gateway.WOMPI,
      { list: [`key ${value}`], nested: { deep: value } },
      `failed with ${value}`,
    );

    const redacted = redactCredentials(error, credentials);

    expect(redacted.message).toBe("failed with [REDACTED]");
    expect(redacted.originalPayload).toEqual({
      list: ["key [REDACTED]"],
      nested: { deep: "[REDACTED]" },
    });
  });

  it("should keep the code, the gateway and the cause", () => {
    const cause = new Error("previous");
    const error = new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.RAPYD, null, "x", {
      cause,
    });

    const redacted = redactCredentials(error, credentials);

    expect(redacted.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
    expect(redacted.gateway).toBe(Gateway.RAPYD);
    expect(redacted.cause).toBe(cause);
  });

  /** Un valor tan corto coincidiría con cualquier texto y destrozaría el cuerpo. */
  it("should ignore credential values shorter than four characters", () => {
    const error = new KitPagosError(KitPagosErrorCode.UNKNOWN_ERROR, Gateway.WOMPI, "abc", "abc");

    const redacted = redactCredentials(error, { publicKey: "abc", privateKey: "" });

    expect(redacted).toBe(error);
  });

  it("should not alter numbers, booleans or non-literal objects", () => {
    const date = new Date(0);
    const error = new KitPagosError(KitPagosErrorCode.UNKNOWN_ERROR, Gateway.WOMPI, {
      amount: 5000,
      ok: false,
      at: date,
    });

    expect(redactCredentials(error, credentials).originalPayload).toEqual({
      amount: 5000,
      ok: false,
      at: date,
    });
  });
});

describe("adapters with a gateway that echoes the key", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    ["Wompi", () => new WompiAdapter(undefined, credentials)],
    ["Mercado Pago", () => new MercadoPagoAdapter(undefined, credentials)],
    ["Kushki", () => new KushkiAdapter(undefined, credentials)],
    ["Rapyd", () => new RapydAdapter(undefined, credentials)],
  ])("should not leak the configured keys through a 401 from %s", async (_name, build) => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonErrorResponse(401, {
        ...wompiEchoedKeyBody,
        detail: "private key prv_test_no_real",
      }),
    );

    const failure = await build().getPseBanks().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(KitPagosError);
    const serialized = JSON.stringify((failure as KitPagosError).originalPayload);
    expect(serialized).not.toContain("garbage");
    expect(serialized).not.toContain("prv_test_no_real");
    expect((failure as KitPagosError).message).not.toContain("garbage");
  });
});
