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

/** Las dos cabeceras sin las que la petición no trae credenciales propias. */
export const CLIENT_CREDENTIAL_HEADERS = [
  "x-gateway-public-key",
  "x-gateway-private-key",
] as const;

/**
 * La API apunta a una pasarela real que no es un sandbox conocido, y la petición no
 * trae credenciales propias completas. Contra producción las del servidor no se
 * prestan, porque cobrarían con la cuenta de quien desplegó la API (punto 69).
 */
export class ClientCredentialsRequiredError extends Error {
  constructor(
    public readonly gateway: Gateway | string,
    public readonly missingHeaders: readonly string[],
  ) {
    const name = String(gateway).toLowerCase();
    super(
      `La API está configurada contra la pasarela real de ${name} y no la puede ` +
        `identificar como sandbox, así que la trata como producción. En producción no ` +
        `usa las credenciales del servidor: cobraría con la cuenta de quien desplegó la ` +
        `API. Envíe las credenciales de su propia cuenta de ${name} en ` +
        `${CLIENT_CREDENTIAL_HEADERS.join(" y ")}. Falta: ${missingHeaders.join(", ")}.`,
    );
    this.name = "ClientCredentialsRequiredError";
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
  const candidatePaths = [
    path.resolve(__dirname, "../../../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    "/etc/secrets/.env",
  ];
  const entries: Record<string, string> = {};

  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
            continue;
          }
          const separator = trimmed.indexOf("=");
          const key = trimmed.slice(0, separator).trim();
          const value = trimmed.slice(separator + 1).trim();
          if (key && !(key in entries)) {
            entries[key] = value;
          }
        }
      } catch {
        // Si no se puede leer, se ignora
      }
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

/** Una credencial opcional del perfil: el campo de `Credentials` y las variables de donde sale. */
interface OptionalCredential {
  readonly field: "integritySecret" | "webhookSecret" | "webhookUrl";
  /** En orden: gana la primera con valor, así que una línea vacía no tapa a la siguiente. */
  readonly vars: readonly string[];
}

/** De qué variables de entorno salen las credenciales del servidor para una pasarela. */
interface ServerProfile {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly optional: readonly OptionalCredential[];
  /** Rapyd firma sus webhooks con la misma `secret_key` de la API (punto 54). */
  readonly privateKeyIsWebhookSecret?: boolean;
}

/**
 * Las cuatro pasarelas leen la misma forma —dos claves obligatorias y algunas opcionales—, y
 * escribirla como tabla es lo que baja el WMC: un `switch` con un `case` por pasarela repetía la
 * lógica cuatro veces (punto 34, issue #153).
 */
const SERVER_PROFILES: Readonly<Record<Gateway, ServerProfile>> = {
  [Gateway.WOMPI]: {
    publicKey: "WOMPI_PUBLIC_KEY",
    privateKey: "WOMPI_PRIVATE_KEY",
    optional: [
      { field: "integritySecret", vars: ["WOMPI_INTEGRITY_SECRET"] },
      { field: "webhookSecret", vars: ["WOMPI_EVENTS_SECRET"] },
    ],
  },
  [Gateway.MERCADOPAGO]: {
    publicKey: "MERCADOPAGO_PUBLIC_KEY",
    privateKey: "MERCADOPAGO_ACCESS_TOKEN",
    optional: [{ field: "webhookSecret", vars: ["MERCADOPAGO_WEBHOOK_SECRET"] }],
  },
  [Gateway.KUSHKI]: {
    publicKey: "KUSHKI_PUBLIC_MERCHANT_ID",
    privateKey: "KUSHKI_PRIVATE_MERCHANT_ID",
    // Una línea `KUSHKI_WEBHOOK_SECRET=` vacía, como la de `.env.example`, no tapa el alias.
    optional: [{ field: "webhookSecret", vars: ["KUSHKI_WEBHOOK_SECRET", "KUSHKI_WEBHOOK_SIGNATURE_ID"] }],
  },
  [Gateway.RAPYD]: {
    publicKey: "RAPYD_API_ACCESS_KEY",
    privateKey: "RAPYD_API_SECRET_KEY",
    privateKeyIsWebhookSecret: true,
    // Rapyd firma además la URL registrada en su panel, que solo puede salir de la configuración (punto 67).
    optional: [{ field: "webhookUrl", vars: ["RAPYD_WEBHOOK_URL"] }],
  },
};

function firstValue(env: Record<string, string | undefined>, vars: readonly string[]): string | undefined {
  for (const name of vars) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function credentialsFromProfile(
  env: Record<string, string | undefined>,
  profile: ServerProfile,
): Credentials | undefined {
  const publicKey = env[profile.publicKey]?.trim();
  const privateKey = env[profile.privateKey]?.trim();
  if (!publicKey || !privateKey) {
    return undefined;
  }

  const credentials: Credentials = { publicKey, privateKey };
  if (profile.privateKeyIsWebhookSecret) {
    credentials.webhookSecret = privateKey;
  }
  for (const { field, vars } of profile.optional) {
    const value = firstValue(env, vars);
    if (value) {
      credentials[field] = value;
    }
  }
  return credentials;
}

/**
 * Resuelve las credenciales de pasarela bajo un modelo híbrido:
 * 1. Cabeceras del cliente (x-gateway-public-key, x-gateway-private-key, x-gateway-integrity-secret).
 * 2. Perfil del servidor (.env / process.env).
 *
 * El webhookSecret NUNCA se acepta por cabecera: solo existe en el perfil del servidor.
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
   * Cabeceras de credenciales que la petición no trae. Vacío significa que el
   * cliente mandó credenciales completas; una sola significa que las mandó a medias,
   * que es el caso que hoy cae en silencio al perfil del servidor.
   */
  public missingClientHeaders(headers?: RequestHeaders): string[] {
    return CLIENT_CREDENTIAL_HEADERS.filter(
      (header) => !headers || !getHeaderValue(headers, header),
    );
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

    // Sin webhookSecret: ni el del cliente ni el del servidor. Los webhooks se verifican
    // con el perfil del servidor (`getWebhookVerifier()`), y pegar aquí su secreto lo
    // mezclaría con llaves ajenas, incluidas las de producción (punto 70).
    return credentials;
  }

  private resolveFromServerProfile(gateway: Gateway): Credentials | undefined {
    const profile = SERVER_PROFILES[gateway];
    return profile ? credentialsFromProfile(this.env, profile) : undefined;
  }
}
