import {
  MercadoPagoOrderResponse,
  MercadoPagoPaymentResponse,
} from "../src/gateways/mercadopago/types";
import { mpOrderMachine, mpPaymentMachine } from "../src/state/mercadopagoStateMachine";
import { rememberScenarioTarget } from "../src/state/scenarioTarget";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * Pruebas de las tablas de Mercado Pago (issue #124, criterio 4).
 *
 * Son **dos** tablas porque Mercado Pago cobra por dos APIs distintas: la de pagos y la de
 * órdenes. Un PSE nunca pasa por `POST /payments` —la API responde `424` para un método de
 * PSE—, así que una sola tabla no podría describir los dos ciclos.
 *
 * Sin HTTP ni store: la tabla se llama con un registro y se mira el estado.
 */

function payment(status: MercadoPagoPaymentResponse["status"]): MercadoPagoPaymentResponse {
  return {
    id: "9876543210",
    status: status,
    status_detail: status === "approved" ? "accredited" : "pending_review_manual",
    transaction_amount: 35000,
    currency_id: "COP",
    description: "Camiseta estampada",
    external_reference: "ORD-MP-4242",
    payer: { email: "comprador@example.com" },
    date_created: "2026-09-19T15:00:00.000-04:00",
    date_approved: status === "approved" ? "2026-09-19T15:00:01.000-04:00" : null,
  };
}

function order(status: MercadoPagoOrderResponse["status"]): MercadoPagoOrderResponse {
  return {
    id: "ORD01ABCDEF0123456789",
    type: "online",
    processing_mode: "automatic",
    external_reference: "ORD-MP-PSE-7",
    total_amount: "35000",
    total_paid_amount: status === "processed" ? "35000" : "0",
    country_code: "CO",
    status: status,
    status_detail: status === "processed" ? "accredited" : "pending_action",
    currency: "COP",
    created_date: "2026-09-19T15:00:00.000-04:00",
    last_updated_date: "2026-09-19T15:00:00.000-04:00",
    payer: { entity_type: "individual" },
    transactions: {
      payments: [
        {
          id: "PAY01ABCDEF0123456789",
          amount: "35000",
          reference_id: "ORD-MP-PSE-7",
          status: status,
          status_detail: status === "processed" ? "accredited" : "pending_action",
          payment_method: {
            id: "pse",
            type: "bank_transfer",
            financial_institution: "1051",
            redirect_url: "https://www.mercadopago.com.co/payments/PAY01/bank_transfer",
          },
        },
      ],
    },
  };
}

const orderUrl = (o: MercadoPagoOrderResponse): string | undefined =>
  o.transactions.payments[0]?.payment_method.redirect_url;

describe("Mercado Pago payment table", () => {
  it.each([["approved"], ["rejected"], ["cancelled"], ["pending"], ["in_process"]] as const)(
    "a payment in %s does not move again when queried",
    (status) => {
      // El criterio 1 del issue: un pago creado declinado se consulta declinado y uno
      // creado en revisión se consulta en revisión. `in_process` no es final, pero lo que lo
      // saca de ahí es la revisión de Mercado Pago, que puede acreditarlo o no: la tabla
      // no tiene fuente para elegir un desenlace.
      const final = payment(status);

      expect(mpPaymentMachine.transition(final, "query")).toBe(final);
      expect(mpPaymentMachine.canTransition(final, "query")).toBe(false);
    },
  );
});

describe("Mercado Pago order table", () => {
  beforeEach(() => {
    resetSimulatorState();
  });

  afterEach(() => {
    resetSimulatorState();
  });

  it("an action_required order moves to processed when queried", () => {
    // La orden nace esperando al pagador en el banco; la consulta dice que ya volvió.
    const queried = mpOrderMachine.transition(order("action_required"), "query");

    expect(queried.status).toBe("processed");
    // `processed | accredited`, el par de la tabla oficial de estados de la orden.
    expect(queried.status_detail).toBe("accredited");
  });

  it("an order with expired registered ends expired, not canceled", () => {
    // La Orders API tiene `expired` y `canceled` como dos estados distintos.
    rememberScenarioTarget("mercadopago", "order", "ORD01ABCDEF0123456789", "expired");

    const queried = mpOrderMachine.transition(order("action_required"), "query");

    expect(queried.status).toBe("expired");
    expect(queried.status_detail).toBe("expired");
    expect(orderUrl(queried)).toBeUndefined();
  });

  it("an order with action_required registered stays waiting, with its URL", () => {
    // El pagador que nunca vuelve del banco. La misma referencia es lo que le dice a la
    // ruta que no hay nada que guardar, y la URL sigue ahí para que pueda volver a ir.
    rememberScenarioTarget("mercadopago", "order", "ORD01ABCDEF0123456789", "action_required");
    const pending = order("action_required");

    for (const _ of [1, 2]) {
      const queried = mpOrderMachine.transition(pending, "query");

      expect(queried).toBe(pending);
      expect(orderUrl(queried)).toBeDefined();
    }
  });

  it("fails if the registered target is not declared in the table", () => {
    // `canceled` es un estado real de la orden, pero no es un destino que la creación pueda
    // pedir. Caer al destino por defecto lo convertiría en una orden cobrada.
    rememberScenarioTarget("mercadopago", "order", "ORD01ABCDEF0123456789", "canceled");

    expect(() => mpOrderMachine.transition(order("action_required"), "query")).toThrow(
      "'canceled' registrado para mercadopago/order no está declarado",
    );
  });

  it("removes the redirect URL when the order is paid", () => {
    // Si la orden pagada siguiera ofreciendo un destino de redirección, el pagador podría
    // caer otra vez en la redirección de un cobro ya cobrado. En la API real una orden
    // `processed` ya no la trae.
    const queried = mpOrderMachine.transition(order("action_required"), "query");

    expect(orderUrl(queried)).toBeUndefined();
  });

  it("keeps the amount, the reference and the financial institution", () => {
    const queried = mpOrderMachine.transition(order("action_required"), "query");

    expect(queried.total_amount).toBe("35000");
    expect(queried.external_reference).toBe("ORD-MP-PSE-7");
    expect(queried.transactions.payments[0].payment_method.financial_institution).toBe(
      "1051",
    );
    // El id del pago no se regenera: es el mismo cobro, no uno nuevo.
    expect(queried.transactions.payments[0].id).toBe("PAY01ABCDEF0123456789");
  });

  it.each([
    ["processed"],
    ["expired"],
    ["canceled"],
    ["failed"],
    ["created"],
    ["processing"],
  ] as const)(
    "an order in %s does not move again when queried",
    (status) => {
      const final = order(status);

      expect(mpOrderMachine.transition(final, "query")).toBe(final);
    },
  );

  it("does not mutate the order it receives", () => {
    const original = order("action_required");
    const copy = structuredClone(original);

    mpOrderMachine.transition(original, "query");

    expect(original).toEqual(copy);
    expect(original.status).toBe("action_required");
    expect(orderUrl(original)).toBeDefined();
  });
});