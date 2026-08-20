import { SdkErrorCode } from "../value-objects/SdkErrorCode";
import { Gateway } from "../value-objects/Gateway";

/**
 * Excepcion tipada y unificada del SDK.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "SdkError extiende la
 * clase Error nativa de JavaScript y anade los atributos code (del tipo
 * SdkErrorCode), gateway y originalPayload, este ultimo tipado como unknown
 * para forzar una verificacion explicita antes de su uso."
 */
export class SdkError extends Error {
  constructor(
    public readonly code: SdkErrorCode,
    public readonly gateway: Gateway,
    public readonly originalPayload: unknown,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "SdkError";
  }
}
