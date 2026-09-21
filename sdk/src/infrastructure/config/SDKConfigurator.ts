import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

export interface SDKOptions {
  gateway: Gateway;
  credentials: Partial<Record<Gateway, Credentials>>;
  /**
   * Sobrescribe el endpoint de la pasarela activa o de cada pasarela individual.
   * Su razón de ser es apuntar el SDK a la API de Simulación (local o desplegada)
   * o a los endpoints de producción de cada proveedor sin tocar código.
   * Puede ser una cadena de texto (URL global) o un mapeo parcial por pasarela.
   * Si se omite, cada Adapter usa la URL por defecto hacia el api-simulator.
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
      // Se mantiene Error nativo y no KitPagosError: este fallo ocurre antes de que
      // exista una pasarela, y KitPagosError exige el atributo gateway por la
      // seccion 15.1 del SAD. Convertirlo obligaria a ensanchar ese contrato
      // del dominio, decision que no corresponde a este issue
      // (ver docs/architecture/architecture-log.md, punto 20).
      throw new Error("No active gateway has been configured");
    }
    return this.activeGateway;
  }

  /**
   * Endpoint configurado para la pasarela pedida o la activa, si el comercio lo sobrescribió.
   * Si se configuró como objeto por pasarela, devuelve la URL de esa pasarela específica.
   * Si se configuró como string global, devuelve esa misma URL para cualquier pasarela.
   */
  getBaseUrl(gateway?: Gateway): string | undefined {
    if (typeof this.baseUrl === "string") {
      return this.baseUrl;
    }
    if (this.baseUrl && typeof this.baseUrl === "object") {
      const targetGateway = gateway ?? this.activeGateway;
      return targetGateway ? this.baseUrl[targetGateway] : undefined;
    }
    return undefined;
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