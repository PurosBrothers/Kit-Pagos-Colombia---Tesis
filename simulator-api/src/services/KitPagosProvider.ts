import { KitPagos, Gateway, Credentials } from "kit-pagos-colombia";
import {
  CredentialResolver,
  RequestHeaders,
  ResolvedCredentials,
  loadServerEnv,
} from "../auth/CredentialResolver";

/**
 * Proveedor de instancias de KitPagos para la capa REST del Simulador API.
 *
 * Mantiene una instancia única por pasarela para el perfil del servidor (reutilización)
 * y construye una instancia nueva bajo demanda cuando la petición trae cabeceras
 * con credenciales del cliente (costo despreciable: el constructor no abre sockets).
 *
 * Permite configurar baseUrl por variable de entorno (<PASARELA>_BASE_URL o SIMULATOR_SDK_BASE_URL),
 * cayendo por defecto a http://localhost:3000/v1/sim/<pasarela>.
 */
export class KitPagosProvider {
  private readonly serverInstances: Map<Gateway, KitPagos> = new Map();
  private readonly credentialResolver: CredentialResolver;
  private readonly env: Record<string, string | undefined>;

  constructor(
    credentialResolver?: CredentialResolver,
    envOverride?: Record<string, string | undefined>,
  ) {
    this.env = envOverride ?? loadServerEnv();
    this.credentialResolver = credentialResolver ?? new CredentialResolver(this.env);
  }

  /**
   * Obtiene la instancia adecuada de KitPagos para la pasarela solicitada y cabeceras de la petición.
   */
  public getKitPagos(gateway: Gateway, headers?: RequestHeaders): KitPagos {
    const resolved: ResolvedCredentials = this.credentialResolver.resolve(gateway, headers);

    if (resolved.source === "server") {
      let instance = this.serverInstances.get(gateway);
      if (!instance) {
        instance = this.createInstance(gateway, resolved.credentials);
        this.serverInstances.set(gateway, instance);
      }
      return instance;
    }

    // Instancia creada al vuelo para credenciales suministradas por el cliente
    return this.createInstance(gateway, resolved.credentials);
  }

  /**
   * Resuelve la URL base configurada para la pasarela.
   */
  public resolveBaseUrl(gateway: Gateway): string | undefined {
    // 1. Variable específica por pasarela (ej: WOMPI_BASE_URL)
    const specificVar = `${gateway.toUpperCase()}_BASE_URL`;
    const specificVal = this.env[specificVar]?.trim();
    if (specificVal) {
      return specificVal;
    }

    // 2. Variable global para el SDK dentro del simulador
    const globalVal = this.env.SIMULATOR_SDK_BASE_URL?.trim();
    if (globalVal) {
      const cleanBase = globalVal.replace(/\/$/, "");
      return `${cleanBase}/v1/sim/${gateway.toLowerCase()}`;
    }

    return undefined;
  }

  private createInstance(gateway: Gateway, credentials: Credentials): KitPagos {
    const baseUrl = this.resolveBaseUrl(gateway);
    return new KitPagos({
      gateway,
      credentials: {
        [gateway]: credentials,
      },
      ...(baseUrl ? { baseUrl } : {}),
    });
  }
}
