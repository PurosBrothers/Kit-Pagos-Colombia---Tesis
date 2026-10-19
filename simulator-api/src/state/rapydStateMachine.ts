import { randomBytes } from "node:crypto";
import { RAPYD_CARD_DECLINE } from "../gateways/rapyd/GatewayMockFactory";
import { RapydCheckout, RapydPayment } from "../gateways/rapyd/types";
import { scenarioTargetFor } from "./scenarioTarget";
import { StateMachine } from "./StateMachine";
import { Transition } from "./Transition";

/** Estados nativos del pago en Rapyd (`types.ts`, línea 30). */
export type RapydPaymentStatus = RapydPayment["status"];

/** Estados nativos del checkout en Rapyd (`types.ts`, línea 205). */
export type RapydCheckoutStatus = RapydCheckout["status"];

/**
 * El id que Rapyd asigna a un pago: prefijo `payment_` seguido de 32 hexadecimales.
 *
 * Vive aquí y no en la fábrica porque lo necesitan los dos lados: la tabla lo genera
 * cuando nace el pago de un checkout, y la fábrica lo genera cuando se crea un pago
 * directo de PSE. Definir la forma en un solo sitio evita que las dos rutas diverjan y
 * que un id con otro formato llegue al sondeo del SDK, que elige ruta mirando el
 * prefijo.
 */
export function buildRapydPaymentId(): string {
  return `payment_${randomBytes(16).toString("hex")}`;
}

/** Los estados con los que puede nacer el pago de un checkout pagado. */
export const RAPYD_CHECKOUT_PAYMENT_TARGETS: readonly RapydPaymentStatus[] = ["CLO", "ERR"];

/** Los destinos que la creación puede registrar para un pago de PSE. */
export const RAPYD_PAYMENT_TARGETS: readonly RapydPaymentStatus[] = ["ACT"];

/**
 * La tabla del checkout (issue #124).
 *
 * `NEW` y `DON` son los dos estados que expone `RapydCheckout["status"]`. El checkout es
 * un recurso de un solo paso: nace cuando el comercio pide una página de pago, y pasa a
 * `DON` cuando alguien la visita y la llena.
 *
 * **Nivel 1 — medido** el 19 de septiembre de 2026 contra `sandboxapi.rapyd.net`: la
 * forma del checkout con el pago en `null` está verificada, y se midió que un checkout
 * creado y no visitado **se queda en `NEW` indefinidamente**. Esa medición es la razón
 * de que la transición la disponga `pay` y no `query`: si la disparara una consulta, un
 * comercio que preguntara dos veces vería aparecer un pago que nadie hizo, que es
 * exactamente el defecto que este issue reporta en las otras tres pasarelas.
 *
 * Que el pago tenga `id` **es** el estado de la transición: no hace falta un contador ni
 * un campo extra.
 *
 * ## El pago que nace puede estar declinado
 *
 * El estado del pago que nace al pagar la página sale del destino registrado al crear el
 * checkout: `ERR` si la creación pidió un rechazo, `CLO` si no pidió nada. Es el camino de
 * tarjeta del SDK (`RapydAdapter` cobra con `POST /checkout`), y antes terminaba cobrado
 * aunque se hubiera pedido el rechazo.
 *
 * **Nivel 3 — decisión del simulador**: no se midió qué hace el sandbox con una página
 * cuyo pago se declina. El simulador la deja en `DON` con el pago en `ERR` y el
 * `failure_code` del rechazo, que es lo mínimo para que la consulta del checkout y la del
 * pago se normalicen igual.
 */
export const RAPYD_CHECKOUT_TRANSITIONS: readonly Transition<
  RapydCheckoutStatus,
  RapydCheckout
>[] = [
  {
    /* El pagador visita la página y la llena: el checkout pasa a DON y nace el pago. */
    from: ["NEW"],
    on: "pay",
    to: "DON",
    when: (checkout) => checkout.payment.id === null,
    apply: (checkout) => {
      const paymentStatus =
        scenarioTargetFor(RAPYD_CHECKOUT_PAYMENT_TARGETS, "rapyd", "checkout", checkout.id) ??
        "CLO";

      return {
        ...checkout,
        payment: {
          ...checkout.payment,
          id: buildRapydPaymentId(),
          status: paymentStatus,
          paid: paymentStatus === "CLO",
          ...(paymentStatus === "ERR" ? RAPYD_CARD_DECLINE : {}),
        },
      };
    },
  },
];

/**
 * La tabla del pago (issue #124).
 *
 * `ACT`, `CLO`, `ERR`, `EXP` y `REV` son los cinco estados de
 * `RapydPaymentStatus`. Solo `ACT` —activo, esperando que el pagador lo complete— tiene
 * salida.
 *
 * ## Los estados finales no tienen transición de salida
 *
 * Deliberado, y es el criterio 1 del issue: un pago creado como declinado tiene que
 * consultarse como declinado, con su monto y su referencia. Si `ERR` tuviera una
 * transición, la consulta lo movería a aprobado y volvería el defecto.
 *
 * ## Un pago de PSE pedido pendiente se queda en `ACT`
 *
 * La creación registra `ACT` como destino y la consulta termina en el estado del que
 * salió. Es la misma decisión que en Wompi y en la transferencia de Kushki (nivel 3).
 *
 * ## Por qué `CLO` con `paid: true` van juntos
 *
 * Porque `CLO` por sí solo no significa cobrado: es el estado cerrado del pago, y lo
 * que dice que se cobró es `paid`. Escritos juntos, un adaptador que decide éxito
 * mirando solo el estado no puede pasar una prueba por accidente.
 *
 * **Nivel 3 — sin medir**: `docs/testing-data/README.md` §4 lista como hueco conocido
 * de Rapyd que *"no se sabe si el sandbox permite forzar los estados finales de PSE"*.
 * El destino que declara esta tabla es el que el simulador necesita para poder
 * ejercitar el flujo completo, y por eso queda anotado como decisión del simulador y no
 * como afirmación sobre el sandbox. La medición pendiente es la del paso 6.
 */
export const RAPYD_PAYMENT_TRANSITIONS: readonly Transition<
  RapydPaymentStatus,
  RapydPayment
>[] = [
  {
    /*
     * El pago pendiente se cierra al consultarlo. El `apply` está porque cerrar no es
     * solo cambiar el estado: un pago que se cobró tiene que decir `paid: true`, y sin
     * eso el adaptador vería `CLO` sin haber cobrado, que es el caso que
     * `RapydResponseNormalizer` trata como no aprobado.
     */
    from: ["ACT"],
    on: "query",
    to: (payment) =>
      scenarioTargetFor(RAPYD_PAYMENT_TARGETS, "rapyd", "payment", payment.id) ?? "CLO",
    apply: (payment, to) => (to === "CLO" ? { ...payment, paid: true } : payment),
  },
];

/** La máquina del checkout de Rapyd. */
export const rapydCheckoutMachine = new StateMachine<
  RapydCheckout,
  RapydCheckoutStatus
>(
  RAPYD_CHECKOUT_TRANSITIONS,
  {
    statusOf: (checkout) => checkout.status,
    withStatus: (checkout, status) => ({ ...checkout, status }),
  },
  "rapyd.checkout",
);

/** La máquina del pago de Rapyd. */
export const rapydPaymentMachine = new StateMachine<RapydPayment, RapydPaymentStatus>(
  RAPYD_PAYMENT_TRANSITIONS,
  {
    statusOf: (payment) => payment.status,
    withStatus: (payment, status) => ({ ...payment, status }),
  },
  "rapyd.payment",
);