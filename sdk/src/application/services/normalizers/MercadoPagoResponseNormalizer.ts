import { Gateway } from "../../../domain/value-objects/Gateway";
import { Transaction } from "../../../domain/entities/Transaction";
import { TransactionStatus } from "../../../domain/value-objects/TransactionStatus";
import { Amount } from "../../../domain/value-objects/Amount";
import { Currency } from "../../../domain/value-objects/Currency";
import { OrderReference } from "../../../domain/value-objects/OrderReference";
import { Payer } from "../../../domain/value-objects/Payer";
import { GatewayTransactionId } from "../../../domain/value-objects/GatewayTransactionId";
import { GatewayResponseNormalizer } from "./GatewayResponseNormalizer";
import {
  MERCADOPAGO_NATIVE_STATUS,
  lookupNativeStatus,
} from "../../../domain/services/native-status";
import {
  parsePayload,
  requireData,
  mapValueObjectError,
  amountToString,
} from "./payload-utils";

/** Email de relleno cuando la respuesta no trae el del pagador. */
const FALLBACK_EMAIL = "customer@mercadopago.com";


/** Traduce la respuesta nativa de Mercado Pago a la entidad Transaction. */
export class MercadoPagoResponseNormalizer implements GatewayResponseNormalizer {
  normalize(rawResponse: unknown): Transaction {
    const payload = parsePayload(rawResponse, Gateway.MERCADOPAGO, "Mercado Pago");

    // A diferencia de Wompi y Rapyd, Mercado Pago devuelve el pago en la raiz.
    // Se acepta tambien envuelto en `data` para tolerar los mocks del simulador.
    const data = requireData(
      payload?.data ?? payload,
      Gateway.MERCADOPAGO,
      rawResponse,
      "Malformed response from Mercado Pago gateway: missing id",
    );

    const rawStatus = String(data.status ?? "");
    // `currency_id` es de la Payments API y `currency` de la Orders API, que es
    // la que usa PSE. Las dos traen el codigo ISO, solo cambia el nombre.
    const currency = new Currency(String(data.currency_id ?? data.currency ?? "COP"));

    // Las dos APIs expresan el monto en pesos y no en centavos, asi que se
    // construye el Amount directamente sin pasar por fromMinorUnits(). La
    // Payments API lo llama `transaction_amount` y lo manda como numero; la
    // Orders API lo llama `total_amount` y lo manda como string.
    const amount = mapValueObjectError(
      () => new Amount(amountToString(data.transaction_amount ?? data.total_amount)),
      Gateway.MERCADOPAGO,
      rawResponse,
      "Malformed amount in Mercado Pago response",
    );

    const orderReference = new OrderReference(
      String(data.external_reference ?? data.description ?? data.id),
    );
    const payerData = data.payer as Record<string, unknown> | undefined;
    const payer = new Payer({
      email: String(payerData?.email ?? FALLBACK_EMAIL),
    });
    const gatewayTransactionId = new GatewayTransactionId(
      String(data.id),
      Gateway.MERCADOPAGO,
    );

    return new Transaction(
      gatewayTransactionId,
      orderReference,
      amount,
      currency,
      payer,
      this.mapStatus(rawStatus),
      rawStatus,
      undefined,
      undefined,
    );
  }

  /**
   * Traduce el estado nativo de Mercado Pago al enum unificado.
   *
   * Los estados nativos llegan en minusculas. `rawStatus` se preserva tal como
   * llego para auditoria, de modo que la normalizacion no pierde el original.
   * Un estado desconocido cae en `ERROR` a proposito: es mejor que el comercio
   * vea un error que un `APPROVED` inventado.
   */
  private mapStatus(rawStatus: string): TransactionStatus {
    return lookupNativeStatus(MERCADOPAGO_NATIVE_STATUS, rawStatus);
  }
}
