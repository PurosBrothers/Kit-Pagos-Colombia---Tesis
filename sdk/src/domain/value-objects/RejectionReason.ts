import { RejectionCategory } from "./RejectionCategory";

/**
 * Objeto de valor inmutable que combina el codigo nativo de rechazo con su
 * categoria normalizada. Fuente: SAD, seccion 15.1 (Nucleo del dominio) -
 * "RejectionReason combina el codigo nativo del rechazo (rejectionCode) con
 * la categoria normalizada (rejectionCategory) tomada del enum
 * RejectionCategory."
 */
export class RejectionReason {
  constructor(
    public readonly rejectionCode: string,
    public readonly rejectionCategory: RejectionCategory,
  ) {}
}
