import * as fs from "fs";
import * as path from "path";
import { Gateway, Credentials } from "kit-pagos-colombia";

export interface RequestHeaders {
  [header: string]: string | string[] | undefined;
}

export class MissingCredentialsError extends Error {
  constructor(public readonly gateway: Gateway | string) {
    super(
      `Missing credentials for gateway '${String(gateway).toLowerCase()}'. Configure server environment variables or provide x-gateway-public-key and x-gateway-private-key headers.`,
    );
    this.name = "MissingCredentialsError";
  }
}

export interface ResolvedCredentials {
  credentials: Credentials;
  source: "server" | "client";
}

/**
 * Lee el archivo .env de la raíz del repositorio fusionándolo con process.env,
 * aplicando el mismo criterio que sdk/test/sandbox/sandbox-env.ts.
 */
export function loadServerEnv(): Record<string, string | undefined> {
  const rootEnvPath = path.resolve(__dirname, "../../../.env");
  const entries: Record<string, string> = {};

  if (fs.existsSync(rootEnvPath)) {
    try {
      const content = fs.readFileSync(rootEnvPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
          continue;
        }
        const separator = trimmed.indexOf("=");
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim();
        if (key) {
          entries[key] = value;
        }
      }
    } catch {
      // Si no se puede leer, se confía en process.env
    }
  }

  return { ...entries, ...process.env };
}

/**
 * Normaliza y extrae un valor de cabecera como string limpio.
 */
function getHeaderValue(headers: RequestHeaders, headerName: string): string | undefined {
  const target = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      if (Array.isArray(value)) {
        return value[0]?.trim() || undefined;
      }
      return typeof value === "string" ? value.trim() || undefined : undefined;
    }
  }
  return undefined;
}

/**
 * Resuelve las credenciales de pasarela bajo un modelo híbrido:
 * 1. Cabeceras del cliente (x-gateway-public-key, x-gateway-private-key, x-gateway-integrity-secret).
 * 2. Perfil del servidor (.env / process.env).
 *
 * El webhookSecret NUNCA se acepta por cabecera y siempre proviene del perfil del servidor.
 */
export class CredentialResolver {
  private readonly env: Record<string, string | undefined>;

  constructor(envOverride?: Record<string, string | undefined>) {
    this.env = envOverride ?? loadServerEnv();
  }

  /**
   * Resuelve las credenciales para la pasarela solicitada.
   * Lanza MissingCredentialsError si no hay credenciales completas ni en cabeceras ni en el servidor.
   */
  public resolve(gateway: Gateway, headers?: RequestHeaders): ResolvedCredentials {
    // 1. Intentar resolver por cabeceras del cliente si están presentes
    if (headers) {
      const clientCreds = this.resolveFromHeaders(gateway, headers);
      if (clientCreds) {
        return {
          credentials: clientCreds,
          source: "client",
        };
      }
    }

    // 2. Intentar resolver por perfil del servidor
    const serverCreds = this.resolveFromServerProfile(gateway);
    if (serverCreds) {
      return {
        credentials: serverCreds,
        source: "server",
      };
    }

    // 3. Si no hay credenciales completas en ninguna fuente, lanzar error seguro
    throw new MissingCredentialsError(gateway);
  }

  /**
   * Obtiene las credenciales del perfil del servidor para una pasarela dada.
   */
  public getServerCredentials(gateway: Gateway): Credentials | undefined {
    return this.resolveFromServerProfile(gateway);
  }

  private resolveFromHeaders(gateway: Gateway, headers: RequestHeaders): Credentials | undefined {
    const publicKey = getHeaderValue(headers, "x-gateway-public-key");
    const privateKey = getHeaderValue(headers, "x-gateway-private-key");

    // Ambos son obligatorios para considerar que el cliente envió credenciales completas
    if (!publicKey || !privateKey) {
      return undefined;
    }

    const credentials: Credentials = {
      publicKey,
      privateKey,
    };

    // Solo Wompi usa integritySecret para cobros salientes
    if (gateway === Gateway.WOMPI) {
      const integritySecret = getHeaderValue(headers, "x-gateway-integrity-secret");
      if (integritySecret) {
        credentials.integritySecret = integritySecret;
      }
    }

    // El webhookSecret NUNCA se toma de las cabeceras; siempre se asocia el del servidor si existe
    const serverWebhookSecret = this.getServerWebhookSecret(gateway);
    if (serverWebhookSecret) {
      credentials.webhookSecret = serverWebhookSecret;
    }

    return credentials;
  }

  private resolveFromServerProfile(gateway: Gateway): Credentials | undefined {
    switch (gateway) {
      case Gateway.WOMPI: {
        const publicKey = this.env.WOMPI_PUBLIC_KEY?.trim();
        const privateKey = this.env.WOMPI_PRIVATE_KEY?.trim();
        if (!publicKey || !privateKey) return undefined;

        const creds: Credentials = { publicKey, privateKey };
        const integrity = this.env.WOMPI_INTEGRITY_SECRET?.trim();
        if (integrity) creds.integritySecret = integrity;

        const events = this.env.WOMPI_EVENTS_SECRET?.trim();
        if (events) creds.webhookSecret = events;

        return creds;
      }

      case Gateway.MERCADOPAGO: {
        const publicKey = this.env.MERCADOPAGO_PUBLIC_KEY?.trim();
        const privateKey = this.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
        if (!publicKey || !privateKey) return undefined;

        const creds: Credentials = { publicKey, privateKey };
        const webhookSecret = this.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
        if (webhookSecret) creds.webhookSecret = webhookSecret;

        return creds;
      }

      case Gateway.KUSHKI: {
        const publicKey = this.env.KUSHKI_PUBLIC_MERCHANT_ID?.trim();
        const privateKey = this.env.KUSHKI_PRIVATE_MERCHANT_ID?.trim();
        if (!publicKey || !privateKey) return undefined;

        const creds: Credentials = { publicKey, privateKey };
        const webhookSecret = this.env.KUSHKI_WEBHOOK_SIGNATURE_ID?.trim();
        if (webhookSecret) creds.webhookSecret = webhookSecret;

        return creds;
      }

      case Gateway.RAPYD: {
        const publicKey = this.env.RAPYD_API_ACCESS_KEY?.trim();
        const privateKey = this.env.RAPYD_API_SECRET_KEY?.trim();
        if (!publicKey || !privateKey) return undefined;

        // Rapyd reutiliza su secret_key para webhooks
        return {
          publicKey,
          privateKey,
          webhookSecret: privateKey,
        };
      }

      default:
        return undefined;
    }
  }

  private getServerWebhookSecret(gateway: Gateway): string | undefined {
    switch (gateway) {
      case Gateway.WOMPI:
        return this.env.WOMPI_EVENTS_SECRET?.trim();
      case Gateway.MERCADOPAGO:
        return this.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
      case Gateway.KUSHKI:
        return this.env.KUSHKI_WEBHOOK_SIGNATURE_ID?.trim();
      case Gateway.RAPYD:
        return this.env.RAPYD_API_SECRET_KEY?.trim();
      default:
        return undefined;
    }
  }
}
