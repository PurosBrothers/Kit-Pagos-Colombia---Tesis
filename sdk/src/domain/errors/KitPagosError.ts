import { KitPagosErrorCode } from "../value-objects/KitPagosErrorCode";
import { Gateway } from "../value-objects/Gateway";

/**
 * Excepcion tipada y unificada de Kit Pagos Colombia.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - Renombrado de SdkError a
 * KitPagosError para evitar colisiones con clases de error genericas de otros
 * SDKs integrados por los comercios (decision de direccion de tesis,
 * docs/architecture/architecture-log.md, punto 23).
 */
export class KitPagosError extends Error {
  constructor(
    public readonly code: KitPagosErrorCode,
    public readonly gateway: Gateway,
    public readonly originalPayload: unknown,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "KitPagosError";
  }
}
