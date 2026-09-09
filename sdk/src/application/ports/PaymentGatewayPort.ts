import { Transaction } from "../../domain/entities/Transaction";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";
import { TaxBreakdown } from "../../domain/value-objects/TaxBreakdown";

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
  /**
   * Descomposicion del monto en base gravable e impuestos. Opcional porque solo
   * Kushki exige el monto descompuesto; las otras tres pasarelas reciben un
   * escalar y lo ignoran.
   *
   * Cuando no se informa, el KushkiAdapter asume el caso exento
   * (`TaxBreakdown.exempt`), que es lo que documenta el lenguaje ubicuo: todo el
   * monto va a `subtotalIva0` y el resto de componentes en cero. Inventar un IVA
   * que el comercio no declaro seria peor que no descomponer.
   *
   * Si se informa, el total del desglose debe coincidir con `amount`; el Adapter
   * que lo consuma es responsable de verificarlo.
   */
  taxBreakdown?: TaxBreakdown;
}

/**
 * Puerto de salida de la Arquitectura Hexagonal. Contrato que deben
 * implementar los cuatro Adapters de pasarela (WompiAdapter, RapydAdapter,
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
