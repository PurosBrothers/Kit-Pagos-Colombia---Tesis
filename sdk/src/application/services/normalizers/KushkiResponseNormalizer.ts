import { Gateway } from "../../../domain/value-objects/Gateway";
import { Transaction } from "../../../domain/entities/Transaction";
import { TransactionStatus } from "../../../domain/value-objects/TransactionStatus";
import { Amount } from "../../../domain/value-objects/Amount";
import { Currency } from "../../../domain/value-objects/Currency";
import { OrderReference } from "../../../domain/value-objects/OrderReference";
import { Payer } from "../../../domain/value-objects/Payer";
import { GatewayTransactionId } from "../../../domain/value-objects/GatewayTransactionId";
import { GatewayResponseNormalizer } from "./GatewayResponseNormalizer";
import { KitPagosError } from "../../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../../domain/value-objects/KitPagosErrorCode";
import {
  parsePayload,
  mapValueObjectError,
  amountToString,
} from "./payload-utils";

const FALLBACK_EMAIL = "customer@kushki.com";

export class KushkiResponseNormalizer implements GatewayResponseNormalizer {
  normalize(rawResponse: unknown): Transaction {
    const payload = parsePayload(rawResponse, Gateway.KUSHKI, "Kushki");

    const ticketNumber = String(payload.ticketNumber ?? "");

    if (!ticketNumber) {
      throw new KitPagosError(
        KitPagosErrorCode.MALFORMED_RESPONSE,
        Gateway.KUSHKI,
        rawResponse,
        "Malformed response from Kushki gateway: missing ticketNumber",
      );
    }

    const amountData = payload.amount as Record<string, unknown> | undefined;

    if (!amountData || typeof amountData !== "object") {
      throw new KitPagosError(
        KitPagosErrorCode.MALFORMED_RESPONSE,
        Gateway.KUSHKI,
        rawResponse,
        "Malformed response from Kushki gateway: missing amount",
      );
    }

    const currency = new Currency(
      String(amountData.currency ?? "COP"),
    );

    const amount = mapValueObjectError(
      () =>
        new Amount(amountToString(amountData.subtotalIva0))
          .add(new Amount(amountToString(amountData.subtotalIva)))
          .add(new Amount(amountToString(amountData.iva)))
          .add(new Amount(amountToString(amountData.ice))),
      Gateway.KUSHKI,
      rawResponse,
      "Malformed amount in Kushki response",
    );

    const rawStatus = String(payload.transaction_status ?? "");

    const orderReference = new OrderReference(
      String(payload.transactionReference ?? ticketNumber),
    );

    const payer = new Payer({
      email: FALLBACK_EMAIL,
    });

    const gatewayTransactionId = new GatewayTransactionId(
      ticketNumber,
      Gateway.KUSHKI,
    );

    return new Transaction(
      gatewayTransactionId,
      orderReference,
      amount,
      currency,
      payer,
      this.mapStatus(rawStatus),
      rawStatus,
    );
  }

  private mapStatus(rawStatus: string): TransactionStatus {
    switch (rawStatus.toUpperCase()) {
      case "APPROVAL":
        return "APPROVED";
      case "DECLINED":
        return "DECLINED";
      case "INITIALIZED":
        return "PENDING";
      default:
        return "ERROR";
    }
  }
}
