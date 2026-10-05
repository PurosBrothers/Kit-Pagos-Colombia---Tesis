import {
  MercadoPagoOrderResponse,
  MercadoPagoOrderStatus,
  MercadoPagoPaymentResponse,
  MercadoPagoPaymentStatus,
} from "../gateways/mercadopago/types";
import { scenarioTargetFor } from "./scenarioTarget";
import { StateMachine } from "./StateMachine";
import { Transition } from "./Transition";

/**
 * La tabla de pagos de Mercado Pago (issue #124).
 *
 * Los cinco estados de `MercadoPagoPaymentStatus` están en minúsculas porque así los
 * emite la pasarela, y esa diferencia con las otras tres es real: son los que el
 * normalizador del SDK tiene que mapear.
 *
 * ## Por qué solo hay dos transiciones y las dos son de consulta
 *
 * Porque un pago con tarjeta **nace ya resuelto**: contra `api.mercadopago.com` un pago
 * con tarjeta aprobado responde `201` con `status: "approved"` y no hay un estado
 * intermedio que atravesar. `approved`, `rejected` y `cancelled` son finales, y declararlos
 * finales es la mitad del trabajo de la tabla: son los que hacen que consultar un pago
 * declinado devuelva declinado en vez de moverlo.
 *
 * `pending` e `in_process` sí tienen salida, y comparten destino: en Mercado Pago un pago
 * que quedó en cualquiera de los dos se acredita y termina `approved`. Son los dos
 * estados que usa un medio de pago diferido, y los que la API devuelve cuando el cobro se
 * resuelve después de la creación.
 *
 * **Nivel 1 — medido**: `docs/testing-data/mercadopago.md` cubre el pago con tarjeta. Los
 * estados `pending` e `in_process` no tienen medición en el simulador porque ningún camino
 * los produce todavía; quedan declarados para que la tabla sea el vocabulario completo de
 * la pasarela y no un subconjunto.
 *
 * ## PSE no pasa por acá
 *
 * Un pago de PSE es una **orden**, no un pago: la API de pagos devuelve `424` para un
 * método de PSE (medido). Por eso hay dos tablas y no una.
 */
export const MP_PAYMENT_TRANSITIONS: readonly Transition<
  MercadoPagoPaymentStatus,
  MercadoPagoPaymentResponse
>[] = [
  {
    /* Un pago diferido se acredita al consultarlo. */
    from: ["pending"],
    on: "query",
    to: "approved",
  },
  {
    /* Igual que `pending`: en la API de pagos ambos terminan acreditados. */
    from: ["in_process"],
    on: "query",
    to: "approved",
  },
];

/**
 * La tabla de órdenes de Mercado Pago (issue #124).
 *
 * ## `action_required` es el estado que importa
 *
 * Es el que dice que la orden existe y que falta que el pagador autorice en el banco.
 * Nace así, con la URL de redirección ya en `next_action`, y no hay ninguna forma de
 * observar el paso intermedio en el simulador: la URL apunta al portal del banco, que el
 * simulador no aloja. Por eso la transición la dispara la consulta y no una visita: no
 * hay nada que visitar acá.
 *
 * Esa asimetría con Wompi es a propósito. Wompi publica la URL del banco en una consulta
 * y resuelve en la siguiente, y su tabla tiene dos transiciones desde `PENDING`; acá la
 * URL se publica **al crear**, así que una consulta basta.
 *
 * **Nivel 1 — medido** el 19 de septiembre de 2026: que la API de pagos responda `424`
 * para un método de PSE, y que la orden nazca en `action_required` con su redirección.
 * Los desenlaces `processed` y `failed` **no están medidos** — `docs/testing-data/README.md`
 * §4 lista la autenticación del endpoint de órdenes como hueco conocido, y con
 * credenciales de prueba responde `401`. El destino de la transición es el que el
 * simulador necesita para poder cerrar el ciclo, y queda anotado como decisión del
 * simulador, no como afirmación sobre la API.
 */
export const MP_ORDER_TRANSITIONS: readonly Transition<
  MercadoPagoOrderStatus,
  MercadoPagoOrderResponse
>[] = [
  {
    /*
     * La orden espera al pagador en el banco; al consultarla, ya volvió.
     *
     * El `apply` quita la URL de redirección, y no es cosmético: la orden la trae en
     * `transactions.payments[0].payment_method.redirect_url` mientras está pendiente, y una
     * orden pagada en la API real ya no la tiene. Dejarla haría que el normalizador
     * siguiera ofreciendo un destino de redirección después del pago, que es el bucle que
     * el criterio 8 del issue busca cerrar.
     */
    from: ["action_required"],
    on: "query",
    to: (order) =>
      (scenarioTargetFor("mercadopago", "order", order.id) as
        | MercadoPagoOrderStatus
        | undefined) ?? "processed",
    apply: (order) => ({
      ...order,
      transactions: {
        payments: order.transactions.payments.map((payment) => ({
          ...payment,
          payment_method: { ...payment.payment_method, redirect_url: undefined },
        })),
      },
    }),
  },
  {
    /* Una orden en procesamiento sigue el mismo camino. */
    from: ["processing"],
    on: "query",
    to: "processed",
    apply: (order) => ({
      ...order,
      transactions: {
        payments: order.transactions.payments.map((payment) => ({
          ...payment,
          payment_method: { ...payment.payment_method, redirect_url: undefined },
        })),
      },
    }),
  },
];

/** La máquina de pagos de Mercado Pago. */
export const mpPaymentMachine = new StateMachine<
  MercadoPagoPaymentResponse,
  MercadoPagoPaymentStatus
>(MP_PAYMENT_TRANSITIONS, {
  statusOf: (payment) => payment.status,
  withStatus: (payment, status) => ({ ...payment, status }),
});

/** La máquina de órdenes de Mercado Pago. */
export const mpOrderMachine = new StateMachine<
  MercadoPagoOrderResponse,
  MercadoPagoOrderStatus
>(MP_ORDER_TRANSITIONS, {
  statusOf: (order) => order.status,
  withStatus: (order, status) => ({ ...order, status }),
});