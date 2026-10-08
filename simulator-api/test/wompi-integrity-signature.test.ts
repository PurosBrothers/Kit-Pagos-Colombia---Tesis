import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { CredentialResolver } from "../src/auth/CredentialResolver";
import { DEFAULT_WOMPI_INTEGRITY_SECRET } from "../src/auth/merchantSecrets";
import { computeWompiIntegritySignature } from "../src/gateways/wompi/integritySignature";

/*
 * La firma de integridad y el token de aceptación de `POST /v1/sim/wompi/transactions`
 * (punto 86). Los cuerpos son los medidos contra `sandbox.wompi.co` el 7 de octubre de 2026
 * (`docs/testing-data/wompi.md`). Sin `signSimulatorRequests()`: cada campo va a mano.
 */
const PROFILE = {
  WOMPI_PUBLIC_KEY: "pub_test_signature",
  WOMPI_PRIVATE_KEY: "prv_test_signature",
  WOMPI_INTEGRITY_SECRET: "test_integrity_profile_secret",
};

const BODY = {
  amount_in_cents: 2500000,
  currency: "COP",
  reference: "ORDER-SIGNATURE-1",
  customer_email: "firma@example.com",
  payment_method: {
    type: "PSE",
    user_type: 0,
    user_legal_id_type: "CC",
    user_legal_id: "1020304050",
    financial_institution_code: "1",
    payment_description: "Pago de prueba",
  },
};

const validSignature = computeWompiIntegritySignature(BODY, PROFILE.WOMPI_INTEGRITY_SECRET);

function freshToken(): string {
  return `sim_acceptance_${randomUUID()}`;
}

function validationError(field: string, message: string) {
  return { error: { type: "INPUT_VALIDATION_ERROR", messages: { [field]: [message] } } };
}

describe("Wompi integrity signature on POST /v1/sim/wompi/transactions", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({ credentialResolver: new CredentialResolver(PROFILE) });
  });

  afterEach(async () => {
    await app.close();
  });

  function create(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
    return app.inject({ method: "POST", url: "/v1/sim/wompi/transactions", payload, headers });
  }

  it("creates the transaction with the profile secret and a fresh token", async () => {
    const response = await create({ ...BODY, acceptance_token: freshToken(), signature: validSignature });

    expect(response.statusCode).toBe(201);
  });

  it("checks the acceptance token before the signature", async () => {
    const response = await create({ ...BODY });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual(validationError("acceptance_token", "No está presente"));
  });

  it.each([
    ["missing", {}],
    ["null", { signature: null }],
  ])("answers 'Firma de integridad requerida no enviada' when the signature is %s", async (_, signature) => {
    const response = await create({ ...BODY, acceptance_token: freshToken(), ...signature });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual(validationError("signature", "Firma de integridad requerida no enviada"));
  });

  it.each([
    ["empty", ""],
    ["not hex", "no-es-hex"],
    ["signed with another secret", computeWompiIntegritySignature(BODY, "otro_secreto")],
    ["the right one in uppercase", validSignature.toUpperCase()],
    ["signed with the default secret while the profile has its own", computeWompiIntegritySignature(BODY, DEFAULT_WOMPI_INTEGRITY_SECRET)],
  ])("answers 'La firma es inválida' when the signature is %s", async (_, signature) => {
    const response = await create({ ...BODY, acceptance_token: freshToken(), signature });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual(validationError("signature", "La firma es inválida"));
  });

  it("spends the token on a signature 422, so a retry with the right signature is rejected", async () => {
    const token = freshToken();

    const rejected = await create({ ...BODY, acceptance_token: token, signature: "no-es-hex" });
    const retry = await create({ ...BODY, acceptance_token: token, signature: validSignature });

    expect(rejected.statusCode).toBe(422);
    expect(retry.statusCode).toBe(422);
    expect(retry.json()).toEqual(validationError("acceptance_token", "El token de aceptación ya fue usado"));
  });

  it("verifies with the profile secret whatever key the request carries", async () => {
    const response = await create(
      { ...BODY, acceptance_token: freshToken(), signature: validSignature },
      { authorization: "Bearer pub_test_otra_cuenta" },
    );

    expect(response.statusCode).toBe(201);
  });

  describe("against the invalid credential mark", () => {
    it("validates the missing signature before the key, because it is a body check", async () => {
      const response = await create(
        { ...BODY, acceptance_token: freshToken() },
        { authorization: "Bearer pub_test_invalid" },
      );

      expect(response.statusCode).toBe(422);
      expect(response.json().error.messages.signature).toEqual(["Firma de integridad requerida no enviada"]);
    });

    it("rejects the key before checking a wrong signature, whose secret depends on the key", async () => {
      const response = await create(
        { ...BODY, acceptance_token: freshToken(), signature: "no-es-hex" },
        { authorization: "Bearer pub_test_invalid" },
      );

      expect(response.statusCode).toBe(401);
      expect(response.json().error.type).toBe("INVALID_ACCESS_TOKEN");
    });
  });

  it("verifies with the documented default secret when the server has no profile", async () => {
    const bare = buildApp({ credentialResolver: new CredentialResolver({}) });

    const withDefault = await bare.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: {
        ...BODY,
        acceptance_token: freshToken(),
        signature: computeWompiIntegritySignature(BODY, DEFAULT_WOMPI_INTEGRITY_SECRET),
      },
    });
    const withProfileSecret = await bare.inject({
      method: "POST",
      url: "/v1/sim/wompi/transactions",
      payload: { ...BODY, acceptance_token: freshToken(), signature: validSignature },
    });

    expect(withDefault.statusCode).toBe(201);
    expect(withProfileSecret.statusCode).toBe(422);
    await bare.close();
  });
});
