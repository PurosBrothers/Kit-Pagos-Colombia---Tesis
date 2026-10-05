import { KitPagos, Gateway, Credentials } from "kit-pagos-colombia";
import {
  ClientCredentialsRequiredError,
  CredentialResolver,
  RequestHeaders,
  ResolvedCredentials,
  loadServerEnv,
} from "../auth/CredentialResolver";
import { resolveTargetEnvironment, TargetEnvironment } from "../auth/targetEnvironment";

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
 * Mantiene instancias cacheadas por pasarela y por ambiente para el perfil del servidor,
 * y construye una instancia nueva bajo demanda cuando la petición trae cabeceras
 * con credenciales del cliente (costo despreciable: el constructor no abre sockets).
 *
 * Resuelve la URL desde un catálogo cerrado por ambiente (issue #123):
 * - simulator: se conecta a SIMULATOR_SDK_BASE_URL (o https://kit-pagos-colombia.onrender.com por omisión).
 * - sandbox: se conecta al sandbox oficial de cada pasarela (catálogo medido).
 * - production: se conecta al endpoint productivo oficial de cada pasarela (catálogo sin medir).
 */
export class KitPagosProvider {
  private readonly serverInstances: Map<string, KitPagos> = new Map();
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
   * El cliente declara el ambiente en la cabecera `x-kit-pagos-environment` (issue #123).
   * La regla de credenciales se aplica sobre el ambiente declarado (punto 69):
   *
   * - **simulator:** credenciales del servidor permitidas (sin advertencia).
   * - **sandbox:** credenciales del servidor permitidas, devolviendo la advertencia
   *   `SERVER_SANDBOX_CREDENTIALS_USED` para señalar que se usó la cuenta del equipo.
   * - **production:** solo credenciales del cliente. Sin ellas lanza
   *   `ClientCredentialsRequiredError` (HTTP 401) sin tocar la red.
   */
  public resolveClient(gateway: Gateway, headers?: RequestHeaders): GatewayClient {
    const target = resolveTargetEnvironment(headers, gateway);
    const missing = this.credentialResolver.missingClientHeaders(headers);

    if (missing.length > 0 && target === "production") {
      throw new ClientCredentialsRequiredError(gateway, missing);
    }

    const kitPagos = this.instanceFor(
      gateway,
      target,
      this.credentialResolver.resolve(gateway, headers),
    );

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
   * emite la notificación no puede elegir contra qué se verifica (punto 66).
   */
  public getWebhookVerifier(gateway: Gateway): KitPagos {
    return this.instanceFor(gateway, "simulator", this.credentialResolver.resolve(gateway));
  }

  private instanceFor(
    gateway: Gateway,
    target: TargetEnvironment,
    resolved: ResolvedCredentials,
  ): KitPagos {
    if (resolved.source === "client") {
      // Instancia creada al vuelo para credenciales suministradas por el cliente
      return this.createInstance(gateway, target, resolved.credentials);
    }

    const cacheKey = `${gateway}:${target}`;
    let instance = this.serverInstances.get(cacheKey);
    if (!instance) {
      instance = this.createInstance(gateway, target, resolved.credentials);
      this.serverInstances.set(cacheKey, instance);
    }
    return instance;
  }

  /**
   * Resuelve la URL base de simulación local o desplegada en Render.
   */
  public resolveSimulatorBaseUrl(gateway: Gateway): string {
    const globalVal = this.env.SIMULATOR_SDK_BASE_URL?.trim();
    if (globalVal) {
      const cleanBase = globalVal.replace(/\/$/, "");
      return `${cleanBase}/v1/sim/${gateway.toLowerCase()}`;
    }
    return `https://kit-pagos-colombia.onrender.com/v1/sim/${gateway.toLowerCase()}`;
  }

  private createInstance(
    gateway: Gateway,
    target: TargetEnvironment,
    credentials: Credentials,
  ): KitPagos {
    if (target === "simulator") {
      const baseUrl = this.resolveSimulatorBaseUrl(gateway);
      return new KitPagos({
        gateway,
        credentials: {
          [gateway]: credentials,
        },
        baseUrl,
      });
    }

    return new KitPagos({
      gateway,
      credentials: {
        [gateway]: credentials,
      },
      environment: target,
    });
  }
}
