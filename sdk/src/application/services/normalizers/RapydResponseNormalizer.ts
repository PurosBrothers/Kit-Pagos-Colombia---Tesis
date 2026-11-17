import { Gateway } from "../../../domain/value-objects/Gateway";
import { Transaction } from "../../../domain/entities/Transaction";
import { Amount } from "../../../domain/value-objects/Amount";
import { Currency } from "../../../domain/value-objects/Currency";
import { OrderReference } from "../../../domain/value-objects/OrderReference";
import { Payer } from "../../../domain/value-objects/Payer";
import { GatewayTransactionId } from "../../../domain/value-objects/GatewayTransactionId";
import { GatewayResponseNormalizer } from "./GatewayResponseNormalizer";
import { readRapydRejection } from "./rapyd-rejection";
import { rapydPaymentStatus } from "../../../domain/services/native-status";
import {
  parsePayload,
  requireData,
  mapValueObjectError,
  amountToString,
  atCurrencyScale,
} from "./payload-utils";

/** Email de relleno cuando la respuesta no trae `receipt_email`. */
const FALLBACK_EMAIL = "customer@rapyd.net";

/** Traduce la respuesta nativa de Rapyd a la entidad Transaction. */
export class RapydResponseNormalizer implements GatewayResponseNormalizer {
  normalize(rawResponse: unknown): Transaction {
    const payload = parsePayload(rawResponse, Gateway.RAPYD, "Rapyd");

    // Rapyd envuelve todas sus respuestas en `{ status, data }`, donde `status`
    // es el resultado de la llamada de API y `data` el objeto de negocio. El
    // envoltorio siempre esta presente, a diferencia de Mercado Pago.
    const data = requireData(
      payload?.data,
      Gateway.RAPYD,
      rawResponse,
      "Malformed response from Rapyd gateway: missing data.id",
    );

    const rawStatus = String(data.status ?? "");

    // En la respuesta el campo es `currency_code`, aunque en la peticion de
    // creacion se llame `currency`. Son nombres distintos en el contrato real.
    const currency = new Currency(String(data.currency_code ?? "COP"));

    // Rapyd trabaja en la unidad mayor (pesos con decimales), no en centavos,
    // asi que NO se usa fromMinorUnits(): hacerlo dividiria el monto entre cien.
    const amount = mapValueObjectError(
      () => atCurrencyScale(new Amount(amountToString(data.amount)), currency),
      Gateway.RAPYD,
      rawResponse,
      "Malformed amount in Rapyd response",
    );

    const orderReference = new OrderReference(
      String(data.merchant_reference_id || data.id),
    );

    // Rapyd no expone un email de pagador obligatorio como las otras tres: lo
    // mas cercano es `receipt_email`, que es opcional.
    const payer = new Payer({
      email: String(data.receipt_email || FALLBACK_EMAIL),
    });
    const gatewayTransactionId = new GatewayTransactionId(
      String(data.id),
      Gateway.RAPYD,
    );

    const status = rapydPaymentStatus(rawStatus, data);
    return new Transaction(
      gatewayTransactionId,
      orderReference,
      amount,
      currency,
      payer,
      status,
      rawStatus,
      readRapydRejection(data, status),
    );
  }
}
