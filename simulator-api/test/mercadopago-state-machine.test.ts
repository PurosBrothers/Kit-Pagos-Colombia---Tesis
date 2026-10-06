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

function pago(estado: MercadoPagoPaymentResponse["status"]): MercadoPagoPaymentResponse {
  return {
    id: "9876543210",
    status: estado,
    status_detail: estado === "approved" ? "accredited" : "pending_review_manual",
    transaction_amount: 35000,
    currency_id: "COP",
    description: "Camiseta estampada",
    external_reference: "ORD-MP-4242",
    payer: { email: "comprador@example.com" },
    date_created: "2026-09-19T15:00:00.000-04:00",
    date_approved: estado === "approved" ? "2026-09-19T15:00:01.000-04:00" : null,
  };
}

function orden(estado: MercadoPagoOrderResponse["status"]): MercadoPagoOrderResponse {
  return {
    id: "ORD01ABCDEF0123456789",
    type: "online",
    processing_mode: "automatic",
    external_reference: "ORD-MP-PSE-7",
    total_amount: "35000",
    total_paid_amount: estado === "processed" ? "35000" : "0",
    country_code: "CO",
    status: estado,
    status_detail: estado === "processed" ? "accredited" : "pending_action",
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
          status: estado,
          status_detail: estado === "processed" ? "accredited" : "pending_action",
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

const urlDeLaOrden = (o: MercadoPagoOrderResponse): string | undefined =>
  o.transactions.payments[0]?.payment_method.redirect_url;

describe("Tabla de pagos de Mercado Pago", () => {
  it.each([["approved"], ["rejected"], ["cancelled"], ["pending"], ["in_process"]] as const)(
    "un pago en %s no vuelve a moverse al consultarse",
    (estado) => {
      // El criterio 1 del issue: un pago creado declinado se consulta declinado y uno
      // creado en revisión se consulta en revisión. `in_process` no es final, pero lo que lo
      // saca de ahí es la revisión de Mercado Pago, que puede acreditarlo o no: la tabla
      // no tiene fuente para elegir un desenlace.
      const final = pago(estado);

      expect(mpPaymentMachine.transition(final, "query")).toBe(final);
      expect(mpPaymentMachine.canTransition(final, "query")).toBe(false);
    },
  );
});

describe("Tabla de órdenes de Mercado Pago", () => {
  beforeEach(() => {
    resetSimulatorState();
  });

  afterEach(() => {
    resetSimulatorState();
  });

  it("una orden action_required pasa a processed al consultarla", () => {
    // La orden nace esperando al pagador en el banco; la consulta dice que ya volvió.
    const consultada = mpOrderMachine.transition(orden("action_required"), "query");

    expect(consultada.status).toBe("processed");
    // `processed | accredited`, el par de la tabla oficial de estados de la orden.
    expect(consultada.status_detail).toBe("accredited");
  });

  it("una orden con expired registrado termina expired, no canceled", () => {
    // La Orders API tiene `expired` y `canceled` como dos estados distintos.
    rememberScenarioTarget("mercadopago", "order", "ORD01ABCDEF0123456789", "expired");

    const consultada = mpOrderMachine.transition(orden("action_required"), "query");

    expect(consultada.status).toBe("expired");
    expect(consultada.status_detail).toBe("expired");
    expect(urlDeLaOrden(consultada)).toBeUndefined();
  });

  it("una orden con action_required registrado se queda esperando, con su URL", () => {
    // El pagador que nunca vuelve del banco. La misma referencia es lo que le dice a la
    // ruta que no hay nada que guardar, y la URL sigue ahí para que pueda volver a ir.
    rememberScenarioTarget("mercadopago", "order", "ORD01ABCDEF0123456789", "action_required");
    const pendiente = orden("action_required");

    for (const _ of [1, 2]) {
      const consultada = mpOrderMachine.transition(pendiente, "query");

      expect(consultada).toBe(pendiente);
      expect(urlDeLaOrden(consultada)).toBeDefined();
    }
  });

  it("falla si el destino registrado no está declarado en la tabla", () => {
    // `canceled` es un estado real de la orden, pero no es un destino que la creación pueda
    // pedir. Caer al destino por defecto lo convertiría en una orden cobrada.
    rememberScenarioTarget("mercadopago", "order", "ORD01ABCDEF0123456789", "canceled");

    expect(() => mpOrderMachine.transition(orden("action_required"), "query")).toThrow(
      "'canceled' registrado para mercadopago/order no está declarado",
    );
  });

  it("quita la URL de redirección cuando la orden se paga", () => {
    // Si la orden pagada siguiera ofreciendo un destino de redirección, el pagador podría
    // caer otra vez en la redirección de un cobro ya cobrado. En la API real una orden
    // `processed` ya no la trae.
    const consultada = mpOrderMachine.transition(orden("action_required"), "query");

    expect(urlDeLaOrden(consultada)).toBeUndefined();
  });

  it("conserva el monto, la referencia y la institución financiera", () => {
    const consultada = mpOrderMachine.transition(orden("action_required"), "query");

    expect(consultada.total_amount).toBe("35000");
    expect(consultada.external_reference).toBe("ORD-MP-PSE-7");
    expect(consultada.transactions.payments[0].payment_method.financial_institution).toBe(
      "1051",
    );
    // El id del pago no se regenera: es el mismo cobro, no uno nuevo.
    expect(consultada.transactions.payments[0].id).toBe("PAY01ABCDEF0123456789");
  });

  it.each([
    ["processed"],
    ["expired"],
    ["canceled"],
    ["failed"],
    ["created"],
    ["processing"],
  ] as const)(
    "una orden en %s no vuelve a moverse al consultarse",
    (estado) => {
      const final = orden(estado);

      expect(mpOrderMachine.transition(final, "query")).toBe(final);
    },
  );

  it("no muta la orden que recibe", () => {
    const original = orden("action_required");
    const copia = structuredClone(original);

    mpOrderMachine.transition(original, "query");

    expect(original).toEqual(copia);
    expect(original.status).toBe("action_required");
    expect(urlDeLaOrden(original)).toBeDefined();
  });
});