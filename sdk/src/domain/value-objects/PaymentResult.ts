import { Transaction } from "../entities/Transaction";
import { GatewayTransactionId } from "./GatewayTransactionId";

/**
 * Resultado de intentar crear un pago: **o** hay transacción, **o** falta que el
 * pagador vaya a una URL.
 *
 * ## El defecto que esto corrige
 *
 * Antes del issue #64, `createPayment()` devolvía `Transaction` a secas, y
 * `Transaction` no tiene forma de expresar "el pago arrancó y falta un paso del
 * usuario". Eso no era una carencia teórica: en Rapyd, un pago que dispara 3DS
 * responde `status: "ACT"` con `next_action: "3d_verification"` y un
 * `redirect_url`, y el normalizador traducía ese `ACT` a `PENDING` **descartando
 * la URL en silencio**. El comercio recibía una transacción pendiente, sin
 * ninguna señal de que el pago estaba esperando una redirección que él nunca iba
 * a hacer. El pago se quedaba colgado hasta expirar.
 *
 * ## Por qué es una unión etiquetada y no un campo opcional
 *
 * La alternativa obvia era agregarle a `Transaction` un `redirectUrl?: string`.
 * Se descartó porque **olvidarlo compila igual**: el comercio lee `getStatus()`,
 * ve `PENDING`, se va a hacer polling y nunca redirige. El compilador no tiene
 * de qué agarrarse.
 *
 * Con una unión discriminada por `outcome`, el campo `transaction` **no existe**
 * hasta que se haya descartado el caso de redirección. Olvidarlo no compila, que
 * es exactamente la garantía que se buscaba:
 *
 * ```ts
 * const result = await kit.createPayment(request);
 * if (result.outcome === "REDIRECT_REQUIRED") {
 *   return response.redirect(result.redirect.redirectUrl);
 * }
 * // Acá TypeScript ya sabe que hay transacción.
 * console.log(result.transaction.getStatus());
 * ```
 *
 * Ver `architecture-log.md`, punto 19, para por qué el eje que PSE expone son las
 * operaciones previas a la redirección y no los campos.
 */

/** Datos mínimos para mandar al pagador a completar el pago por fuera. */
export interface PendingRedirect {
  /** URL a la que hay que enviar al pagador. Nunca vacía. */
  readonly redirectUrl: string;

  /**
   * Identificador con el que la pasarela reconoce el pago que quedó a medias.
   * Es lo que después permite consultar el estado: sin él, un pago redirigido
   * sería irrastreable si el pagador nunca vuelve.
   */
  readonly gatewayTransactionId: GatewayTransactionId;

  /** Estado nativo tal como lo devolvió la pasarela, para auditoría. */
  readonly rawStatus: string;
}

/** La pasarela resolvió y devolvió una transacción. Puede estar aprobada, rechazada o pendiente. */
export interface TransactionOutcome {
  readonly outcome: "TRANSACTION";
  readonly transaction: Transaction;
}

/** El pago arrancó pero no avanza hasta que el pagador visite la URL. */
export interface RedirectRequiredOutcome {
  readonly outcome: "REDIRECT_REQUIRED";
  readonly redirect: PendingRedirect;
}

export type PaymentResult = TransactionOutcome | RedirectRequiredOutcome;

/**
 * Envuelve una transacción como resultado.
 *
 * Son funciones de módulo y no métodos estáticos de una clase porque
 * `PaymentResult` es una unión de interfaces, no una clase: no hay estado ni
 * identidad que mantener, solo dos formas de armar el mismo tipo. Es el mismo
 * criterio de `payload-utils.ts` y `rapyd-signature.ts`.
 */
export function transactionResult(transaction: Transaction): TransactionOutcome {
  return { outcome: "TRANSACTION", transaction };
}

/** Envuelve una redirección pendiente como resultado. */
export function redirectRequired(
  redirect: PendingRedirect,
): RedirectRequiredOutcome {
  if (!redirect.redirectUrl) {
    // Un resultado de redirección sin URL es peor que un error: el comercio
    // creeria que tiene que redirigir y no sabria a donde, y el pago quedaria
    // colgado igual que antes de este cambio.
    throw new Error("redirectRequired requiere redirectUrl no vacia");
  }
  return { outcome: "REDIRECT_REQUIRED", redirect };
}
