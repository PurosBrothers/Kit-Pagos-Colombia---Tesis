/**
 * Lectura de las respuestas de transferencia (PSE) de Kushki.
 *
 * ## Por qué esto existe aparte del normalizador de tarjeta
 *
 * Porque Kushki no devuelve la misma forma para los dos métodos, y la diferencia
 * no es cosmética. Medido contra la API UAT real el 18 de septiembre de 2026
 * (punto 48 del `architecture-log.md`), `GET /transfer/v1/status/{token}` responde:
 *
 * ```json
 * {
 *   "status": "initializedTransaction",
 *   "token": "16ea5d8beeed4d98948efb09b4d41d9f",
 *   "paymentDescription": "ORDER-PSE-1789775019380",
 *   "email": "comprador@example.com",
 *   "amount": { "subtotalIva0": 50000, "subtotalIva": 0, "iva": 0, "ice": 0, "currency": "COP" },
 *   "transactionReference": "adb294b7-a13b-480b-8c63-8a6641b31d8d",
 *   "bankId": "0001", "documentType": "CC", "documentNumber": "123456789", ...
 * }
 * ```
 *
 * No trae `ticketNumber`, que es el campo sin el cual el normalizador de tarjeta
 * rechaza la respuesta, ni `transaction_status`, que es de donde lee el estado, ni
 * `contactDetails.email`, que es de donde lee al pagador. O sea que **el
 * normalizador de tarjeta no podía leer una transferencia real**: fallaba con
 * `MALFORMED_RESPONSE: missing ticketNumber`. Las pruebas no lo veían porque el
 * mock del simulador devolvía la forma de tarjeta con el token metido en
 * `ticketNumber`, que era una forma que Kushki nunca produce.
 *
 * Es el mismo hallazgo de los puntos 43 y 44, tercera vez en este issue: un mock
 * escrito a partir de lo que el código esperaba, en vez de a partir de lo que la
 * pasarela responde, confirma el código en vez de verificarlo.
 *
 * ## Por qué son funciones de módulo
 *
 * Para no sumarle métodos ni acoplamiento a `KushkiResponseNormalizer`, que ya
 * está en su umbral de CBO. El normalizador solo decide cuál de las dos formas
 * tiene enfrente y delega; el criterio es `isKushkiTransferResponse`.
 */
import { Gateway } from "../../../domain/value-objects/Gateway";
import { Transaction } from "../../../domain/entities/Transaction";
import { Amount } from "../../../domain/value-objects/Amount";
import { Currency } from "../../../domain/value-objects/Currency";
import { OrderReference } from "../../../domain/value-objects/OrderReference";
import { Payer } from "../../../domain/value-objects/Payer";
import { GatewayTransactionId } from "../../../domain/value-objects/GatewayTransactionId";
import {
  KUSHKI_NATIVE_STATUS,
  lookupNativeStatus,
} from "../../../domain/services/native-status";
import { KitPagosError } from "../../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../../domain/value-objects/KitPagosErrorCode";
import { mapValueObjectError, amountToString, firstNonEmptyString } from "./payload-utils";

const FALLBACK_EMAIL = "customer@kushki.com";

/**
 * Distingue una respuesta de transferencia de una de tarjeta.
 *
 * El discriminador es **el nombre del campo de estado**: la transferencia lo llama
 * `status` y la tarjeta `transaction_status`. Son dos vocabularios distintos de la
 * misma pasarela, y el nombre del campo es lo único que no cambia a lo largo del
 * ciclo de vida.
 *
 * La primera versión usaba "tiene `token` y no tiene `ticketNumber`", y medir el
 * flujo completo contra la API UAT mostró que está mal: **antes** de iniciar la
 * transferencia la respuesta no trae `ticketNumber`, pero **después** sí, porque
 * Kushki le asigna uno al llegar al procesador. Con ese discriminador, consultar una
 * transferencia ya iniciada —el único momento en que un comercio la consulta— caía
 * en el camino de tarjeta, que no encuentra `transaction_status` y devuelve `ERROR`
 * sobre un pago perfectamente vivo.
 *
 * Es el defecto que no se veía ni con las pruebas unitarias ni con una sola llamada
 * suelta: hubo que recorrer el flujo entero para que apareciera.
 */
export function isKushkiTransferResponse(payload: Record<string, unknown>): boolean {
  return (
    payload.transaction_status === undefined &&
    typeof payload.status === "string" &&
    typeof payload.token === "string"
  );
}

/**
 * Reconstruye una `Transaction` a partir de la consulta de estado de una
 * transferencia.
 *
 * El identificador es el token, y no el `ticketNumber` que Kushki agrega después de
 * iniciar la transferencia, porque el token es lo que el SDK ya le entregó al
 * comercio en la redirección y lo que la ruta de consulta acepta. Devolver un
 * identificador distinto al que se entregó dejaría al comercio sin saber cuál de los
 * dos guardar.
 *
 * La referencia del comercio sale de `paymentDescription`, que es donde el adaptador
 * la mandó al pedir el token y **vuelve intacta**, medido. `transactionReference` no
 * sirve para eso: lo genera Kushki, y devolvérselo al comercio sería darle un
 * identificador que nunca envió.
 */
export function normalizeKushkiTransfer(
  payload: Record<string, unknown>,
  rawResponse: unknown,
): Transaction {
  const token = String(payload.token ?? "");
  const amountData = payload.amount as Record<string, unknown> | undefined;

  if (!amountData || typeof amountData !== "object") {
    throw new KitPagosError(
      KitPagosErrorCode.MALFORMED_RESPONSE,
      Gateway.KUSHKI,
      rawResponse,
      "Malformed transfer response from Kushki gateway: missing amount",
    );
  }

  const currency = new Currency(String(amountData.currency ?? "COP"));

  // El monto viene descompuesto en los mismos componentes tributarios con los que
  // se pidió el token, así que el total se reconstruye sumándolos.
  const amount = mapValueObjectError(
    () =>
      new Amount(amountToString(amountData.subtotalIva0))
        .add(new Amount(amountToString(amountData.subtotalIva)))
        .add(new Amount(amountToString(amountData.iva)))
        .add(new Amount(amountToString(amountData.ice))),
    Gateway.KUSHKI,
    rawResponse,
    "Malformed amount in Kushki transfer response",
  );

  const rawStatus = String(payload.status ?? "");

  return new Transaction(
    new GatewayTransactionId(token, Gateway.KUSHKI),
    new OrderReference(
      firstNonEmptyString(
        [payload.paymentDescription, payload.transactionReference],
        token,
      ),
    ),
    amount,
    currency,
    new Payer({ email: firstNonEmptyString([payload.email], FALLBACK_EMAIL) }),
    lookupNativeStatus(KUSHKI_NATIVE_STATUS, rawStatus),
    rawStatus,
  );
}
