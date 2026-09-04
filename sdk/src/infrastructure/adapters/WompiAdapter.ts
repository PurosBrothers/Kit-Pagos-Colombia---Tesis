import { PaymentGatewayPort, CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Transaction } from "../../domain/entities/Transaction";

export class WompiAdapter implements PaymentGatewayPort {
  async createPayment(_request: CreatePaymentRequest): Promise<Transaction> {
    throw new Error("WompiAdapter.createPayment aun no esta implementado");
  }
  async getStatus(_gatewayTransactionId: string): Promise<Transaction> {
    throw new Error("WompiAdapter.getStatus aun no esta implementado");
  }
  verifySignature(_payload: string, _headers: Record<string, string>, _secret: string): boolean {
    throw new Error("WompiAdapter.verifySignature aun no esta implementado");
  }
}
