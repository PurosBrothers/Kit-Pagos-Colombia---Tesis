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
  KUSHKI_NATIVE_STATUS,
  lookupNativeStatus,
} from "../../../domain/services/native-status";
import { KitPagosError } from "../../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../../domain/value-objects/KitPagosErrorCode";
import {
  parsePayload,
  mapValueObjectError,
  amountToString,
  firstNonEmptyString,
} from "./payload-utils";
import {
  isKushkiTransferResponse,
  normalizeKushkiTransfer,
} from "./kushki-transfer";
import {
  flattenKushkiCharge,
  isKushkiFullResponseCharge,
} from "./kushki-card";

const FALLBACK_EMAIL = "customer@kushki.com";

export class KushkiResponseNormalizer implements GatewayResponseNormalizer {
  normalize(rawResponse: unknown): Transaction {
    const raw = parsePayload(rawResponse, Gateway.KUSHKI, "Kushki");

    // Kushki responde con tres formas distintas según el método y la ruta. Una consulta
    // de transferencia no trae `ticketNumber` ni `transaction_status` (`kushki-transfer.ts`,
    // punto 48), y un cobro con tarjeta trae todo anidado en `details` y con otros nombres
    // (`kushki-card.ts`, punto 50). Las dos formas se resuelven antes de leer nada: la de
    // transferencia con su propio normalizador, porque no comparte ni los campos ni los
    // estados, y la de tarjeta aplanándola, porque es la misma información con otra forma.
    if (isKushkiTransferResponse(raw)) {
      return normalizeKushkiTransfer(raw, rawResponse);
    }

    const payload = isKushkiFullResponseCharge(raw) ? flattenKushkiCharge(raw) : raw;

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

    /*
     * La referencia de la orden es la del comercio, que viaja en `trackingCode`.
     * `transactionReference` lo genera Kushki y es otra cosa: usarlo acá le
     * devuelve al comercio un identificador que nunca envió, con el que no puede
     * conciliar. Se conserva como respaldo solo para respuestas que no traen
     * `trackingCode`, como la consulta de estado por `ticketNumber`.
     */
    const orderReference = new OrderReference(
      firstNonEmptyString(
        [payload.trackingCode, payload.transactionReference],
        ticketNumber,
      ),
    );

    const contactDetails = payload.contactDetails as Record<string, unknown>;

    const payer = new Payer({
      email: firstNonEmptyString([contactDetails?.email], FALLBACK_EMAIL),
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
    return lookupNativeStatus(KUSHKI_NATIVE_STATUS, rawStatus);
  }
}
