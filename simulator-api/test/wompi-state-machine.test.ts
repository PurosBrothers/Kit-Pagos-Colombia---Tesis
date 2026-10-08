import { WompiPaymentMethod, WompiTransaction } from "../src/gateways/wompi/types";
import { rememberScenarioTarget } from "../src/state/scenarioTarget";
import { wompiStateMachine } from "../src/state/wompiStateMachine";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * Pruebas de la tabla de transiciones de Wompi (issue #124, criterio 4).
 *
 * Son pruebas de la **tabla**, no del router: se llama a la máquina directamente con un
 * registro y se verifica el estado que sale. Ninguna petición HTTP, ningún store. Eso es
 * lo que hace posible cubrir las transiciones no permitidas, que por HTTP solo se podrían
 * alcanzar montando un escenario entero.
 */

function card(id = "wompi-1"): WompiTransaction {
  return {
    id,
    status: "PENDING",
    amount_in_cents: 3500000,
    currency: "COP",
    reference: "ORD-WOMPI-1",
    customer_email: "comprador@example.com",
    payment_method: { type: "CARD", extra: { installments: 1 } },
  };
}

function pse(id = "wompi-2", bankCode = "1"): WompiTransaction {
  return {
    id,
    status: "PENDING",
    amount_in_cents: 3500000,
    currency: "COP",
    reference: "ORD-WOMPI-PSE",
    customer_email: "comprador@example.com",
    payment_method: {
      type: "PSE",
      financial_institution_code: bankCode,
      extra: { is_three_ds: false, three_ds_auth_type: null },
    },
  };
}

const bankUrl = (transaction: WompiTransaction): string | undefined =>
  (transaction.payment_method as WompiPaymentMethod | undefined)?.extra
    ?.async_payment_url as string | undefined;

describe("Wompi transition table", () => {
  describe("the card charge", () => {
    it("is born PENDING and resolves on the first query", () => {
      // Medido contra el sandbox el 19 de septiembre de 2026: con tarjeta, Wompi
      // responde 201 PENDING y pasa solo a APPROVED unos 600 ms después. La tabla
      // reproduce que el comercial tiene que consultar para ver el desenlace.
      const queryResponse = wompiStateMachine.transition(card(), "query");

      expect(queryResponse.status).toBe("APPROVED");
    });

    it("does not move again on a second query", () => {
      const first = wompiStateMachine.transition(card(), "query");
      const second = wompiStateMachine.transition(first, "query");

      expect(second).toBe(first);
    });

    it("keeps the amount, the reference and the email of the created charge", () => {
      // El criterio 6 exige que la consulta devuelva referencia y monto. Este es el
      // defecto que el issue reporta: la consulta no devolvía lo que se creó.
      const queryResponse = wompiStateMachine.transition(card(), "query");

      expect(queryResponse.amount_in_cents).toBe(3500000);
      expect(queryResponse.reference).toBe("ORD-WOMPI-1");
      expect(queryResponse.customer_email).toBe("comprador@example.com");
    });

    it("leaves an already voided charge intact", () => {
      const voided: WompiTransaction = { ...card(), status: "VOIDED" };

      // Transición no permitida: VOIDED no tiene salida en la tabla.
      expect(wompiStateMachine.transition(voided, "query")).toBe(voided);
    });

    it("leaves a declined charge intact", () => {
      const declined: WompiTransaction = { ...card(), status: "DECLINED" };

      expect(wompiStateMachine.transition(declined, "query")).toBe(declined);
    });
  });

  describe("the PSE flow", () => {
    it("the first query publishes the bank URL and stays pending", () => {
      // Los desenlaces de los bancos 1 y 2 son nivel 1 (punto 43 del architecture-log),
      // pero el sandbox publica la URL en la misma consulta en que resuelve, así que esta
      // ventana no se puede observar allí. Separarlas es una decisión del simulador.
      const first = wompiStateMachine.transition(pse(), "query");

      expect(first.status).toBe("PENDING");
      expect(bankUrl(first)).toContain("pse/redirect");
    });

    it("the published URL carries the charge identifier", () => {
      const first = wompiStateMachine.transition(pse("wompi-77"), "query");

      // Sin guiones, como la URL medida el 6 de octubre de 2026 (`docs/testing-data/wompi.md`).
      expect(bankUrl(first)).toContain("ticket_id=wompi77");
    });

    it("does not publish the URL twice", () => {
      const first = wompiStateMachine.transition(pse(), "query");
      const second = wompiStateMachine.transition(first, "query");

      // La segunda consulta resuelve en vez de volver a publicar la URL. Es la prueba de
      // que las dos transiciones desde PENDING se distinguen.
      expect(second.status).toBe("APPROVED");
    });

    it("the bank decides when the scenario does not ask for something else", () => {
      // Regla de precedencia, que hay que dejar escrita porque no es obvia: el código de
      // banco que manda el comercio en la creación decide el desenlace. El escenario fija el
      // estado **inicial** —un `DECLINED` nace DECLINED y no llega aquí— pero no pisa el
      // banco cuando lo que se pidió fue el flujo aprobado. Así un banco que declina
      // declina, que es lo que haría el banco de verdad.
      const pending = wompiStateMachine.transition(pse("", "2"), "query");

      expect(wompiStateMachine.transition(pending, "query").status).toBe("DECLINED");
    });

    it("resolves to APPROVED with the bank that approves", () => {
      const pending = wompiStateMachine.transition(pse("", "1"), "query");

      expect(wompiStateMachine.transition(pending, "query").status).toBe("APPROVED");
    });

    it("resolves to DECLINED with the bank that declines", () => {
      const pending = wompiStateMachine.transition(pse("", "2"), "query");

      expect(wompiStateMachine.transition(pending, "query").status).toBe("DECLINED");
    });

    it("resolves to ERROR with the bank that fails", () => {
      const pending = wompiStateMachine.transition(pse("", "3"), "query");

      // Medido contra el sandbox el 5 de octubre de 2026: termina ERROR con este mensaje.
      const resolved = wompiStateMachine.transition(pending, "query");

      expect(resolved.status).toBe("ERROR");
      expect(resolved.status_message).toBe("Transacción con ERROR en Sandbox");
      expect(wompiStateMachine.transition(resolved, "query")).toBe(resolved);
    });

    it("does not set status_message on the outcomes that do not have it measured", () => {
      const approved = wompiStateMachine.transition(
        wompiStateMachine.transition(pse("", "1"), "query"),
        "query",
      );

      expect(approved.status_message).toBeUndefined();
    });

    it("closes a PSE from the declining bank on the first query, with the URL published", () => {
      // Medido el 6 de octubre de 2026 (`docs/testing-data/wompi.md`, sección 3): ninguna
      // consulta mostró `PENDING` con la URL, y el rechazo llegó junto con ella. Antes esta
      // prueba exigía `PENDING` en la primera consulta, que era la suposición contraria.
      const first = wompiStateMachine.transition(pse("", "2"), "query");

      expect(first.status).toBe("DECLINED");
      expect(bankUrl(first)).toContain("pse/redirect");
      expect(first.status_message).toBe("Transacción RECHAZADA en Sandbox");
    });

    it("does not advance a PSE with a request that is not a query", () => {
      const pending = pse();

      // Transición no permitida: la tabla de Wompi no tiene ninguna regla de `pay`.
      expect(wompiStateMachine.transition(pending, "pay")).toBe(pending);
    });

    it("reports that a query can move a pending PSE", () => {
      expect(wompiStateMachine.canTransition(pse(), "query")).toBe(true);
      expect(wompiStateMachine.canTransition({ ...pse(), status: "APPROVED" }, "query")).toBe(
        false,
      );
    });
  });

  describe("the target registered by the scenario", () => {
    beforeEach(() => {
      resetSimulatorState();
    });

    afterEach(() => {
      resetSimulatorState();
    });

    it("a card with PENDING registered does not resolve, even if it is queried twice", () => {
      // El criterio 1 del issue aplicado al pendiente. El destino es el estado de origen,
      // así que la tabla devuelve la misma transacción y la ruta no guarda nada.
      rememberScenarioTarget("wompi", "transaction", "wompi-1", "PENDING");
      const pending = card();

      for (const _ of [1, 2]) {
        expect(wompiStateMachine.transition(pending, "query")).toBe(pending);
      }
    });

    it("a PSE with PENDING registered publishes the URL and then does not resolve", () => {
      // La publicación de la URL no depende del destino: el pagador tiene adónde ir. Lo que
      // no ocurre es el regreso del banco.
      rememberScenarioTarget("wompi", "transaction", "wompi-2", "PENDING");

      const first = wompiStateMachine.transition(pse(), "query");
      const second = wompiStateMachine.transition(first, "query");

      expect(bankUrl(first)).toContain("pse/redirect");
      expect(second).toBe(first);
      expect(second.status).toBe("PENDING");
    });

    it("fails if the registered target is not declared in the table", () => {
      // `APPROVED` es un estado de Wompi, pero no un destino que la creación registre.
      rememberScenarioTarget("wompi", "transaction", "wompi-1", "APPROVED");

      expect(() => wompiStateMachine.transition(card(), "query")).toThrow(
        "'APPROVED' registrado para wompi/transaction no está declarado",
      );
    });
  });

  describe("the record invariants", () => {
    it("never mutates the record it receives", () => {
      const original = card();
      const copy = structuredClone(original);

      wompiStateMachine.transition(original, "query");

      expect(original).toEqual(copy);
      expect(original.status).toBe("PENDING");
    });

    it("does not lose the payment method fields when publishing the URL", () => {
      // El `extra` de Wompi trae `is_three_ds` y `three_ds_auth_type` además de la URL.
      // Agregar la URL no puede replacear el resto.
      const pending = wompiStateMachine.transition(pse(), "query");
      const extra = (pending.payment_method as WompiPaymentMethod).extra;

      expect(extra?.is_three_ds).toBe(false);
      expect(extra?.async_payment_url).toBeDefined();
    });

    it("returns the same object when the query changes nothing", () => {
      // Que la identidad se conserve es lo que permite al router guardar solo cuando
      // hubo un cambio real, en lugar de escribir en el store en cada consulta.
      const voided: WompiTransaction = { ...card(), status: "VOIDED" };

      expect(wompiStateMachine.transition(voided, "query")).toBe(voided);
    });
  });
});