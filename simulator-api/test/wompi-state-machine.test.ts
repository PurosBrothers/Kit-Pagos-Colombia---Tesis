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

function tarjeta(id = "wompi-1"): WompiTransaction {
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

function pse(id = "wompi-2", codigoBanco = "1"): WompiTransaction {
  return {
    id,
    status: "PENDING",
    amount_in_cents: 3500000,
    currency: "COP",
    reference: "ORD-WOMPI-PSE",
    customer_email: "comprador@example.com",
    payment_method: {
      type: "PSE",
      financial_institution_code: codigoBanco,
      extra: { is_three_ds: false, three_ds_auth_type: null },
    },
  };
}

const urlDelBanco = (transaction: WompiTransaction): string | undefined =>
  (transaction.payment_method as WompiPaymentMethod | undefined)?.extra
    ?.async_payment_url as string | undefined;

describe("Tabla de transiciones de Wompi", () => {
  describe("el cobro con tarjeta", () => {
    it("nace PENDING y resuelve en la primera consulta", () => {
      // Medido contra el sandbox el 19 de septiembre de 2026: con tarjeta, Wompi
      // responde 201 PENDING y pasa solo a APPROVED unos 600 ms después. La tabla
      // reproduce que el comercial tiene que consultar para ver el desenlace.
      const consulta = wompiStateMachine.transition(tarjeta(), "query");

      expect(consulta.status).toBe("APPROVED");
    });

    it("no vuelve a moverse en una segunda consulta", () => {
      const primera = wompiStateMachine.transition(tarjeta(), "query");
      const segunda = wompiStateMachine.transition(primera, "query");

      expect(segunda).toBe(primera);
    });

    it("conserva el monto, la referencia y el correo del cobro creado", () => {
      // El criterio 6 exige que la consulta devuelva referencia y monto. Este es el
      // defecto que el issue reporta: la consulta no devolvía lo que se creó.
      const consulta = wompiStateMachine.transition(tarjeta(), "query");

      expect(consulta.amount_in_cents).toBe(3500000);
      expect(consulta.reference).toBe("ORD-WOMPI-1");
      expect(consulta.customer_email).toBe("comprador@example.com");
    });

    it("deja intacto un cobro ya anulado", () => {
      const anulado: WompiTransaction = { ...tarjeta(), status: "VOIDED" };

      // Transición no permitida: VOIDED no tiene salida en la tabla.
      expect(wompiStateMachine.transition(anulado, "query")).toBe(anulado);
    });

    it("deja intacto un cobro declinado", () => {
      const declinado: WompiTransaction = { ...tarjeta(), status: "DECLINED" };

      expect(wompiStateMachine.transition(declinado, "query")).toBe(declinado);
    });
  });

  describe("el flujo de PSE", () => {
    it("la primera consulta publica la URL del banco y sigue pendiente", () => {
      // Los desenlaces de los bancos 1 y 2 son nivel 1 (punto 43 del architecture-log),
      // pero el sandbox publica la URL en la misma consulta en que resuelve, así que esta
      // ventana no se puede observar allí. Separarlas es una decisión del simulador.
      const primera = wompiStateMachine.transition(pse(), "query");

      expect(primera.status).toBe("PENDING");
      expect(urlDelBanco(primera)).toContain("pse/redirect");
    });

    it("la URL publicada lleva el identificador del cobro", () => {
      const primera = wompiStateMachine.transition(pse("wompi-77"), "query");

      expect(urlDelBanco(primera)).toContain("ticket_id=wompi-77");
    });

    it("no publica la URL dos veces", () => {
      const primera = wompiStateMachine.transition(pse(), "query");
      const segunda = wompiStateMachine.transition(primera, "query");

      // La segunda consulta resuelve en vez de volver a publicar la URL. Es la prueba de
      // que las dos transiciones desde PENDING se distinguen.
      expect(segunda.status).toBe("APPROVED");
    });

    it("el banco manda cuando el escenario no pide otra cosa", () => {
      // Regla de precedencia, que hay que dejar escrita porque no es obvia: el código de
      // banco que manda el comercio en la creación decide el desenlace. El escenario fija el
      // estado **inicial** —un `DECLINED` nace DECLINED y no llega aquí— pero no pisa el
      // banco cuando lo que se pidió fue el flujo aprobado. Así un banco que declina
      // declina, que es lo que haría el banco de verdad.
      const pendiente = wompiStateMachine.transition(pse("", "2"), "query");

      expect(wompiStateMachine.transition(pendiente, "query").status).toBe("DECLINED");
    });

    it("resuelve a APPROVED con el banco que aprueba", () => {
      const pendiente = wompiStateMachine.transition(pse("", "1"), "query");

      expect(wompiStateMachine.transition(pendiente, "query").status).toBe("APPROVED");
    });

    it("resuelve a DECLINED con el banco que declina", () => {
      const pendiente = wompiStateMachine.transition(pse("", "2"), "query");

      expect(wompiStateMachine.transition(pendiente, "query").status).toBe("DECLINED");
    });

    it("resuelve a ERROR con el banco que falla", () => {
      const pendiente = wompiStateMachine.transition(pse("", "3"), "query");

      // Medido contra el sandbox el 5 de octubre de 2026: termina ERROR con este mensaje.
      const resuelto = wompiStateMachine.transition(pendiente, "query");

      expect(resuelto.status).toBe("ERROR");
      expect(resuelto.status_message).toBe("Transacción con ERROR en Sandbox");
      expect(wompiStateMachine.transition(resuelto, "query")).toBe(resuelto);
    });

    it("no pone status_message en los desenlaces que no lo tienen medido", () => {
      const aprobado = wompiStateMachine.transition(
        wompiStateMachine.transition(pse("", "1"), "query"),
        "query",
      );

      expect(aprobado.status_message).toBeUndefined();
    });

    it("no resuelve un PSE en la primera consulta aunque el banco sea el que declina", () => {
      // El orden importa: publicar la URL y resolver son pasos separados, y una prueba
      // que solo viera el estado final no podría distinguir un PSE bien construído de uno
      // que se salto la redirección.
      const primera = wompiStateMachine.transition(pse("", "2"), "query");

      expect(primera.status).toBe("PENDING");
    });

    it("no avanza un PSE con una petición que no es una consulta", () => {
      const pendiente = pse();

      // Transición no permitida: la tabla de Wompi no tiene ninguna regla de `pay`.
      expect(wompiStateMachine.transition(pendiente, "pay")).toBe(pendiente);
    });

    it("informa que una consulta sí puede mover un PSE pendiente", () => {
      expect(wompiStateMachine.canTransition(pse(), "query")).toBe(true);
      expect(wompiStateMachine.canTransition({ ...pse(), status: "APPROVED" }, "query")).toBe(
        false,
      );
    });
  });

  describe("el destino registrado por el escenario", () => {
    beforeEach(() => {
      resetSimulatorState();
    });

    afterEach(() => {
      resetSimulatorState();
    });

    it("una tarjeta con PENDING registrado no resuelve, aunque se consulte dos veces", () => {
      // El criterio 1 del issue aplicado al pendiente. El destino es el estado de origen,
      // así que la tabla devuelve la misma transacción y la ruta no guarda nada.
      rememberScenarioTarget("wompi", "transaction", "wompi-1", "PENDING");
      const pendiente = tarjeta();

      for (const _ of [1, 2]) {
        expect(wompiStateMachine.transition(pendiente, "query")).toBe(pendiente);
      }
    });

    it("un PSE con PENDING registrado publica la URL y después no resuelve", () => {
      // La publicación de la URL no depende del destino: el pagador tiene adónde ir. Lo que
      // no ocurre es el regreso del banco.
      rememberScenarioTarget("wompi", "transaction", "wompi-2", "PENDING");

      const primera = wompiStateMachine.transition(pse(), "query");
      const segunda = wompiStateMachine.transition(primera, "query");

      expect(urlDelBanco(primera)).toContain("pse/redirect");
      expect(segunda).toBe(primera);
      expect(segunda.status).toBe("PENDING");
    });

    it("falla si el destino registrado no está declarado en la tabla", () => {
      // `APPROVED` es un estado de Wompi, pero no un destino que la creación registre.
      rememberScenarioTarget("wompi", "transaction", "wompi-1", "APPROVED");

      expect(() => wompiStateMachine.transition(tarjeta(), "query")).toThrow(
        "'APPROVED' registrado para wompi/transaction no está declarado",
      );
    });
  });

  describe("las invariantes del registro", () => {
    it("nunca muta el registro que recibe", () => {
      const original = tarjeta();
      const copia = structuredClone(original);

      wompiStateMachine.transition(original, "query");

      expect(original).toEqual(copia);
      expect(original.status).toBe("PENDING");
    });

    it("no pierde los campos del método de pago al publicar la URL", () => {
      // El `extra` de Wompi trae `is_three_ds` y `three_ds_auth_type` además de la URL.
      // Agregar la URL no puede replacear el resto.
      const pendiente = wompiStateMachine.transition(pse(), "query");
      const extra = (pendiente.payment_method as WompiPaymentMethod).extra;

      expect(extra?.is_three_ds).toBe(false);
      expect(extra?.async_payment_url).toBeDefined();
    });

    it("devuelve el mismo objeto cuando la consulta no cambia nada", () => {
      // Que la identidad se conserve es lo que permite al router guardar solo cuando
      // hubo un cambio real, en lugar de escribir en el store en cada consulta.
      const anulado: WompiTransaction = { ...tarjeta(), status: "VOIDED" };

      expect(wompiStateMachine.transition(anulado, "query")).toBe(anulado);
    });
  });
});