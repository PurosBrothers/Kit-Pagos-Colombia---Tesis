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
  parsePayload,
  requireData,
  mapValueObjectError,
  amountToString,
} from "./payload-utils";

/** Email de relleno cuando la respuesta no trae `receipt_email`. */
const FALLBACK_EMAIL = "customer@rapyd.net";

/**
 * Prefijo de `failure_code` que identifica un rechazo del procesador de tarjeta.
 * Catalogo completo en docs.rapyd.net/en/card-network-errors.html; por ejemplo
 * "ERROR_PROCESSING_CARD - [51]" es fondos insuficientes.
 */
const CARD_DECLINE_PREFIX = "ERROR_PROCESSING_CARD";

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
      () => new Amount(amountToString(data.amount)),
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

    return new Transaction(
      gatewayTransactionId,
      orderReference,
      amount,
      currency,
      payer,
      this.mapStatus(rawStatus, data),
      rawStatus,
    );
  }

  /**
   * Traduce el estado nativo de Rapyd al enum unificado.
   *
   * Necesita el objeto de datos completo y no solo el estado, porque dos de los
   * cinco codigos son ambiguos por si mismos y hay que leer un segundo campo
   * para desambiguarlos.
   */
  private mapStatus(
    rawStatus: string,
    data: Record<string, unknown>,
  ): TransactionStatus {
    const failureCode = String(data.failure_code ?? "");

    switch (rawStatus.toUpperCase()) {
      case "CLO":
        // "CLO" es "cerrado", no "pagado": son dos campos distintos y hay que
        // leer los dos. Un pago cerrado sin `paid` no autoriza a decirle al
        // comercio que cobro. La combinacion no esta documentada, asi que se
        // degrada a ERROR en vez de a DECLINED: afirmar un rechazo seria
        // afirmar que el banco respondio, y eso no se sabe.
        return data.paid === true ? "APPROVED" : "ERROR";
      case "ACT":
        // Activo: creado y esperando que el pagador lo complete. Es el estado en
        // el que el comercio debe reintentar el polling.
        return "PENDING";
      case "NEW":
        // No es un estado de pago sino de **checkout**: la página existe y nadie la
        // completó todavía. Entra acá porque desde el issue #64 un cobro con tarjeta en
        // Rapyd devuelve un checkout, y consultarlo antes de que el pagador pague
        // responde `status: "NEW"` con `payment.id` en null (ver `rapyd-checkout.ts`).
        // Sin esta rama caía en `default` y un cobro recién creado se reportaba como
        // ERROR, que es el mismo defecto que el punto 46 corrigió en los webhooks.
        return "PENDING";
      case "ERR":
        // Rapyd no distingue el rechazo de negocio del fallo tecnico por
        // `status` (es "ERR" en ambos casos). Se aplica el mismo criterio de
        // desambiguacion por prefijo de `failure_code` que usa el manejador de
        // webhooks para PAYMENT_FAILED, para que el mismo pago no se normalice
        // distinto segun si llego por webhook o por consulta.
        return failureCode.startsWith(CARD_DECLINE_PREFIX) ? "DECLINED" : "ERROR";
      case "EXP":
        return "EXPIRED";
      case "REV":
        // Revertido por Rapyd, con el motivo en `cancel_reason`. Este codigo
        // resuelve el pendiente que ubiquitous-language.md dejaba abierto
        // conjeturando "CAN": el valor real que documenta Rapyd es "REV".
        return "VOIDED";
      default:
        return "ERROR";
    }
  }
}
