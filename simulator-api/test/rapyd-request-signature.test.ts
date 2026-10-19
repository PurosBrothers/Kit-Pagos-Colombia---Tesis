import { randomBytes } from "node:crypto";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { DEFAULT_RAPYD_SECRET_KEY } from "../src/auth/merchantSecrets";
import { computeRapydRequestSignature, SaltRegistry } from "../src/gateways/rapyd/requestSignature";

/*
 * La firma de las peticiones a `/v1/sim/rapyd` (punto 86). Los cuerpos, los HTTP y el orden son
 * los medidos contra `sandboxapi.rapyd.net` el 7 de octubre de 2026. Sin
 * `signSimulatorRequests()`: cada cabecera va a mano.
 */
const PROFILE = {
  RAPYD_API_ACCESS_KEY: "rak_test_profile",
  RAPYD_API_SECRET_KEY: "rsk_test_profile_secret",
};

const BANKS_URL = "/v1/sim/rapyd/payment_methods/country?country=CO";
const CHECKOUT_URL = "/v1/sim/rapyd/checkout";
const CHECKOUT_BODY = JSON.stringify({ amount: "150000.00", currency: "COP", country: "CO" });

const SIGNATURE_MESSAGE =
  "The API received a request, but the signature did not match. The request was rejected. " +
  "Corrective action: (1) Remove all whitespace that is not inside a string. " +
  "(2) Remove trailing zeroes and decimal points, or wrap numbers in a string.";

interface Signing {
  method?: string;
  url?: string;
  body?: string;
  secret?: string;
  salt?: string;
  offsetSeconds?: number;
  accessKey?: string;
  omit?: string;
  /** El cuerpo que se envía, si es distinto del firmado. */
  sentBody?: string;
}

function newSalt(): string {
  return randomBytes(8).toString("hex");
}

function signedRequest(options: Signing = {}) {
  const method = options.method ?? "GET";
  const url = options.url ?? BANKS_URL;
  const body = options.body ?? "";
  const salt = options.salt ?? newSalt();
  const timestamp = String(Math.floor(Date.now() / 1000) + (options.offsetSeconds ?? 0));
  const accessKey = options.accessKey ?? PROFILE.RAPYD_API_ACCESS_KEY;
  const headers: Record<string, string> = {
    access_key: accessKey,
    salt,
    timestamp,
    signature: computeRapydRequestSignature(
      { method, urlPath: url, salt, timestamp, accessKey, body },
      options.secret ?? PROFILE.RAPYD_API_SECRET_KEY,
    ),
  };
  const sent = options.sentBody ?? body;
  if (sent !== "") headers["content-type"] = "application/json";
  if (options.omit !== undefined) delete headers[options.omit];

  return {
    method: method as "GET" | "POST",
    url,
    headers,
    payload: sent === "" ? undefined : sent,
  };
}

