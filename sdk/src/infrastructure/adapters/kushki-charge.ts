/**
 * El cobro con tarjeta de Kushki, tal como se midió contra su API de pruebas.
 *
 * ## Los tres defectos que esto corrige (19 de septiembre de 2026)
 *
 * El camino de tarjeta del adaptador nunca se había probado contra Kushki, solo contra
 * el simulador, y tenía tres cosas mal a la vez:
 *
 * | Lo que hacía el SDK | Lo que responde `api-uat.kushkipagos.com` |
 * |---|---|
 * | `POST /charges` | `403 Forbidden`, igual que una ruta inventada. La real es `POST /card/v1/charges` |
 * | `token: "simulated-token"` fijo | `400 K001 "Cuerpo de la petición inválido"` |
 * | esperaba `amount` y `transaction_status` en la raíz | devuelve `{ ticketNumber, transactionReference }` |
 *
 * El literal `"simulated-token"` es el más caro de los tres, porque no era un error de
 * transcripción: era el simulador filtrándose al adaptador. Mientras el mock aceptara
 * cualquier token, el defecto no podía fallar en ninguna prueba.
 *
 * ## Por qué se pide `fullResponse: true`
 *
 * Porque sin él la respuesta del cobro es `{ ticketNumber, transactionReference }`, y con
 * eso no se puede construir una `Transaction`: falta el estado y falta el monto. Con
 * `fullResponse` viene todo, anidado en `details`, y `kushki-card.ts` lo aplana.
 *
 * No es un dato de más "por si acaso": es lo mínimo que el contrato del puerto necesita
 * para devolver una transacción con estado, y la alternativa —cobrar y después consultar—
 * no existe, porque contra la API real no hay ninguna ruta de consulta de cobros con
 * tarjeta (se probaron catorce candidatas). Ver el punto 50 del `architecture-log.md`.
 */
import { Gateway } from "../../domain/value-objects/Gateway";
import { GatewayTransactionId } from "../../domain/value-objects/GatewayTransactionId";
import type { PendingRedirect } from "../../domain/value-objects/PaymentResult";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { buildKushkiAmount, resolveTaxBreakdown } from "./kushki-amount";
import {
  requireCardToken,
  resolveInstallments,
} from "./payment-method-support";

/** Ruta real del cobro con tarjeta. `POST /charges` responde 403: no existe. */
export const CARD_CHARGE_PATH = "/card/v1/charges";

/** Dónde tokeniza el comercio, para poder decírselo si no manda token. */
export const CARD_TOKENIZATION_ENDPOINT = "POST /card/v1/tokens";

/**
 * Arma el cuerpo de `POST /card/v1/charges`.
 *
 * `months` solo viaja cuando hay más de una cuota, porque es como Kushki llama a las
 * cuotas y un cobro de una sola no las necesita. Se midió que las acepta y las devuelve
 * resueltas en `details.months`.
 */
export function buildCardChargePayload(
  request: CreatePaymentRequest,
): Record<string, unknown> {
  const installments = resolveInstallments(request.paymentMethod);

  const payload: Record<string, unknown> = {
    token: requireCardToken(
      request.paymentMethod,
      Gateway.KUSHKI,
      CARD_TOKENIZATION_ENDPOINT,
    ),
    /*
     * Kushki recibe la referencia del comercio en `trackingCode`. Es distinta del
     * `transactionReference` que Kushki genera y devuelve en la respuesta: si se toma
     * ese como referencia de la orden, el comercio pierde la suya y no puede conciliar.
     * Ver `ubiquitous-language.md`, fila `orderReference`.
     */
    trackingCode: request.orderReference.getValue(),
    amount: buildKushkiAmount(request, resolveTaxBreakdown(request)),
    contactDetails: {
      email: request.payer.email,
    },
    fullResponse: true,
  };

  if (installments > 1) {
    payload.months = installments;
  }

  return payload;
}

/**
 * Extrae la redirección de 3DS / OTP de un cobro con tarjeta en Kushki si el emisor la requiere.
 */
export function extractCardChargeRedirect(
  rawResponse: unknown,
): PendingRedirect | undefined {
  if (typeof rawResponse !== "object" || rawResponse === null) return undefined;
  const payload = rawResponse as Record<string, unknown>;
  const details =
    typeof payload.details === "object" && payload.details !== null
      ? (payload.details as Record<string, unknown>)
      : undefined;

  const redirectUrl =
    typeof payload.redirectUrl === "string" && payload.redirectUrl.length > 0
      ? payload.redirectUrl
      : typeof details?.redirectUrl === "string" && details.redirectUrl.length > 0
      ? details.redirectUrl
      : undefined;

  if (redirectUrl) {
    const ticket = String(payload.ticketNumber ?? details?.ticketNumber ?? "");
    const rawStatus = String(details?.transactionStatus ?? payload.status ?? "PENDING");
    return {
      redirectUrl,
      gatewayTransactionId: new GatewayTransactionId(ticket, Gateway.KUSHKI),
      rawStatus,
    };
  }

  return undefined;
}
