import { Gateway } from "./Gateway";

/**
 * Objeto de valor inmutable que combina el identificador nativo de una
 * transaccion con la pasarela que lo origino. Fuente: SAD, seccion 15.1
 * (Nucleo del dominio) - "GatewayTransactionId combina el identificador
 * nativo con el Gateway que lo origino, y se diferencia de OrderReference
 * en que es la pasarela quien lo genera, no el comercio."
 */
export class GatewayTransactionId {
  constructor(
    public readonly value: string,
    public readonly gateway: Gateway,
  ) {}

  equals(other: GatewayTransactionId): boolean {
    return this.value === other.value && this.gateway === other.gateway;
  }
}
