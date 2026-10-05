import { randomBytes } from "node:crypto";
import { RapydCheckout, RapydPayment } from "../gateways/rapyd/types";
import { StateMachine } from "./StateMachine";
import { Transition } from "./Transition";

/** Estados nativos del pago en Rapyd (`types.ts`, línea 30). */
export type RapydPaymentStatus = RapydPayment["status"];

/** Estados nativos del checkout en Rapyd (`types.ts`, línea 205). */
export type RapydCheckoutStatus = RapydCheckout["status"];

/**
 * El id que Rapyd asigna a un pago: prefijo `payment_` seguido de 32 hexadecimales.
 *
 * Vive acá y no en la fábrica porque lo necesitan los dos lados: la tabla lo genera
 * cuando nace el pago de un checkout, y la fábrica lo genera cuando se crea un pago
 * directo de PSE. Definir la forma en un solo sitio evita que las dos rutas diverjan y
 * que un id con otro formato llegue al sondeo del SDK, que elige ruta mirando el
 * prefijo.
 */
export function buildRapydPaymentId(): string {
  return `payment_${randomBytes(16).toString("hex")}`;
}

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
    apply: (checkout) => ({
      ...checkout,
      payment: {
        ...checkout.payment,
        id: buildRapydPaymentId(),
        status: "CLO",
        paid: true,
      },
    }),
  },
];

/**
 * La tabla del pago (issue #124).
 *
 * `ACT`, `CLO`, `ERR`, `EXP` y `REV` son los cinco estados de
 * `RapydPaymentStatus`. Solo `ACT` —activo, esperando que el pagador lo complete— tiene
 * salida.
 *
 * ## Los estados finales no tienen transición de entrada
 *
 * Deliberado, y es el criterio 1 del issue: un pago creado como declinado tiene que
 * consultarse como declinado, con su monto y su referencia. Si `DECLINED` tuviera una
 * transición, la consulta lo movería a aprobado y volvería el defecto.
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
    to: "CLO",
    apply: (payment) => ({ ...payment, status: "CLO", paid: true }),
  },
];

/** La máquina del checkout de Rapyd. */
export const rapydCheckoutMachine = new StateMachine<
  RapydCheckout,
  RapydCheckoutStatus
>(RAPYD_CHECKOUT_TRANSITIONS, {
  statusOf: (checkout) => checkout.status,
  withStatus: (checkout, status) => ({ ...checkout, status }),
});

/** La máquina del pago de Rapyd. */
export const rapydPaymentMachine = new StateMachine<RapydPayment, RapydPaymentStatus>(
  RAPYD_PAYMENT_TRANSITIONS,
  {
    statusOf: (payment) => payment.status,
    withStatus: (payment, status) => ({ ...payment, status }),
  },
);