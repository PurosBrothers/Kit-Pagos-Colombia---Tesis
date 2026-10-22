import { Gateway } from "./Gateway";
import { TransactionStatus } from "./TransactionStatus";

export interface WebhookEventAttributes {
  eventType: string;
  gatewayTransactionId: string;
  newStatus: TransactionStatus;
  gateway: Gateway;
  rawStatus?: string;
  orderReference?: string;
}

/**
 * Representa el evento normalizado que RF-04 exige retornar cuando la firma
 * de un webhook entrante es valida. No forma parte de las secciones 3, 9.1.7
 * ni 15.1 del SAD; se reintroduce para cerrar la brecha entre ese requisito
 * funcional y el resto del modelo de dominio (ver
 * docs/architecture/architecture-log.md, punto 6).
 *
 * `rawStatus` y `orderReference` solo vienen cuando la firma cubre el campo del que salen
 * (punto 118). Mercado Pago no firma el cuerpo, así que no trae ninguno de los dos.
 */
export class WebhookEvent {
  public readonly eventType: string;
  public readonly gatewayTransactionId: string;
  public readonly newStatus: TransactionStatus;
  public readonly gateway: Gateway;
  /** El estado tal como lo mandó la pasarela, sin traducir: lo que el comercio guarda para auditoría. */
  public readonly rawStatus?: string;
  /**
   * La referencia de la orden que el comercio mandó al cobrar. Sirve cuando el id no empareja:
   * el cobro con tarjeta de Rapyd se crea como checkout y su webhook trae el id del pago.
   */
  public readonly orderReference?: string;

  constructor(attributes: WebhookEventAttributes) {
    this.eventType = attributes.eventType;
    this.gatewayTransactionId = attributes.gatewayTransactionId;
    this.newStatus = attributes.newStatus;
    this.gateway = attributes.gateway;
    this.rawStatus = attributes.rawStatus;
    this.orderReference = attributes.orderReference;
  }
}
