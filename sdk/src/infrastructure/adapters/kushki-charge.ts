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
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
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

/** Código con el que el cobro rechaza el `Private-Merchant-Id`. */
const INVALID_MERCHANT_CREDENTIAL_CODE = "K004";

/**
 * Corrige la clasificación de un 400 que en realidad es un rechazo de credencial.
 *
 * `POST /card/v1/charges` no responde 401 ni 403 ante una llave privada inválida: responde
 * `400 {"message": "ID de comercio o credencial no válido", "code": "K004"}`, y revisa la
 * credencial antes que el cuerpo (con la llave válida, el mismo cuerpo da K001). Medido el
 * 6 de octubre de 2026, docs/testing-data/kushki.md §1.2. Por status, `ErrorHandler` lo
 * deja en INVALID_REQUEST y el comercio buscaría el defecto en su payload; aquí se decide
 * por el código del cuerpo, que es lo único que distingue los dos casos.
 *
 * Desde el issue #153 el mensaje de `ErrorHandler` ya trae `K004` y su motivo, y entonces no
 * se repite.
 */
export function reclassifyKushkiCredentialError(error: KitPagosError): KitPagosError {
  const payload = error.originalPayload as { code?: unknown } | null;
  if (
    error.code !== KitPagosErrorCode.INVALID_REQUEST ||
    payload?.code !== INVALID_MERCHANT_CREDENTIAL_CODE
  ) {
    return error;
  }
  const message = error.message.includes(INVALID_MERCHANT_CREDENTIAL_CODE)
    ? error.message
    : `${error.message} (${INVALID_MERCHANT_CREDENTIAL_CODE}: invalid merchant credential)`;
  return new KitPagosError(
    KitPagosErrorCode.INVALID_CREDENTIALS,
    error.gateway,
    error.originalPayload,
    message,
  );
}

/**
 * El estado nativo de un cobro rechazado. El `400` del rechazo no trae
 * `details.transactionStatus`, así que se usa el valor del vocabulario de tarjeta de Kushki
 * para un rechazo, el mismo que traen sus webhooks y que mapea `KUSHKI_NATIVE_STATUS`. El
 * código del banco no se pierde: va en el `rejectionReason`.
 */
const DECLINED_CHARGE_STATUS = "DECLINED";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** El primer identificador no vacío, como texto; Kushki deja `details.ticketNumber` vacío al rechazar. */
function firstIdentifier(values: readonly unknown[]): string {
  const found = values.find(
    (value) => (typeof value === "string" && value.trim() !== "") || typeof value === "number",
  );
  return found === undefined ? "" : String(found);
}

/**
 * Los códigos de respuesta del procesador son numéricos (`000` aprobado, `017` a `023`
 * rechazos); los errores de Kushki llevan `K` (`K001`, `K004`, `K220`).
 */
const PROCESSOR_RESPONSE_CODE = /^\d+$/;

/**
 * Si el cuerpo de un error es el de un cobro que el banco rechazó.
 *
 * Medido el 24 de octubre de 2026 con las cinco tarjetas de rechazo de
 * `docs/testing-data/kushki.md` §1: `POST /card/v1/charges` responde `400` con `code` y un
 * `message` genérico («Transacción declinada.»), y el motivo en `details.responseCode` y
 * `details.responseText` («Tarjeta sin fondos»). La presencia de `details` no alcanza para
 * distinguirlo: el mismo día, el `400 K220` de un token cobrado por otro monto trajo `details`
 * con `responseCode: "K220"`, y el `K001` de un token mal formado, `details` con `field` y
 * `errors`. Esos son errores de la petición, y lo que los separa de un rechazo es el código:
 * numérico el del procesador, con `K` el de Kushki. Ver el punto 122 del `architecture-log.md`.
 */
export function isDeclinedChargeBody(body: unknown): boolean {
  const responseCode = asRecord(asRecord(body)?.details)?.responseCode;
  return typeof responseCode === "string" && PROCESSOR_RESPONSE_CODE.test(responseCode);
}

/**
 * Devuelve el rechazo que llegó en un `400` como un cobro en la forma plana del normalizador,
 * y lanza cualquier otro error.
 *
 * Antes ese `400` salía como `INVALID_REQUEST`, un fallo técnico, y el comercio no podía
 * distinguir una tarjeta sin fondos de una petición mal armada. Es el mismo caso del `402` de
 * Mercado Pago (`acceptFailedOrder()`): un rechazo que la pasarela entrega con un status de
 * error. El cuerpo no trae ni el monto ni la referencia del comercio, así que salen de la
 * petición, que es lo que se cobró. El identificador es `details.transactionId`, porque
 * `details.ticketNumber` llega vacío, y `transactionReference` queda de respaldo. El cuerpo se
 * toma del `originalPayload`, que ya pasó por la limpieza de credenciales de `httpFailure()`.
 */
export function acceptDeclinedCharge(
  error: unknown,
  request: CreatePaymentRequest,
): Record<string, unknown> {
  if (
    !(error instanceof KitPagosError) ||
    error.code !== KitPagosErrorCode.INVALID_REQUEST ||
    !isDeclinedChargeBody(error.originalPayload)
  ) {
    throw error;
  }
  const body = error.originalPayload as Record<string, unknown>;
  const details = body.details as Record<string, unknown>;
  return {
    ticketNumber: firstIdentifier([details.ticketNumber, details.transactionId, body.transactionReference]),
    transaction_status: DECLINED_CHARGE_STATUS,
    trackingCode: request.orderReference.getValue(),
    contactDetails: { email: request.payer.email },
    responseCode: details.responseCode,
    amount: buildKushkiAmount(request, resolveTaxBreakdown(request)),
  };
}

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
