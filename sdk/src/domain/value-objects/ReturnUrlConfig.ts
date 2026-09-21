import { TransactionStatus } from "./TransactionStatus";

/**
 * Objeto de valor inmutable que configura las URLs de redireccion post-pago.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "ReturnUrlConfig expone el
 * metodo resolveFor(status), que retorna la URL correspondiente segun el
 * resultado del pago, soportando tanto una URL unica como URLs diferenciadas
 * por resultado."
 */
export interface ReturnUrlsByResult {
  success?: string;
  failure?: string;
  pending?: string;
}

export class ReturnUrlConfig {
  constructor(
    private readonly returnUrl?: string | null,
    private readonly returnUrls?: ReturnUrlsByResult,
  ) {}

  /** Resuelve la URL de redireccion aplicable segun el estado de la transaccion. */
  resolveFor(status: TransactionStatus): string | null {
    if (this.returnUrls) {
      if (status === "APPROVED" && this.returnUrls.success) {
        return this.returnUrls.success;
      }
      if (status === "DECLINED" && this.returnUrls.failure) {
        return this.returnUrls.failure;
      }
      if (status === "PENDING" && this.returnUrls.pending) {
        return this.returnUrls.pending;
      }
    }
    return this.returnUrl ?? null;
  }
}
