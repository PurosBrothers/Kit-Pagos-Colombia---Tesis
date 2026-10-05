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
 * ## Por qué la tabla está vacía
 *
 * Porque un pago con tarjeta **nace resuelto o en revisión**, y ninguno de los dos casos
 * tiene una salida medida. `approved`, `rejected` y `cancelled` son finales. `in_process`
 * no es final, pero lo que lo saca de ahí es la revisión de Mercado Pago: según la tabla
 * oficial de resultados, `pending_review_manual` se notifica por correo «if it is credited
 * or if we need more information», o sea que puede terminar acreditado o no. Declarar
 * `in_process → approved` sería afirmar un desenlace que la pasarela no garantiza.
 *
 * Lo medido el 19 de septiembre de 2026 (`docs/testing-data/mercado-pago.md`, líneas 69 a
 * 71) son respuestas `201` con `cc_rejected_high_risk`, `cc_rejected_max_attempts` y
 * `pending_review_manual`. No hay un pago aprobado medido: el `approved` del simulador es
 * nivel 3, tomado de la misma tabla oficial.
 *
 * Los estados `pending` e `in_process` se quedan en el tipo. Que la tabla no tenga
 * transiciones para ellos significa que una consulta los devuelve como están, que es el
 * criterio 1 del issue aplicado al pendiente.
 *
 * ## PSE no pasa por aquí
 *
 * Un pago de PSE es una **orden**, no un pago: la API de pagos devuelve `424` para un
 * método de PSE (medido). Por eso hay dos tablas y no una.
 */
export const MP_PAYMENT_TRANSITIONS: readonly Transition<
  MercadoPagoPaymentStatus,
  MercadoPagoPaymentResponse
>[] = [];

/**
 * Los destinos que la creación puede registrar para una orden que espera al pagador.
 *
 * Salen de la tabla de estados de la orden de Checkout API para Colombia
 * (https://www.mercadopago.com.co/developers/en/docs/checkout-api-orders/payment-management/status/order-status,
 * consultada el 5 de octubre de 2026). Esa página tiene `expired` y `canceled` como dos
 * estados distintos, así que una orden caducada es `expired`.
 */
export const MP_ORDER_TARGETS: readonly MercadoPagoOrderStatus[] = [
  "processed",
  "expired",
  "action_required",
];

/**
 * El `status_detail` que la misma página empareja con cada destino de salida:
 * `processed | accredited` y `expired | expired`.
 */
export const MP_ORDER_STATUS_DETAIL_ON_EXIT: Partial<Record<MercadoPagoOrderStatus, string>> = {
  processed: "accredited",
  expired: "expired",
};

/**
 * La tabla de órdenes de Mercado Pago (issue #124).
 *
 * ## `action_required` es el estado que importa
 *
 * Es el que dice que la orden existe y que falta que el pagador autorice en el banco.
 * Nace así, con la URL de redirección ya en `next_action`, y no hay ninguna forma de
 * observar el paso intermedio en el simulador: la URL apunta al portal del banco, que el
 * simulador no aloja. Por eso la transición la dispara la consulta y no una visita: no
 * hay nada que visitar aquí.
 *
 * Esa asimetría con Wompi es a propósito. Wompi publica la URL del banco en una consulta
 * y resuelve en la siguiente, y su tabla tiene dos transiciones desde `PENDING`; aquí la
 * URL se publica **al crear**, así que una consulta basta.
 *
 * **Nivel 1 — medido** el 19 de septiembre de 2026: que la API de pagos responda `424`
 * para un método de PSE, y que la orden nazca en `action_required` con su redirección.
 * Los desenlaces **no están medidos** — `docs/testing-data/README.md` §4 lista la
 * autenticación del endpoint de órdenes como hueco conocido, y con credenciales de prueba
 * responde `401`. **Nivel 3**: los tres destinos de `MP_ORDER_TARGETS` son estados de la
 * documentación oficial, y que el simulador los alcance con una consulta es una decisión
 * del simulador para poder cerrar el ciclo, no una afirmación sobre la API.
 *
 * `processing` y `created` se quedan en el tipo y sin transición: ninguna ruta los produce.
 */
export const MP_ORDER_TRANSITIONS: readonly Transition<
  MercadoPagoOrderStatus,
  MercadoPagoOrderResponse
>[] = [
  {
    /*
     * La orden espera al pagador en el banco; al consultarla, ya volvió o ya venció.
     *
     * Sin destino registrado, la orden se acredita. Con `action_required` registrado
     * —el escenario `PENDING`— el destino es el estado de origen y el `apply` devuelve la
     * misma orden, así que la ruta no guarda nada.
     *
     * Cuando la orden sale de `action_required`, el `apply` quita la URL de redirección y
     * pone el `status_detail` del destino. La URL no es cosmética: la orden la trae en
     * `transactions.payments[0].payment_method.redirect_url` mientras espera, y dejarla
     * haría que el normalizador siguiera ofreciendo un destino de redirección después del
     * pago, que es el bucle que el criterio 8 del issue busca cerrar.
     */
    from: ["action_required"],
    on: "query",
    to: (order) =>
      scenarioTargetFor(MP_ORDER_TARGETS, "mercadopago", "order", order.id) ?? "processed",
    apply: (order, to) => {
      if (to === "action_required") {
        return order;
      }

      return {
        ...order,
        status_detail: MP_ORDER_STATUS_DETAIL_ON_EXIT[to] ?? order.status_detail,
        transactions: {
          payments: order.transactions.payments.map((payment) => ({
            ...payment,
            payment_method: { ...payment.payment_method, redirect_url: undefined },
          })),
        },
      };
    },
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