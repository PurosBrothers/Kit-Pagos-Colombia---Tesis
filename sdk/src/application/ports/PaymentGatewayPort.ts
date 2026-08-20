import { Transaction } from "../../domain/entities/Transaction";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";

/**
 * Datos de entrada para crear un pago a traves de un Adapter concreto.
 * No especificado literalmente por el SAD; se construye a partir de los
 * mismos objetos de valor que componen la entidad Transaction (seccion 15.1)
 * para mantener consistencia con el resto del modelo de dominio.
 */
export interface CreatePaymentRequest {
  amount: Amount;
  currency: Currency;
  orderReference: OrderReference;
  payer: Payer;
  returnUrlConfig?: ReturnUrlConfig;
}

/**
 * Puerto de salida de la Arquitectura Hexagonal. Contrato que deben
 * implementar los cuatro Adapters de pasarela (WompiAdapter, PayUAdapter,
 * MercadoPagoAdapter, KushkiAdapter).
 * Fuente: SAD, seccion 15.2 (SDK) - "Los cuatro Adapters [...] implementan
 * la interfaz PaymentGatewayPort, que define los metodos createPayment(),
 * getStatus() y verifySignature()."
 */
export interface PaymentGatewayPort {
  createPayment(request: CreatePaymentRequest): Promise<Transaction>;

  getStatus(gatewayTransactionId: string): Promise<Transaction>;

  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean;
}
