import { KitPagos, Gateway, Credentials } from "kit-pagos-colombia";
import {
  ClientCredentialsRequiredError,
  CredentialResolver,
  RequestHeaders,
  ResolvedCredentials,
  loadServerEnv,
} from "../auth/CredentialResolver";
import { classifyTarget, TargetEnvironment } from "../auth/targetEnvironment";

/** Cabecera de respuesta con la advertencia del respaldo en sandbox. */
export const CREDENTIAL_WARNING_HEADER = "x-kit-pagos-warning";

/** Instancia del SDK para una petición, con la advertencia que haya que devolver. */
export interface GatewayClient {
  kitPagos: KitPagos;
  target: TargetEnvironment;
  warning?: string;
}

/**
 * Texto de la advertencia. Va en una cabecera HTTP, que fuera de ASCII cada cliente
 * decodifica distinto, así que está redactado sin palabras con tilde.
 */
function sandboxFallbackWarning(missing: readonly string[]): string {
  return (
    "Para pruebas futuras se recomienda utilizar las credenciales propias. " +
    "Se usaron las credenciales de sandbox del servidor porque falta: " +
    `${missing.join(", ")}.`
  );
}

/**
 * Proveedor de instancias de KitPagos para la capa REST del Simulador API.
 *
 * Mantiene una instancia única por pasarela para el perfil del servidor (reutilización)
 * y construye una instancia nueva bajo demanda cuando la petición trae cabeceras
 * con credenciales del cliente (costo despreciable: el constructor no abre sockets).
 *
 * Permite configurar baseUrl por variable de entorno (<PASARELA>_BASE_URL o SIMULATOR_SDK_BASE_URL),
 * cayendo por defecto a http://localhost:3000/v1/sim/<pasarela>. La URL decide además qué
 * credenciales se pueden usar: ver `resolveClient()`.
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
   * Instancia para una operación que llama a la pasarela: cobro, consulta o bancos.
   *
   * Qué credenciales usa depende de a dónde apunta la API (punto 68):
   *
   * - **Simulador:** las del cliente si vienen completas y, si no, las del servidor.
   * - **Sandbox real:** igual, pero cuando usa las del servidor devuelve una
   *   advertencia para la respuesta, porque el cliente está probando con la cuenta
   *   del equipo y no con la suya.
   * - **Producción:** solo las del cliente. Sin ellas lanza
   *   `ClientCredentialsRequiredError`, aunque el servidor tenga llaves, porque
   *   usarlas cobraría con la cuenta de quien desplegó la API.
   */
  public resolveClient(gateway: Gateway, headers?: RequestHeaders): GatewayClient {
    const missing = this.credentialResolver.missingClientHeaders(headers);
    const target = classifyTarget(gateway, this.resolveBaseUrl(gateway));

    if (missing.length > 0 && target === "production") {
      throw new ClientCredentialsRequiredError(gateway, missing);
    }

    const kitPagos = this.instanceFor(gateway, this.credentialResolver.resolve(gateway, headers));
    if (missing.length > 0 && target === "sandbox") {
      return { kitPagos, target, warning: sandboxFallbackWarning(missing) };
    }
    return { kitPagos, target };
  }

  /**
   * Instancia para verificar webhooks, siempre con el perfil del servidor.
   *
   * No pasa por la regla de `resolveClient()` porque verificar no llama a la
   * pasarela, y porque el secreto del webhook nunca se acepta del cliente: quien
   * emite la notificación no puede elegir contra qué se verifica (punto 65).
   */
  public getWebhookVerifier(gateway: Gateway): KitPagos {
    return this.instanceFor(gateway, this.credentialResolver.resolve(gateway));
  }

  private instanceFor(gateway: Gateway, resolved: ResolvedCredentials): KitPagos {
    if (resolved.source === "client") {
      // Instancia creada al vuelo para credenciales suministradas por el cliente
      return this.createInstance(gateway, resolved.credentials);
    }

    let instance = this.serverInstances.get(gateway);
    if (!instance) {
      instance = this.createInstance(gateway, resolved.credentials);
      this.serverInstances.set(gateway, instance);
    }
    return instance;
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
