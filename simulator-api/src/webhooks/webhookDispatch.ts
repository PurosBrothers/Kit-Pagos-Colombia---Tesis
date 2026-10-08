import { OutgoingWebhook } from "./SignatureGenerator";

/** Marcador que el destino puede llevar para separar las pasarelas en un mismo receptor. */
export const GATEWAY_PLACEHOLDER = "{gateway}";

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Configuración de la salida de webhooks. Es solo del servidor: ninguna petición la cambia,
 * porque un destino elegido por quien llama convertiría al simulador en un proxy (SSRF).
 */
export interface WebhookDispatchConfig {
  /** `SIMULATOR_WEBHOOK_TARGET_URL`. Sin él no sale ningún webhook. */
  targetUrl?: string;
  /** `SIMULATOR_WEBHOOK_AUTO=true`. Solo emite si además hay destino. */
  auto: boolean;
  /** `SIMULATOR_WEBHOOK_TIMEOUT_MS`, 5000 por omisión. */
  timeoutMs: number;
}

export function webhookConfigFromEnv(env: Record<string, string | undefined>): WebhookDispatchConfig {
  const timeout = Number(env.SIMULATOR_WEBHOOK_TIMEOUT_MS);
  return {
    targetUrl: env.SIMULATOR_WEBHOOK_TARGET_URL?.trim() || undefined,
    auto: env.SIMULATOR_WEBHOOK_AUTO?.trim() === "true",
    timeoutMs: Number.isInteger(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Rechaza al arrancar un destino que no sea http/https o que lleve usuario y clave: un
 * error de configuración se ve al iniciar y no en el primer webhook.
 */
export function assertValidTarget(targetUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(withGateway(targetUrl, "wompi"));
  } catch {
    throw new Error("SIMULATOR_WEBHOOK_TARGET_URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("SIMULATOR_WEBHOOK_TARGET_URL must use http or https.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("SIMULATOR_WEBHOOK_TARGET_URL must not carry credentials.");
  }
}

export class WebhookTargetNotConfiguredError extends Error {
  constructor() {
    super("SIMULATOR_WEBHOOK_TARGET_URL is not configured; the webhook was not sent.");
    this.name = "WebhookTargetNotConfiguredError";
  }
}

/** Envía un webhook firmado al destino de la configuración. */
export class WebhookDispatcher {
  constructor(private readonly config: WebhookDispatchConfig) {
    if (config.targetUrl !== undefined) {
      assertValidTarget(config.targetUrl);
    }
  }

  get hasTarget(): boolean {
    return this.config.targetUrl !== undefined;
  }

  get autoEnabled(): boolean {
    return this.config.auto && this.hasTarget;
  }

  get autoRequested(): boolean {
    return this.config.auto;
  }

  /**
   * @returns El código HTTP del receptor. Su cuerpo no se lee ni se devuelve.
   * @throws WebhookTargetNotConfiguredError sin destino; el error de `fetch` si no responde a tiempo.
   */
  async deliver(webhook: OutgoingWebhook): Promise<{ receiverStatus: number }> {
    if (this.config.targetUrl === undefined) {
      throw new WebhookTargetNotConfiguredError();
    }
    const response = await globalThis.fetch(urlFor(this.config.targetUrl, webhook), {
      method: "POST",
      headers: webhook.headers,
      body: webhook.body,
      signal: AbortSignal.timeout(this.config.timeoutMs),
      // Una redirección del receptor no lleva el webhook a otro host.
      redirect: "manual",
    });
    await response.body?.cancel();
    return { receiverStatus: response.status };
  }
}

function urlFor(targetUrl: string, webhook: OutgoingWebhook): string {
  const base = withGateway(targetUrl, webhook.gateway.toLowerCase());
  if (webhook.query === null) {
    return base;
  }
  return `${base}${base.includes("?") ? "&" : "?"}${webhook.query}`;
}

function withGateway(targetUrl: string, gateway: string): string {
  return targetUrl.split(GATEWAY_PLACEHOLDER).join(gateway);
}
