import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp, BuildAppOptions } from "../../src/app";
import { rapydSecretKey, wompiIntegritySecret } from "../../src/auth/merchantSecrets";
import { computeWompiIntegritySignature } from "../../src/gateways/wompi/integritySignature";
import { computeRapydRequestSignature } from "../../src/gateways/rapyd/requestSignature";

/*
 * Firma las peticiones de prueba como lo hace el SDK, para las pruebas que ejercitan otra cosa
 * que la firma (punto 86). Las pruebas de la firma usan `buildApp()` sin esto y mandan cada
 * cabecera y cada campo a mano.
 *
 * El secreto es el que usa la app, leído con las mismas funciones que las rutas: así la prueba
 * firma bien con o sin `.env` en la raíz y con el `CredentialResolver` que traiga cada prueba.
 * Lo que la prueba ya trae se respeta: un `signature` o un `acceptance_token` explícitos no se
 * reemplazan, y un `access_key` explícito se firma tal cual.
 */

/** El `access_key` que se firma cuando la prueba no trae uno. No es una llave real. */
export const TEST_RAPYD_ACCESS_KEY = "rak_test_simulator";

function pathOf(url: string): string {
  return url.split("?")[0];
}

function signWompi(app: FastifyInstance, options: InjectOptions): InjectOptions {
  const body = options.payload;
  if (typeof body !== "object" || body === null || Array.isArray(body) || Buffer.isBuffer(body)) {
    return options;
  }
  const fields = body as Record<string, unknown>;
  const signed: Record<string, unknown> = { ...fields };
  if (!("acceptance_token" in fields)) {
    signed.acceptance_token = `sim_acceptance_${randomUUID()}`;
  }
  if (!("signature" in fields)) {
    signed.signature = computeWompiIntegritySignature(
      fields as { reference: string; amount_in_cents: number; currency: string },
      wompiIntegritySecret(app.credentialResolver),
    );
  }
  return { ...options, payload: signed };
}

function signRapyd(app: FastifyInstance, options: InjectOptions): InjectOptions {
  const headers = { ...(options.headers ?? {}) } as Record<string, string>;
  if (headers.signature !== undefined) {
    return options;
  }

  const payload = options.payload;
  const body =
    payload === undefined ? "" : typeof payload === "string" ? payload : JSON.stringify(payload);
  const accessKey = headers.access_key ?? TEST_RAPYD_ACCESS_KEY;
  const salt = randomBytes(8).toString("hex");
  const timestamp = String(Math.floor(Date.now() / 1000));

  headers.access_key = accessKey;
  headers.salt = salt;
  headers.timestamp = timestamp;
  headers.signature = computeRapydRequestSignature(
    { method: options.method ?? "GET", urlPath: options.url as string, salt, timestamp, accessKey, body },
    rapydSecretKey(app.credentialResolver),
  );
  if (body !== "") {
    headers["content-type"] = "application/json";
  }

  return { ...options, headers, payload: body === "" ? undefined : body };
}

function sign(app: FastifyInstance, options: InjectOptions): InjectOptions {
  const path = pathOf(String(options.url ?? ""));
  const method = String(options.method ?? "GET").toUpperCase();

  if (method === "POST" && path === "/v1/sim/wompi/transactions") {
    return signWompi(app, options);
  }
  if (path.startsWith("/v1/sim/rapyd/") && !/\/(pay|pagar)$/.test(path)) {
    return signRapyd(app, options);
  }
  return options;
}

/** Hace que `app.inject()` firme las peticiones a Wompi y a Rapyd como el SDK. */
export function signSimulatorRequests(app: FastifyInstance): FastifyInstance {
  const inject = app.inject.bind(app) as (options: InjectOptions) => ReturnType<FastifyInstance["inject"]>;
  (app as unknown as { inject: (options: InjectOptions) => unknown }).inject = (options: InjectOptions) =>
    inject(sign(app, options));
  return app;
}

/** `buildApp()` con `signSimulatorRequests()` aplicado. */
export function buildSignedApp(options?: BuildAppOptions): FastifyInstance {
  return signSimulatorRequests(buildApp(options));
}
