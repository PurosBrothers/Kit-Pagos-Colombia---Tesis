import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";

export interface SDKOptions {
  gateway: Gateway;
  credentials: Partial<Record<Gateway, Credentials>>;
  /**
   * Sobrescribe el endpoint de la pasarela activa. Su razon de ser es apuntar
   * el SDK a la API de Simulacion (local o desplegada) sin tocar codigo, que
   * es el modo de trabajo que exige RF-09. Si se omite, cada Adapter usa la
   * URL por defecto de su pasarela.
   */
  baseUrl?: string;
}

export class SdkConfigurator {
  private activeGateway?: Gateway;
  private credentialsMap: Map<Gateway, Credentials> = new Map();
  private baseUrl?: string;

  configure(options: SDKOptions): void {
    const gateway = options.gateway;
    const credentials = options.credentials;
    if (!gateway || !credentials) {
      throw new SdkError(
        SdkErrorCode.INVALID_REQUEST,
        gateway,
        null,
        "Both gateway and credentials must be configured"
      );
    }
    this.activeGateway = gateway;
    this.baseUrl = options.baseUrl;
    this.credentialsMap.clear();

    Object.entries(credentials).forEach(([key, value]) => {
      this.credentialsMap.set(key as Gateway, value as Credentials);
    });
  }

  getActiveGateway(): Gateway {
    if (!this.activeGateway) {
      // Se mantiene Error nativo y no SdkError: este fallo ocurre antes de que
      // exista una pasarela, y SdkError exige el atributo gateway por la
      // seccion 15.1 del SAD. Convertirlo obligaria a ensanchar ese contrato
      // del dominio, decision que no corresponde a este issue
      // (ver docs/architecture/architecture-log.md, punto 20).
      throw new Error("No active gateway has been configured");
    }
    return this.activeGateway;
  }

  /** Endpoint configurado para la pasarela activa, si el comercio lo sobrescribio. */
  getBaseUrl(): string | undefined {
    return this.baseUrl;
  }

  getCredentials(gateway: Gateway): Credentials {
    const creds = this.credentialsMap.get(gateway);
    if (!creds) {
      throw new SdkError(
        SdkErrorCode.INVALID_CREDENTIALS,
        gateway,
        null,
        `Credentials not configured for gateway: ${gateway}`
      ); // (Cumplimiento de RF-08)
    }
    return creds;
  }
}