/**
 * Cobro con tarjeta en Mercado Pago por la Orders API, desde la versión 0.6.0.
 *
 * ## Por qué dejó la Payments API
 *
 * Medido el 15 de octubre de 2026 con las credenciales `APP_USR-` del vendedor de prueba de
 * una aplicación «Checkout API via Orders»: `POST /v1/payments` con un token válido responde
 * `401 "Unauthorized use of live credentials"`, y `POST /v1/orders` con un token del mismo
 * titular procesa el cobro. PSE ya iba por órdenes (`mercadopago-pse.ts`), así que desde esta
 * versión una sola pareja de credenciales cobra los dos métodos.
 *
 * ## Por qué hay dos consultas antes de cobrar
 *
 * La Orders API exige `payment_method.id` (la marca, `visa`) y `payment_method.type`
 * (`credit_card` o `debit_card`): sin ellos responde `400 required_properties`, y con una
 * marca equivocada `400 payment_method_not_allowed_for_collector` (medido el 15 de octubre de
 * 2026). La Payments API los deducía del token; esta no. El frontend oficial los consigue con
 * MercadoPago.js, pero `PaymentMethod.card(token)` solo trae el token, y pedirle la marca al
 * comercio agregaría a la API pública el primer dato propio de una pasarela.
 *
 * Por eso `resolveCardPaymentMethod()` los deduce del token:
 *
 * 1. `GET /v1/card_tokens/{token}` con el access token devuelve `first_six_digits`. Leerlo no
 *    consume el token: la orden creada después con el mismo token salió aprobada.
 * 2. `GET /v1/payment_methods/search?public_key=…&bins=…` devuelve `id` y `payment_type_id`:
 *    `401354` → `visa`/`credit_card`, `525413` → `master`/`credit_card`, `491511` →
 *    `debvisa`/`debit_card`. Exige `public_key` aunque llegue el Bearer: con solo el Bearer
 *    responde `400 "public_key is required"`.
 *
 * Son dos GET más por cobro, cada uno con su propio límite de tiempo.
 *
 * ## Lo demás medido el mismo día
 *
 * - **El desenlace llega como en PSE.** Aprobado: `201` con la orden en `processed /
 *   accredited`. Rechazado: `402` con la orden en `failed / failed` dentro de `data` y el
 *   motivo en el pago (`rejected_by_issuer`, `insufficient_amount`, `bad_filled_card_data`,
 *   `required_call_for_authorize`, `high_risk`, `invalid_card_token`). Pendiente (titular
 *   `CONT`): `201` con `processing / in_process`. Por eso el adaptador reutiliza
 *   `acceptFailedOrder()` y el normalizador de órdenes.
 * - **`installments` es opcional** (sin él la orden sale con 1), pero débito solo admite 1:
 *   con 3 responde `400 "value must be '1'"`.
 * - **`total_amount` no admite decimales**, igual que en PSE (`toWholePesos()`).
 * - **La respuesta no trae `payer`**, ni al crear ni al consultar, así que la `Transaction`
 *   lleva el email de relleno del normalizador, como ya pasaba con la consulta de un PSE.
 * - **No hay 3DS**: la orden llega con `transaction_security.validation: "never"` y el SDK no
 *   la pide, así que el cobro con tarjeta no devuelve redirección.
 */
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Gateway } from "../../domain/value-objects/Gateway";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { toWholePesos } from "./mercadopago-pse";
import { resolveInstallments } from "./payment-method-support";

/** La marca y el tipo de tarjeta tal como los pide `transactions.payments[].payment_method`. */
export interface CardPaymentMethod {
  readonly id: string;
  readonly type: string;
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Deduce la marca y el tipo de la tarjeta a partir del token.
 *
 * `get` recibe la ruta relativa a la raíz de la API y devuelve el cuerpo ya parseado; es la
 * petición del adaptador, con su autenticación y su manejo de errores.
 */
export async function resolveCardPaymentMethod(
  cardToken: string,
  publicKey: string | undefined,
  get: (path: string) => Promise<unknown>,
): Promise<CardPaymentMethod> {
  if (!publicKey) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.MERCADOPAGO,
      null,
      "Mercado Pago necesita la llave pública (credentials.publicKey) para identificar la " +
        "marca de la tarjeta: GET /v1/payment_methods/search no responde sin ella.",
    );
  }

  const token = await get(`/card_tokens/${encodeURIComponent(cardToken)}`);
  const bin = readString(token, "first_six_digits");
  if (!bin) {
    throw new KitPagosError(
      KitPagosErrorCode.MALFORMED_RESPONSE,
      Gateway.MERCADOPAGO,
      token,
      "Mercado Pago devolvió el token de tarjeta sin first_six_digits.",
    );
  }

  const search = await get(
    `/payment_methods/search?public_key=${encodeURIComponent(publicKey)}&bins=${encodeURIComponent(bin)}`,
  );
  const results = (search as { results?: unknown } | null)?.results;
  const first = Array.isArray(results) ? results[0] : undefined;
  const id = readString(first, "id");
  const type = readString(first, "payment_type_id");
  if (!id || !type) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.MERCADOPAGO,
      search,
      `Mercado Pago no tiene un medio de pago habilitado para el BIN ${bin} de la tarjeta.`,
    );
  }

  return { id, type };
}

/**
 * Arma el cuerpo de `POST /v1/orders` para una tarjeta.
 *
 * El documento del pagador va solo si el comercio lo informó: la orden se aprobó con y sin
 * `identification` (medido el 15 de octubre de 2026).
 */
export function buildCardOrderPayload(
  request: CreatePaymentRequest,
  cardToken: string,
  method: CardPaymentMethod,
): Record<string, unknown> {
  const { payer } = request;
  const total = toWholePesos(request.amount);
  const identification =
    payer.documentType && payer.documentNumber
      ? { identification: { type: payer.documentType, number: payer.documentNumber } }
      : {};

  return {
    type: "online",
    processing_mode: "automatic",
    total_amount: total,
    external_reference: request.orderReference.getValue(),
    payer: { email: payer.email, ...identification },
    transactions: {
      payments: [
        {
          amount: total,
          payment_method: {
            id: method.id,
            type: method.type,
            token: cardToken,
            installments: resolveInstallments(request.paymentMethod),
          },
        },
      ],
    },
  };
}
