import { Gateway } from "../../../domain/value-objects/Gateway";
import { Transaction } from "../../../domain/entities/Transaction";
import { TransactionStatus } from "../../../domain/value-objects/TransactionStatus";
import { Amount } from "../../../domain/value-objects/Amount";
import { Currency } from "../../../domain/value-objects/Currency";
import { OrderReference } from "../../../domain/value-objects/OrderReference";
import { Payer } from "../../../domain/value-objects/Payer";
import { GatewayTransactionId } from "../../../domain/value-objects/GatewayTransactionId";
import { GatewayResponseNormalizer } from "./GatewayResponseNormalizer";
import { parsePayload, requireData, mapValueObjectError } from "./payload-utils";

/** Email de relleno cuando la respuesta no trae el del pagador. */
const FALLBACK_EMAIL = "customer@wompi.co";

/** Traduce la respuesta nativa de Wompi a la entidad Transaction. */
export class WompiResponseNormalizer implements GatewayResponseNormalizer {
  normalize(rawResponse: unknown): Transaction {
    const payload = parsePayload(rawResponse, Gateway.WOMPI, "Wompi");
    const data = requireData(
      payload?.data,
      Gateway.WOMPI,
      rawResponse,
      "Malformed response from Wompi gateway: missing data.id",
    );

    const rawStatus = String(data.status ?? "");

    // La divisa se resuelve antes del monto porque es ella la que sabe cuantos
    // decimales tiene, y por lo tanto donde cae el punto decimal al reconstruirlo.
    const currency = new Currency(String(data.currency ?? "COP"));

    // Wompi envia el monto en centavos. Se reconstruye insertando el punto
    // decimal en vez de dividir entre 100: 1990 centavos deben volver como
    // "19.90", y una division daria "19.9", que es un monto distinto del que el
    // comercio cobro.
    const amount = mapValueObjectError(
      () => Amount.fromMinorUnits(String(data.amount_in_cents ?? 0), currency),
      Gateway.WOMPI,
      rawResponse,
      "Malformed amount in Wompi response",
    );

    const orderReference = new OrderReference(String(data.reference ?? data.id));
    const customerEmail =
      data.customer_email ?? payload.customer_email ?? FALLBACK_EMAIL;
    const payer = new Payer({ email: String(customerEmail) });
    const gatewayTransactionId = new GatewayTransactionId(
      String(data.id),
      Gateway.WOMPI,
    );
    const authorizationCode = data.authorization_code
      ? String(data.authorization_code)
      : undefined;

    return new Transaction(
      gatewayTransactionId,
      orderReference,
      amount,
      currency,
      payer,
      this.mapStatus(rawStatus),
      rawStatus,
      undefined,
      authorizationCode,
    );
  }

  /**
   * Traduce el estado nativo de Wompi al enum unificado.
   *
   * Un estado desconocido cae a ERROR y no a DECLINED: decir "rechazado" seria
   * afirmar que el banco respondio, y eso no se sabe.
   */
  private mapStatus(rawStatus: string): TransactionStatus {
    switch (rawStatus.toUpperCase()) {
      case "APPROVED":
        return "APPROVED";
      case "DECLINED":
        return "DECLINED";
      case "VOIDED":
        return "VOIDED";
      case "PENDING":
        return "PENDING";
      default:
        return "ERROR";
    }
  }
}
