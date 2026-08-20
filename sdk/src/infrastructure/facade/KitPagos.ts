import { Transaction } from "../../domain/entities/Transaction";
import { WebhookEvent } from "../../domain/value-objects/WebhookEvent";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

/**
 * Unica clase que el desarrollador que consume el SDK instancia directamente.
 * Fuente: SAD, seccion 9.1.1 (Payment Facade) y Component Diagram - C4.png,
 * que coinciden en createPayment(), getPaymentStatus() y validateWebhook()
 * como los tres metodos publicos del SDK. La seccion 15.2 usa nombres
 * distintos (getStatus, verifyWebhook); se prioriza la version que coincide
 * en mas artefactos del SAD (ver docs/architecture/sad-inconsistencies.md,
 * punto 1).
 *
 * validateWebhook() retorna WebhookEvent en lugar de boolean para cumplir
 * RF-04 ("retornar un evento normalizado si la firma es valida"), ver
 * docs/architecture/sad-inconsistencies.md, punto 6.
 *
 * TODO: integrar SdkConfigurator y GatewayFactory (pendientes de
 * implementacion) para resolver la pasarela activa, delegar en el Adapter
 * correspondiente y envolver la llamada con RetryHandler.
 */
export class KitPagos {
  async createPayment(request: CreatePaymentRequest): Promise<Transaction> {
    throw new Error("KitPagos.createPayment aun no esta implementado");
  }

  async getPaymentStatus(id: string): Promise<Transaction> {
    throw new Error("KitPagos.getPaymentStatus aun no esta implementado");
  }

  validateWebhook(
    payload: string,
    headers: Record<string, string>,
  ): WebhookEvent {
    throw new Error("KitPagos.validateWebhook aun no esta implementado");
  }
}
