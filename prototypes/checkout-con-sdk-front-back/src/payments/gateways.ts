import { Gateway } from "kit-pagos-colombia";
import type { Credentials } from "kit-pagos-colombia";
import type { GatewayOption } from "../checkout/PaymentsPort";

/**
 * Las pasarelas del prototipo B, en el orden en que se ofrecen al comprador. Agregar una es
 * agregar su entrada: cómo se presenta, qué llaves exige el sandbox y cómo se leen sus
 * credenciales. Todo lo demás lo resuelve `kit-pagos-colombia` (punto 117 del `architecture-log.md`).
 */
export interface GatewaySetup {
  option: GatewayOption;
  gateway: Gateway;
  /** Las variables sin las que la pasarela no cobra en su sandbox oficial. */
  sandboxKeys: readonly string[];
  /** La variable que apunta la pasarela a otro simulador a propósito. */
  baseUrlVariable: string;
  /** Las credenciales del entorno, con valores de prueba para el simulador cuando faltan. */
  credentials(env: NodeJS.ProcessEnv): Credentials;
}

export function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Credenciales de prueba para cuando el entorno no trae las de Wompi. No son secretos ni
 * apuntan a producción; siguen la convención de `examples/` y no llevan las marcas
 * (`invalid`, `inexistente`, `not_found`) con las que el simulador fuerza la respuesta de
 * credencial inválida.
 */
const DEFAULT_PUBLIC_KEY = "pub_test_ejemplo_no_real";
const DEFAULT_PRIVATE_KEY = "prv_test_ejemplo_no_real";

/** El secreto de integridad de Wompi cuando el simulador no configura uno propio. */
const DEFAULT_INTEGRITY_SECRET = "test_integrity_kit_pagos_simulator";

/** Wompi, la pasarela del #151. */
const WOMPI: GatewaySetup = {
  option: { id: "wompi", name: "Wompi", cardCapture: "BROWSER_TOKEN" },
  gateway: Gateway.WOMPI,
  sandboxKeys: ["WOMPI_PUBLIC_KEY", "WOMPI_PRIVATE_KEY", "WOMPI_INTEGRITY_SECRET"],
  baseUrlVariable: "WOMPI_BASE_URL",
  credentials: (env) => {
    const credentials: Credentials = {
      publicKey: readEnv(env, "WOMPI_PUBLIC_KEY") ?? DEFAULT_PUBLIC_KEY,
      privateKey: readEnv(env, "WOMPI_PRIVATE_KEY") ?? DEFAULT_PRIVATE_KEY,
      // El cobro con Wompi exige firma de integridad aunque sea el simulador: sin el secreto,
      // el adaptador lanza INVALID_CREDENTIALS antes de la llamada.
      integritySecret: readEnv(env, "WOMPI_INTEGRITY_SECRET") ?? DEFAULT_INTEGRITY_SECRET,
    };
    const webhookSecret = readEnv(env, "WOMPI_EVENTS_SECRET");
    if (webhookSecret) credentials.webhookSecret = webhookSecret;
    return credentials;
  },
};

/** Mercado Pago: el access token cobra y la llave pública tokeniza en el navegador. */
const MERCADOPAGO: GatewaySetup = {
  option: { id: "mercadopago", name: "Mercado Pago", cardCapture: "BROWSER_TOKEN" },
  gateway: Gateway.MERCADOPAGO,
  sandboxKeys: ["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_PUBLIC_KEY"],
  baseUrlVariable: "MERCADOPAGO_BASE_URL",
  credentials: (env) => {
    const credentials: Credentials = {
      publicKey: readEnv(env, "MERCADOPAGO_PUBLIC_KEY") ?? "TEST-simulador-kit-pagos-publica",
      privateKey: readEnv(env, "MERCADOPAGO_ACCESS_TOKEN") ?? "TEST-simulador-kit-pagos",
    };
    const webhookSecret = readEnv(env, "MERCADOPAGO_WEBHOOK_SECRET");
    if (webhookSecret) credentials.webhookSecret = webhookSecret;
    return credentials;
  },
};

export const GATEWAYS: readonly GatewaySetup[] = [WOMPI, MERCADOPAGO];
