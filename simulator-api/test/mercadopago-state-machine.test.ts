import {
  MercadoPagoOrderResponse,
  MercadoPagoPaymentResponse,
} from "../src/gateways/mercadopago/types";
import { mpOrderMachine, mpPaymentMachine } from "../src/state/mercadopagoStateMachine";

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
  it.each([["approved"], ["rejected"], ["cancelled"]] as const)(
    "un pago en %s no vuelve a moverse al consultarse",
    (estado) => {
      // El criterio 1 del issue: un pago creado como declinado se consulta como declinado.
      // Si estos tres tuvieran transición, la consulta los movería a aprobado y volvería
      // el defecto que el issue reporta.
      const final = pago(estado);

      expect(mpPaymentMachine.transition(final, "query")).toBe(final);
      expect(mpPaymentMachine.canTransition(final, "query")).toBe(false);
    },
  );

  it.each([["pending"], ["in_process"]] as const)(
    "un pago en %s se acredita al consultarlo",
    (estado) => {
      const consultado = mpPaymentMachine.transition(pago(estado), "query");

      expect(consultado.status).toBe("approved");
      expect(mpPaymentMachine.canTransition(pago(estado), "query")).toBe(true);
    },
  );

  it("conserva el monto y la referencia al acreditarse", () => {
    // El criterio 1 del issue en su forma más dura: la respuesta tiene que conservar lo que
    // se creó, no solo el estado. Cambiar solo el estado perdería monto y referencia.
    const acreditado = mpPaymentMachine.transition(pago("pending"), "query");

    expect(acreditado.transaction_amount).toBe(35000);
    expect(acreditado.external_reference).toBe("ORD-MP-4242");
    expect(acreditado.payer.email).toBe("comprador@example.com");
    expect(acreditado.id).toBe("9876543210");
  });

  it("no muta el pago que recibe", () => {
    const original = pago("pending");
    const copia = structuredClone(original);

    mpPaymentMachine.transition(original, "query");

    expect(original).toEqual(copia);
    expect(original.status).toBe("pending");
  });
});

describe("Tabla de órdenes de Mercado Pago", () => {
  it("una orden action_required pasa a processed al consultarla", () => {
    // La orden nace esperando al pagador en el banco; la consulta dice que ya volvió.
    const consultada = mpOrderMachine.transition(orden("action_required"), "query");

    expect(consultada.status).toBe("processed");
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

  it.each([["processed"], ["canceled"], ["failed"], ["created"]] as const)(
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