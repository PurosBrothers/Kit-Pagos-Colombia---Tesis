import { Amount } from "../value-objects/Amount";
import { Currency } from "../value-objects/Currency";
import { OrderReference } from "../value-objects/OrderReference";
import { Payer } from "../value-objects/Payer";
import { GatewayTransactionId } from "../value-objects/GatewayTransactionId";
import { RejectionReason } from "../value-objects/RejectionReason";
import { TransactionStatus } from "../value-objects/TransactionStatus";

/**
 * Unica clase con identidad propia del dominio del SDK.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "Transaction es la unica
 * clase con identidad propia del dominio y se construye a partir de los
 * objetos de valor Amount, Currency, OrderReference, Payer y
 * GatewayTransactionId, ademas de referenciar el enum TransactionStatus que
 * indica su estado y, opcionalmente, una instancia de RejectionReason cuando
 * ese estado es DECLINED. Expone los metodos isApproved(), isFinal() e
 * isPending() [...]. Conserva ademas el campo rawStatus, que guarda el valor
 * nativo devuelto por la pasarela antes de ser normalizado, con fines de
 * auditoria."
 *
 * authorizationCode se agrega por la seccion 9.1.8 (Transaction Entity), que
 * lista explicitamente ese atributo. Transaction es inmutable: cuando una
 * transaccion PENDING se concilia por webhook, el Response Normalizer debe
 * construir una instancia nueva en lugar de mutar la existente (ver
 * docs/architecture/architecture-log.md, punto 3).
 */
export class Transaction {
  constructor(
    public readonly gatewayTransactionId: GatewayTransactionId,
    public readonly orderReference: OrderReference,
    public readonly amount: Amount,
    public readonly currency: Currency,
    public readonly payer: Payer,
    private readonly status: TransactionStatus,
    public readonly rawStatus: string,
    public readonly rejectionReason?: RejectionReason,
    public readonly authorizationCode?: string,
  ) {}

  getStatus(): TransactionStatus {
    return this.status;
  }

  isApproved(): boolean {
    return this.status === "APPROVED";
  }

  isPending(): boolean {
    return this.status === "PENDING";
  }

  /** Un estado es final cuando ya no se espera ningun cambio adicional. */
  isFinal(): boolean {
    return this.status !== "PENDING";
  }
}
