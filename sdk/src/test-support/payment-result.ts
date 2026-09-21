import { Transaction } from "../domain/entities/Transaction";
import {
  PaymentResult,
  PendingRedirect,
} from "../domain/value-objects/PaymentResult";

/**
 * Ayudantes de prueba para estrechar un `PaymentResult`.
 *
 * ## Por qué no van en `PaymentResult.ts`
 *
 * Porque lanzan. Una función `desenvolverTransaccion(result)` que explote en
 * tiempo de ejecución sería, en la API pública, un atajo para saltarse
 * exactamente la distinción que el issue #64 introdujo: el comercio la usaría
 * para no escribir el `if`, y volveríamos a tener pagos con redirección
 * ignorada, solo que fallando más tarde y peor.
 *
 * En una prueba el trato es el contrario. La prueba ya sabe qué rama espera
 * —está montando la respuesta de la pasarela ella misma— y si llega la otra, lo
 * correcto es fallar ruidosamente. Además, lanzar acá estrecha el tipo para el
 * resto del caso de prueba, así que las aserciones siguientes se escriben contra
 * `Transaction` sin ceremonia.
 */

/** Afirma que el resultado trae transacción y la devuelve. */
export function expectTransaction(result: PaymentResult): Transaction {
  if (result.outcome !== "TRANSACTION") {
    throw new Error(
      `Se esperaba una transaccion y llego outcome="${result.outcome}"`,
    );
  }
  return result.transaction;
}

/** Afirma que el resultado exige redirección y devuelve sus datos. */
export function expectRedirect(result: PaymentResult): PendingRedirect {
  if (result.outcome !== "REDIRECT_REQUIRED") {
    throw new Error(
      `Se esperaba una redireccion pendiente y llego outcome="${result.outcome}"`,
    );
  }
  return result.redirect;
}
