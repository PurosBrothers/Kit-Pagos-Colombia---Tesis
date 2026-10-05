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

function pago(estado: RapydPayment["status"], id = "payment_18b7e4c2a9f14d3e8c5a6b2f7d0e9134"): RapydPayment {
  return {
    id,
    status: estado,
    paid: estado === "CLO",
    amount: 35.0,
    currency_code: "COP",
    merchant_reference_id: "ORD-RAPYD-1",
    receipt_email: "comprador@example.com",
    failure_code: "",
    failure_message: "",
    created_at: 1789000000,
  };
}

describe("Tabla de transiciones del checkout de Rapyd", () => {
  it("un checkout nuevo no avanza solo por consultarse", () => {
    // La medición que sostiene el diseño: contra el sandbox un checkout no visitado se
    // queda en NEW indefinidamente. Si `query` lo moviera, el simulador estaría inventando
    // un pago que nadie hizo.
    const pendiente = checkout();

    expect(rapydCheckoutMachine.transition(pendiente, "query")).toBe(pendiente);
    expect(rapydCheckoutMachine.canTransition(pendiente, "query")).toBe(false);
  });

  it("nace NEW y DON es el estado de un checkout pagado", () => {
    // Las transiciones declaradas son las que el vocabulario de Rapyd permite.
    const pagado = rapydCheckoutMachine.transition(checkout(), "pay");

    expect(pagado.status).toBe("DON");
  });

  it("el pago devuelve a cobrar al pagar la página", () => {
    const pagado = rapydCheckoutMachine.transition(checkout(), "pay");

    expect(pagado.payment.id).toMatch(/^payment_[0-9a-f]{32}$/);
    expect(pagado.payment.status).toBe("CLO");
    expect(pagado.payment.paid).toBe(true);
  });

  it("da a cada pago un id distinto", () => {
    // Si el id fuera fijo, dos checkouts pagados devolverían el mismo pago y el SDK
    // compararía pagos que en realidad son diferentes.
    const primero = rapydCheckoutMachine.transition(checkout("checkout_01A"), "pay");
    const segundo = rapydCheckoutMachine.transition(checkout("checkout_01B"), "pay");

    expect(primero.payment.id).not.toBe(segundo.payment.id);
  });

  it("no paga dos veces el mismo checkout", () => {
    const pagado = rapydCheckoutMachine.transition(checkout(), "pay");
    const otroIntento = rapydCheckoutMachine.transition(pagado, "pay");

    // Es el criterio 7 del issue: un doble pago tiene que ser un no-op, no un segundo
    // cobro. La identidad se conserva para que el router ni siquiera guarde.
    expect(otroIntento).toBe(pagado);
    expect(otroIntento.payment.id).toBe(pagado.payment.id);
  });

  it("conserva el monto y la referencia del checkout creado", () => {
    const pagado = rapydCheckoutMachine.transition(checkout(), "pay");

    expect(pagado.payment.amount).toBe("35.00");
    expect(pagado.payment.merchant_reference_id).toBe("ORD-RAPYD-1");
    expect(pagado.payment.receipt_email).toBe("comprador@example.com");
  });

  it("no muta el checkout que recibe", () => {
    const original = checkout();
    const copia = structuredClone(original);

    rapydCheckoutMachine.transition(original, "pay");

    expect(original).toEqual(copia);
    expect(original.payment.id).toBeNull();
  });

  describe("con un desenlace registrado", () => {
    beforeEach(() => {
      resetSimulatorState();
    });

    afterEach(() => {
      resetSimulatorState();
    });

    it("con ERR registrado, la visita termina el checkout con el pago declinado", () => {
      // El checkout termina igual (`DON`: la página se usó); lo que cambia es el pago que
      // nace. Lleva el `failure_code` de un rechazo de tarjeta para que el SDK lo
      // normalice DECLINED y no ERROR.
      rememberScenarioTarget("rapyd", "checkout", "checkout_01ABCDEF0123456789AB", "ERR");

      const visitado = rapydCheckoutMachine.transition(checkout(), "pay");

      expect(visitado.status).toBe("DON");
      expect(visitado.payment.id).toMatch(/^payment_[0-9a-f]{32}$/);
      expect(visitado.payment.status).toBe("ERR");
      expect(visitado.payment.paid).toBe(false);
      expect(visitado.payment.failure_code).toBe(RAPYD_CARD_DECLINE.failure_code);
      expect(visitado.payment.failure_message).toBe(RAPYD_CARD_DECLINE.failure_message);
    });

    it("sin desenlace registrado, el pago que nace no trae failure_code", () => {
      const pagado = rapydCheckoutMachine.transition(checkout(), "pay");

      expect(pagado.payment.failure_code).toBeUndefined();
    });

    it("falla si el destino registrado no está declarado en la tabla", () => {
      // `ACT` es un estado de pago de Rapyd, pero no un desenlace de la visita.
      rememberScenarioTarget("rapyd", "checkout", "checkout_01ABCDEF0123456789AB", "ACT");

      expect(() => rapydCheckoutMachine.transition(checkout(), "pay")).toThrow(
        "'ACT' registrado para rapyd/checkout no está declarado",
      );
    });
  });
});

