import { createHash } from "node:crypto";
import { WompiCreateTransactionRequestBody } from "./types";

/*
 * La firma de integridad de `POST /transactions` y el token de aceptación (punto 86).
 *
 * Nivel 1 — medido contra `sandbox.wompi.co` el 7 de octubre de 2026, entre las 21:06 y las
 * 21:27 (UTC−5), con PSE banco 1 (`docs/testing-data/wompi.md`). Cada rechazo es un `422` con
 * un solo campo y un solo mensaje, en el sobre `INPUT_VALIDATION_ERROR`:
 *
 * - sin `acceptance_token`: `acceptance_token: ["No está presente"]`, antes que la firma;
 * - sin `signature` o con `null`: `signature: ["Firma de integridad requerida no enviada"]`;
 * - cualquier otro valor que no sea el hex en minúsculas esperado (vacío, no hex, el secreto
 *   equivocado, la firma correcta en MAYÚSCULAS): `signature: ["La firma es inválida"]`;
 * - un `422` por firma gasta el token: reintentarlo, con cualquier firma, da
 *   `acceptance_token: ["El token de aceptación ya fue usado"]`.
 *
 * Fórmula: `SHA256(referencia + monto en centavos + divisa + secreto de integridad)`, la misma
 * de `computeIntegritySignature()` en el SDK (`sdk/src/infrastructure/adapters/wompi-pse.ts`).
 */

type ValidationBody = {
  error: { type: "INPUT_VALIDATION_ERROR"; messages: Record<string, string[]> };
};

function inputValidationError(field: string, message: string): ValidationBody {
  return { error: { type: "INPUT_VALIDATION_ERROR", messages: { [field]: [message] } } };
}

export const ACCEPTANCE_TOKEN_MISSING = inputValidationError("acceptance_token", "No está presente");
export const ACCEPTANCE_TOKEN_USED = inputValidationError(
  "acceptance_token",
  "El token de aceptación ya fue usado",
);
export const SIGNATURE_MISSING = inputValidationError(
  "signature",
  "Firma de integridad requerida no enviada",
);
export const SIGNATURE_INVALID = inputValidationError("signature", "La firma es inválida");

/** La firma que Wompi espera para este cuerpo, en hex minúsculas. */
export function computeWompiIntegritySignature(
  body: Pick<WompiCreateTransactionRequestBody, "reference" | "amount_in_cents" | "currency">,
  integritySecret: string,
): string {
  return createHash("sha256")
    .update(`${body.reference ?? ""}${body.amount_in_cents ?? ""}${body.currency ?? ""}${integritySecret}`)
    .digest("hex");
}

/**
 * Lo que se valida antes que la llave: que el token y la firma vengan.
 *
 * Que vengan es validación del cuerpo, y Wompi valida el cuerpo antes que la llave (un `{}` con
 * llave inexistente dio `422`, medido el 6 de octubre de 2026). Que la firma sea correcta, en
 * cambio, exige saber de qué comercio es el secreto, y eso lo dice la llave: por eso va en
 * `integrityRejection()`, después de la marca de credencial inválida. Ese orden entre la llave
 * y la firma incorrecta no se midió.
 */
export function missingFieldRejection(body: WompiCreateTransactionRequestBody): ValidationBody | undefined {
  if (!body.acceptance_token) {
    return ACCEPTANCE_TOKEN_MISSING;
  }
  if (body.signature === undefined || body.signature === null) {
    return SIGNATURE_MISSING;
  }
  return undefined;
}

/**
 * Los tokens de aceptación que un `422` por firma ya gastó.
 *
 * Solo se registra lo medido. No se registran los tokens que entrega `GET /merchants`, porque lo
 * que responde Wompi ante un token que nunca emitió no está medido y el simulador no inventa ese
 * mensaje: un token desconocido se acepta. Tampoco se gasta el token de un `201`: que un cobro
 * creado gaste el suyo es lo esperable de un token «de un solo uso», pero no se midió.
 *
 * Vive en la instancia de la ruta, como `SaltRegistry` en Rapyd, para que cada `buildApp()`
 * empiece limpio.
 */
export class SpentAcceptanceTokens {
  private readonly spent = new Set<string>();

  public has(token: string): boolean {
    return this.spent.has(token);
  }

  public spend(token: string): void {
    this.spent.add(token);
  }
}

/**
 * Token gastado y firma incorrecta, en ese orden (medido: el token gastado gana con cualquier
 * firma). Un rechazo por firma gasta el token, como en la medición.
 */
export function integrityRejection(
  body: WompiCreateTransactionRequestBody,
  integritySecret: string,
  spentTokens: SpentAcceptanceTokens,
): ValidationBody | undefined {
  const token = String(body.acceptance_token);
  if (spentTokens.has(token)) {
    return ACCEPTANCE_TOKEN_USED;
  }
  if (body.signature !== computeWompiIntegritySignature(body, integritySecret)) {
    spentTokens.spend(token);
    return SIGNATURE_INVALID;
  }
  return undefined;
}
