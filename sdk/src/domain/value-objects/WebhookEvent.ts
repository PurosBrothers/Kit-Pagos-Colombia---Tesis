import { Gateway } from "./Gateway";
import { TransactionStatus } from "./TransactionStatus";

export interface WebhookEventAttributes {
  eventType: string;
  gatewayTransactionId: string;
  newStatus: TransactionStatus;
  gateway: Gateway;
}

/**
 * Representa el evento normalizado que RF-04 exige retornar cuando la firma
 * de un webhook entrante es valida. No forma parte de las secciones 3, 9.1.7
 * ni 15.1 del SAD; se reintroduce para cerrar la brecha entre ese requisito
 * funcional y el resto del modelo de dominio (ver
 * docs/architecture/sad-inconsistencies.md, punto 6).
 */
export class WebhookEvent {
  public readonly eventType: string;
  public readonly gatewayTransactionId: string;
  public readonly newStatus: TransactionStatus;
  public readonly gateway: Gateway;

  constructor(attributes: WebhookEventAttributes) {
    this.eventType = attributes.eventType;
    this.gatewayTransactionId = attributes.gatewayTransactionId;
    this.newStatus = attributes.newStatus;
    this.gateway = attributes.gateway;
  }
}