describe("Tabla de transiciones del pago de Rapyd", () => {
  it("cierra el pago pendiente al consultarlo", () => {
    const cerrado = rapydPaymentMachine.transition(pago("ACT"), "query");

    expect(cerrado.status).toBe("CLO");
    expect(cerrado.paid).toBe(true);
  });

  it("un pago pendiente sí puede moverse con una consulta", () => {
    expect(rapydPaymentMachine.canTransition(pago("ACT"), "query")).toBe(true);
  });

  it("no cobra un pago pendiente con una petición que no es una consulta", () => {
    // Transición no permitida: la tabla del pago no tiene reglas de `pay`.
    const pendiente = pago("ACT");

    expect(rapydPaymentMachine.transition(pendiente, "pay")).toBe(pendiente);
  });

  it.each([["CLO"], ["ERR"], ["EXP"], ["REV"]] as const)(
    "un pago en %s no vuelve a moverse al consultarse",
    (estado) => {
      // El criterio 1 del issue, en su versión más dura: un pago creado como declined se
      // consulta como declined. Si el estado final tuviera transición de entrada, la
      // consulta lo movería a aprobado y volvería el defecto que el issue reporta.
      const final = pago(estado);

      expect(rapydPaymentMachine.transition(final, "query")).toBe(final);
      expect(rapydPaymentMachine.canTransition(final, "query")).toBe(false);
    },
  );

  it("devuelve el monto real del pago consultado, no cero", () => {
    // El comportamiento viejo respondía `amount: "0"` con la referencia vacía: el SDK
    // recibía un pago que no era el que había creado. Este es el defecto central.
    const cerrado = rapydPaymentMachine.transition(pago("ACT"), "query");

    expect(cerrado.amount).toBe(35.0);
    expect(cerrado.merchant_reference_id).toBe("ORD-RAPYD-1");
    expect(cerrado.receipt_email).toBe("comprador@example.com");
  });

  it("conserva el id consultado", () => {
    const id = "payment_abcdef0123456789abcdef0123456789";
    const cerrado = rapydPaymentMachine.transition(pago("ACT", id), "query");

    // El id tiene que ser el que se pidió, no uno nuevo: es lo que hace que la consulta
    // responda del mismo pago que se creó.
    expect(cerrado.id).toBe(id);
  });

  it("no muta el pago que recibe", () => {
    const original = pago("ACT");
    const copia = structuredClone(original);

    rapydPaymentMachine.transition(original, "query");

    expect(original).toEqual(copia);
    expect(original.status).toBe("ACT");
    expect(original.paid).toBe(false);
  });

  describe("con un desenlace registrado", () => {
    beforeEach(() => {
      resetSimulatorState();
    });

    afterEach(() => {
      resetSimulatorState();
    });

    it("con ACT registrado, el PSE pendiente se queda pendiente aunque se consulte dos veces", () => {
      const pendiente = pago("ACT");
      rememberScenarioTarget("rapyd", "payment", pendiente.id, "ACT");

      for (const _ of [1, 2]) {
        const consultado = rapydPaymentMachine.transition(pendiente, "query");

        expect(consultado).toBe(pendiente);
        expect(consultado.paid).toBe(false);
      }
    });

    it("falla si el destino registrado no está declarado en la tabla", () => {
      // `ERR` y `EXP` son estados de Rapyd, pero sin una medición de cómo llega un PSE a
      // ellos la tabla no los declara como destino de la consulta.
      const pendiente = pago("ACT");
      rememberScenarioTarget("rapyd", "payment", pendiente.id, "EXP");

      expect(() => rapydPaymentMachine.transition(pendiente, "query")).toThrow(
        "'EXP' registrado para rapyd/payment no está declarado",
      );
    });
  });
});