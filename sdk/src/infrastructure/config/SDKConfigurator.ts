import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Environment, parseEnvironment } from "../../domain/value-objects/Environment";
import { resolveGatewayCatalogUrl } from "./gateway-urls";

export interface SDKOptions {
  gateway: Gateway;
  credentials: Partial<Record<Gateway, Credentials>>;
  /**
   * Ambiente de ejecución. Resuelve automáticamente las URLs oficiales
   * de cada pasarela desde un catálogo cerrado:
   * - "simulator": API de simulación (por defecto https://kit-pagos-colombia.onrender.com/v1/sim/<pasarela>).
   * - "sandbox": Sandboxes oficiales medidos de cada proveedor.
   * - "production": Endpoints productivos oficiales de cada proveedor (sin medir).
   * Por defecto: "simulator".
   */
  environment?: Environment;
  /**
   * Sobrescribe el endpoint de la pasarela activa o de cada pasarela individual.
   * Su razón de ser es apuntar el SDK a la API de Simulación (local o desplegada)
   * o a endpoints personalizados. Tiene precedencia sobre `environment`.
   * Puede ser una cadena de texto (URL global) o un mapeo parcial por pasarela.
   */
  baseUrl?: string | Partial<Record<Gateway, string>>;
  maxRetries?: number;
  /**
   * Tolerancia en segundos para la verificación del timestamp de webhooks (replay protection).
   * Por defecto: 300 segundos (5 minutos). Configurar 0 desactiva la validación.
   */
  webhookToleranceSeconds?: number;
}

export class SdkConfigurator {
  private activeGateway?: Gateway;
  private credentialsMap: Map<Gateway, Credentials> = new Map();
  private environment: Environment = Environment.SIMULATOR;
  private baseUrl?: string | Partial<Record<Gateway, string>>;
  private maxRetries?: number;
  private webhookToleranceSeconds?: number;

  configure(options: SDKOptions): void {
    const gateway = options.gateway;
    const credentials = options.credentials;
    if (!gateway || !credentials) {
      throw new KitPagosError(
        KitPagosErrorCode.INVALID_REQUEST,
        gateway,
        null,
        "Both gateway and credentials must be configured"
      );
    }
    this.activeGateway = gateway;
    this.environment = options.environment !== undefined
      ? parseEnvironment(options.environment, gateway)
      : Environment.SIMULATOR;
    this.baseUrl = options.baseUrl;
    this.credentialsMap.clear();
    this.maxRetries = options.maxRetries;
    this.webhookToleranceSeconds = options.webhookToleranceSeconds;

    Object.entries(credentials).forEach(([key, value]) => {
      this.credentialsMap.set(key as Gateway, value as Credentials);
    });
  }

  getActiveGateway(): Gateway {
    if (!this.activeGateway) {
      throw new Error("No active gateway has been configured");
    }
    return this.activeGateway;
  }

  getEnvironment(): Environment {
    return this.environment;
  }

  /**
   * Endpoint configurado para la pasarela pedida o la activa.
   * Si se especificó `baseUrl`, este toma precedencia.
   * De lo contrario, se resuelve desde el catálogo cerrado para el `environment` configurado.
   */
  getBaseUrl(gateway?: Gateway): string {
    const targetGateway = gateway ?? this.activeGateway;
    if (typeof this.baseUrl === "string") {
      return this.baseUrl;
    }
    if (this.baseUrl && typeof this.baseUrl === "object" && targetGateway && this.baseUrl[targetGateway]) {
      return this.baseUrl[targetGateway]!;
    }
    if (targetGateway) {
      return resolveGatewayCatalogUrl(targetGateway, this.environment);
    }
    return "";
  }

  getMaxRetries(): number | undefined {
    return this.maxRetries;
  }

  getWebhookToleranceSeconds(): number | undefined {
    return this.webhookToleranceSeconds;
  }

  getCredentials(gateway: Gateway): Credentials {
    const creds = this.credentialsMap.get(gateway);
    if (!creds) {
      throw new KitPagosError(
        KitPagosErrorCode.INVALID_CREDENTIALS,
        gateway,
        null,
        `Credentials not configured for gateway: ${gateway}`
      ); // (Cumplimiento de RF-08)
    }
    return creds;
  }
}