describe("Rapyd request signature on /v1/sim/rapyd", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({ credentialResolver: new CredentialResolver(PROFILE) });
  });

  afterEach(async () => {
    await app.close();
  });

  it("accepts a GET and a POST signed with the profile secret", async () => {
    const banks = await app.inject(signedRequest());
    const checkout = await app.inject(signedRequest({ method: "POST", url: CHECKOUT_URL, body: CHECKOUT_BODY }));

    expect(banks.statusCode).toBe(200);
    expect(checkout.statusCode).toBe(200);
  });

  it("answers 401 UNAUTHENTICATED_API_CALL with the signature message for another secret", async () => {
    const response = await app.inject(signedRequest({ secret: "otro_secreto" }));

    expect(response.statusCode).toBe(401);
    expect(response.json().status).toEqual({
      error_code: "UNAUTHENTICATED_API_CALL",
      status: "ERROR",
      message: SIGNATURE_MESSAGE,
      response_code: "UNAUTHENTICATED_API_CALL",
      operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("signs the exact body that arrived: the same JSON with spaces does not match", async () => {
    const spaced = JSON.stringify(JSON.parse(CHECKOUT_BODY), null, 1);

    const response = await app.inject(
      signedRequest({ method: "POST", url: CHECKOUT_URL, body: CHECKOUT_BODY, sentBody: spaced }),
    );

    expect(response.statusCode).toBe(401);
    expect(response.json().status.message).toBe(SIGNATURE_MESSAGE);
  });

  it("recomputes with the access_key of the request and the profile secret", async () => {
    const response = await app.inject(signedRequest({ accessKey: "rak_test_otra_llave" }));

    expect(response.statusCode).toBe(200);
  });

  describe("timestamp window", () => {
    it.each([
      ["300 s in the past", -300],
      ["3600 s in the future", 3600],
    ])("accepts a timestamp %s, the measured limit", async (_, offsetSeconds) => {
      const response = await app.inject(signedRequest({ offsetSeconds }));

      expect(response.statusCode).toBe(200);
    });

    it.each([
      ["360 s in the past (measured)", -360],
      ["3700 s in the future (simulator decision)", 3700],
    ])("rejects a timestamp %s", async (_, offsetSeconds) => {
      const response = await app.inject(signedRequest({ offsetSeconds }));

      expect(response.statusCode).toBe(401);
      expect(response.json().status.error_code).toBe("UNAUTHENTICATED_API_CALL");
      expect(response.json().status.message).toBe("timestamp header is out of allowed range");
    });
  });

  describe("salt", () => {
    it("rejects a salt already used, even with a new timestamp and signature", async () => {
      const salt = newSalt();

      const first = await app.inject(signedRequest({ salt }));
      const second = await app.inject(signedRequest({ salt, offsetSeconds: -5 }));

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(401);
      expect(second.json().status.message).toBe("salt header value is not valid, same value used not long ago");
    });

    it("does not spend the salt of a request rejected by its signature", async () => {
      const salt = newSalt();

      const rejected = await app.inject(signedRequest({ salt, secret: "otro_secreto" }));
      const accepted = await app.inject(signedRequest({ salt }));

      expect(rejected.statusCode).toBe(401);
      expect(accepted.statusCode).toBe(200);
    });
  });

  it.each(["signature", "access_key", "salt", "timestamp"])(
    "answers 400 MISSING_AUTHENTICATION_HEADERS without the %s header",
    async (omit) => {
      const response = await app.inject(signedRequest({ omit }));

      expect(response.statusCode).toBe(400);
      expect(response.json().status).toMatchObject({
        error_code: "MISSING_AUTHENTICATION_HEADERS",
        status: "ERROR",
        message:
          "The request did not contain the required headers for authentication. The request was rejected. " +
          "Corrective action: Add authentication headers.",
        response_code: "MISSING_AUTHENTICATION_HEADERS",
      });
    },
  );

  describe("order with several problems (measured: header, signature, then the rest)", () => {
    it("reports the missing header before an out-of-range timestamp", async () => {
      const response = await app.inject(signedRequest({ omit: "signature", offsetSeconds: -600 }));

      expect(response.statusCode).toBe(400);
    });

    it("reports the signature before an out-of-range timestamp", async () => {
      const response = await app.inject(signedRequest({ secret: "otro_secreto", offsetSeconds: -600 }));

      expect(response.json().status.message).toBe(SIGNATURE_MESSAGE);
    });

    it("reports the signature before a reused salt", async () => {
      const salt = newSalt();
      await app.inject(signedRequest({ salt }));

      const response = await app.inject(signedRequest({ salt, secret: "otro_secreto" }));

      expect(response.json().status.message).toBe(SIGNATURE_MESSAGE);
    });
  });

  describe("against the invalid credential mark", () => {
    it("rejects the marked access_key with the account message before checking the signature", async () => {
      const response = await app.inject(signedRequest({ accessKey: "rak_test_invalid", secret: "otro_secreto" }));

      expect(response.statusCode).toBe(401);
      expect(response.json().status.message).toContain("authentication issue");
    });

    it("still reports the missing headers first", async () => {
      const response = await app.inject(signedRequest({ accessKey: "rak_test_invalid", omit: "signature" }));

      expect(response.statusCode).toBe(400);
    });
  });

  it("does not ask for a signature on the payment page, which is not Rapyd's API", async () => {
    const created = await app.inject(signedRequest({ method: "POST", url: CHECKOUT_URL, body: CHECKOUT_BODY }));

    const visit = await app.inject({ method: "GET", url: `/v1/sim/rapyd/checkout/${created.json().data.id}/pay` });

    expect(visit.statusCode).toBe(200);
  });

  it("verifies with the documented default secret when the server has no profile", async () => {
    const bare = buildApp({ credentialResolver: new CredentialResolver({}) });

    const withDefault = await bare.inject(signedRequest({ secret: DEFAULT_RAPYD_SECRET_KEY }));
    const withProfileSecret = await bare.inject(signedRequest());

    expect(withDefault.statusCode).toBe(200);
    expect(withProfileSecret.statusCode).toBe(401);
    await bare.close();
  });
});

describe("SaltRegistry", () => {
  it("forgets a salt once its timestamp leaves the 300 s window", () => {
    const salts = new SaltRegistry();
    salts.remember("abc", 1000, 1000);

    expect(salts.isRecent("abc", 1299)).toBe(true);
    expect(salts.isRecent("abc", 1300)).toBe(false);
  });
});
