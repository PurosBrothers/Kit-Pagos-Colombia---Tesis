import { RAPYD_CARD_DECLINE } from "../src/gateways/rapyd/GatewayMockFactory";
import { RapydCheckout, RapydPayment } from "../src/gateways/rapyd/types";
import {
  rapydCheckoutMachine,
  rapydPaymentMachine,
} from "../src/state/rapydStateMachine";
import { rememberScenarioTarget } from "../src/state/scenarioTarget";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * Pruebas de las tablas de Rapyd (issue #124, criterio 4).
 *
 * Rapyd tiene **dos** recursos con ciclos distintos —el checkout, que nace `NEW` y pasa a
 * `DON`, y el pago, que nace `ACT` y se cierra— y por eso tiene dos tablas. Probarlas
 * separadas permite que la suite falle señalando cuál de las dos se rompió.
 *
 * Igual que en Wompi, no hay HTTP ni store aquí: la tabla se llama con un registro.
 */

function checkout(id = "checkout_01ABCDEF0123456789AB"): RapydCheckout {
  return {
    id,
    status: "NEW",
    redirect_url: `http://localhost:3000/v1/sim/rapyd/checkout/${id}/pagar`,
    payment: {
      id: null,
      status: null,
      /* Rapyd devuelve los montos como cadena, no como numero. */
      amount: "35.00",
      currency_code: "COP",
      merchant_reference_id: "ORD-RAPYD-1",
      receipt_email: "comprador@example.com",
    },
  };
}

function paymentWith(status: RapydPayment["status"], id = "payment_18b7e4c2a9f14d3e8c5a6b2f7d0e9134"): RapydPayment {
  return {
    id,
    status: status,
    paid: status === "CLO",
    amount: 35.0,
    currency_code: "COP",
    merchant_reference_id: "ORD-RAPYD-1",
    receipt_email: "comprador@example.com",
    failure_code: "",
    failure_message: "",
    created_at: 1789000000,
  };
}

describe("Rapyd checkout transition table", () => {
  it("a new checkout does not advance just by being queried", () => {
    // La medición que sostiene el diseño: contra el sandbox un checkout no visitado se
    // queda en NEW indefinidamente. Si `query` lo moviera, el simulador estaría inventando
    // un pago que nadie hizo.
    const pending = checkout();

    expect(rapydCheckoutMachine.transition(pending, "query")).toBe(pending);
    expect(rapydCheckoutMachine.canTransition(pending, "query")).toBe(false);
  });

  it("is born NEW and DON is the status of a paid checkout", () => {
    // Las transiciones declaradas son las que el vocabulario de Rapyd permite.
    const paidCheckout = rapydCheckoutMachine.transition(checkout(), "pay");

    expect(paidCheckout.status).toBe("DON");
  });

  it("paying the page yields a charged payment", () => {
    const paidCheckout = rapydCheckoutMachine.transition(checkout(), "pay");

    expect(paidCheckout.payment.id).toMatch(/^payment_[0-9a-f]{32}$/);
    expect(paidCheckout.payment.status).toBe("CLO");
    expect(paidCheckout.payment.paid).toBe(true);
  });

  it("gives each payment a different id", () => {
    // Si el id fuera fijo, dos checkouts pagados devolverían el mismo pago y el SDK
    // compararía pagos que en realidad son diferentes.
    const first = rapydCheckoutMachine.transition(checkout("checkout_01A"), "pay");
    const second = rapydCheckoutMachine.transition(checkout("checkout_01B"), "pay");

    expect(first.payment.id).not.toBe(second.payment.id);
  });

  it("does not pay the same checkout twice", () => {
    const paidCheckout = rapydCheckoutMachine.transition(checkout(), "pay");
    const otherAttempt = rapydCheckoutMachine.transition(paidCheckout, "pay");

    // Es el criterio 7 del issue: un doble pago tiene que ser un no-op, no un segundo
    // cobro. La identidad se conserva para que el router ni siquiera guarde.
    expect(otherAttempt).toBe(paidCheckout);
    expect(otherAttempt.payment.id).toBe(paidCheckout.payment.id);
  });

  it("keeps the amount and the reference of the created checkout", () => {
    const paidCheckout = rapydCheckoutMachine.transition(checkout(), "pay");

    expect(paidCheckout.payment.amount).toBe("35.00");
    expect(paidCheckout.payment.merchant_reference_id).toBe("ORD-RAPYD-1");
    expect(paidCheckout.payment.receipt_email).toBe("comprador@example.com");
  });

  it("does not mutate the checkout it receives", () => {
    const original = checkout();
    const copy = structuredClone(original);

    rapydCheckoutMachine.transition(original, "pay");

    expect(original).toEqual(copy);
    expect(original.payment.id).toBeNull();
  });

  describe("with a registered outcome", () => {
    beforeEach(() => {
      resetSimulatorState();
    });

    afterEach(() => {
      resetSimulatorState();
    });

    it("with ERR registered, the visit ends the checkout with the payment declined", () => {
      // El checkout termina igual (`DON`: la página se usó); lo que cambia es el pago que
      // nace. Lleva el `failure_code` de un rechazo de tarjeta para que el SDK lo
      // normalice DECLINED y no ERROR.
      rememberScenarioTarget("rapyd", "checkout", "checkout_01ABCDEF0123456789AB", "ERR");

      const visited = rapydCheckoutMachine.transition(checkout(), "pay");

      expect(visited.status).toBe("DON");
      expect(visited.payment.id).toMatch(/^payment_[0-9a-f]{32}$/);
      expect(visited.payment.status).toBe("ERR");
      expect(visited.payment.paid).toBe(false);
      expect(visited.payment.failure_code).toBe(RAPYD_CARD_DECLINE.failure_code);
      expect(visited.payment.failure_message).toBe(RAPYD_CARD_DECLINE.failure_message);
    });

    it("without a registered outcome, the payment that is born has no failure_code", () => {
      const paidCheckout = rapydCheckoutMachine.transition(checkout(), "pay");

      expect(paidCheckout.payment.failure_code).toBeUndefined();
    });

    it("fails if the registered target is not declared in the table", () => {
      // `ACT` es un estado de pago de Rapyd, pero no un desenlace de la visita.
      rememberScenarioTarget("rapyd", "checkout", "checkout_01ABCDEF0123456789AB", "ACT");

      expect(() => rapydCheckoutMachine.transition(checkout(), "pay")).toThrow(
        "'ACT' registrado para rapyd/checkout no está declarado",
      );
    });
  });
});

describe("Rapyd payment transition table", () => {
  it("closes the pending payment when queried", () => {
    const closed = rapydPaymentMachine.transition(paymentWith("ACT"), "query");

    expect(closed.status).toBe("CLO");
    expect(closed.paid).toBe(true);
  });

  it("a pending payment can move with a query", () => {
    expect(rapydPaymentMachine.canTransition(paymentWith("ACT"), "query")).toBe(true);
  });

  it("does not charge a pending payment with a request that is not a query", () => {
    // Transición no permitida: la tabla del pago no tiene reglas de `pay`.
    const pending = paymentWith("ACT");

    expect(rapydPaymentMachine.transition(pending, "pay")).toBe(pending);
  });

  it.each([["CLO"], ["ERR"], ["EXP"], ["REV"]] as const)(
    "a payment in %s does not move again when queried",
    (status) => {
      // El criterio 1 del issue, en su versión más dura: un pago creado como declined se
      // consulta como declined. Si el estado final tuviera transición de entrada, la
      // consulta lo movería a aprobado y volvería el defecto que el issue reporta.
      const final = paymentWith(status);

      expect(rapydPaymentMachine.transition(final, "query")).toBe(final);
      expect(rapydPaymentMachine.canTransition(final, "query")).toBe(false);
    },
  );

  it("returns the real amount of the queried payment, not zero", () => {
    // El comportamiento viejo respondía `amount: "0"` con la referencia vacía: el SDK
    // recibía un pago que no era el que había creado. Este es el defecto central.
    const closed = rapydPaymentMachine.transition(paymentWith("ACT"), "query");

    expect(closed.amount).toBe(35.0);
    expect(closed.merchant_reference_id).toBe("ORD-RAPYD-1");
    expect(closed.receipt_email).toBe("comprador@example.com");
  });

  it("keeps the queried id", () => {
    const id = "payment_abcdef0123456789abcdef0123456789";
    const closed = rapydPaymentMachine.transition(paymentWith("ACT", id), "query");

    // El id tiene que ser el que se pidió, no uno nuevo: es lo que hace que la consulta
    // responda del mismo pago que se creó.
    expect(closed.id).toBe(id);
  });

  it("does not mutate the payment it receives", () => {
    const original = paymentWith("ACT");
    const copy = structuredClone(original);

    rapydPaymentMachine.transition(original, "query");

    expect(original).toEqual(copy);
    expect(original.status).toBe("ACT");
    expect(original.paid).toBe(false);
  });

  describe("with a registered outcome", () => {
    beforeEach(() => {
      resetSimulatorState();
    });

    afterEach(() => {
      resetSimulatorState();
    });

    it("with ACT registered, the pending PSE stays pending even if it is queried twice", () => {
      const pending = paymentWith("ACT");
      rememberScenarioTarget("rapyd", "payment", pending.id, "ACT");

      for (const _ of [1, 2]) {
        const queried = rapydPaymentMachine.transition(pending, "query");

        expect(queried).toBe(pending);
        expect(queried.paid).toBe(false);
      }
    });

    it("fails if the registered target is not declared in the table", () => {
      // `ERR` y `EXP` son estados de Rapyd, pero sin una medición de cómo llega un PSE a
      // ellos la tabla no los declara como destino de la consulta.
      const pending = paymentWith("ACT");
      rememberScenarioTarget("rapyd", "payment", pending.id, "EXP");

      expect(() => rapydPaymentMachine.transition(pending, "query")).toThrow(
        "'EXP' registrado para rapyd/payment no está declarado",
      );
    });
  });
});