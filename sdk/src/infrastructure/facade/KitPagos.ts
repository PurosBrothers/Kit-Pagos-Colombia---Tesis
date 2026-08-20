import { Transaction } from "../../domain/entities/Transaction";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

/**
 * Unica clase que el desarrollador que consume el SDK instancia directamente.
 * Fuente: SAD, seccion 15.2 (SDK) - "PaymentFacade es la unica clase que el
 * desarrollador que consume el SDK instancia directamente. Mantiene una
 * referencia a SdkConfigurator y a GatewayFactory, y expone los tres metodos
 * publicos del SDK: createPayment(request), getStatus(id) y
 * verifyWebhook(payload, headers)."
 *
 * TODO: integrar SdkConfigurator y GatewayFactory (pendientes de
 * implementacion) para resolver la pasarela activa, delegar en el Adapter
 * correspondiente y envolver la llamada con RetryHandler.
 */
export class KitPagos {
  async createPayment(request: CreatePaymentRequest): Promise<Transaction> {
    throw new Error("KitPagos.createPayment aun no esta implementado");
  }

  async getStatus(id: string): Promise<Transaction> {
    throw new Error("KitPagos.getStatus aun no esta implementado");
  }

  verifyWebhook(payload: string, headers: Record<string, string>): boolean {
    throw new Error("KitPagos.verifyWebhook aun no esta implementado");
  }
}
