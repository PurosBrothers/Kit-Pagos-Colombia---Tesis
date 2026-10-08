import { StateMachine } from "../src/state/StateMachine";
import {
  assertUnambiguousTable,
  Transition,
} from "../src/state/Transition";

/**
 * Pruebas de la base de las máquinas de estados (issue #124).
 *
 * El vocabulario es inventado a propósito. La tabla de cada pasarela se prueba en su
 * propio archivo —`wompi.test.ts`, `rapyd.test.ts`— y lo que se verifica aquí es que la
 * base cumple lo que las cuatro necesitan, no que alguna pasarela particular se
 * comporte bien.
 */

type Status = "PENDING" | "APPROVED" | "DECLINED" | "VOIDED";

interface FakeRecord {
  id: string;
  status: Status;
  amount: number;
  /** Presente cuando la pasarela ya publicó la URL de redirección. */
  redirectUrl?: string;
  /** Un campo cualquiera, para probar que `apply` escribe lo que quiere. */
  extra?: string;
}

const adapter = {
  statusOf: (record: FakeRecord): Status => record.status,
  withStatus: (record: FakeRecord, status: Status): FakeRecord => ({
    ...record,
    status,
  }),
};

const pending = (id: string): FakeRecord => ({ id, status: "PENDING", amount: 100 });

/** Tabla mínima: PENDING se resuelve en APPROVED con una consulta. */
const simpleTable: Transition<Status, FakeRecord>[] = [
  { from: ["PENDING"], on: "query", to: "APPROVED" },
];

/**
 * Las dos transiciones del PSE de Wompi. Se distinguen por un dato del registro —si la
 * URL del banco ya fue publicada— porque el estado nativo es `PENDING` en las dos
 * consultas. Sin este predicado la tabla no podría expresar el ciclo.
 */
const pseTable: Transition<Status, FakeRecord>[] = [
  {
    from: ["PENDING"],
    on: "query",
    to: "PENDING",
    when: (record) => record.redirectUrl === undefined,
    apply: (record) => ({
      ...record,
      redirectUrl: "https://banco.example/pagar",
    }),
  },
  {
    from: ["PENDING"],
    on: "query",
    to: "APPROVED",
    when: (record) => record.redirectUrl !== undefined,
  },
];

describe("StateMachine — the base the four gateways use", () => {
  describe("an applicable transition", () => {
    it("takes the record to the target status", () => {
      const machine = new StateMachine(simpleTable, adapter);

      expect(machine.transition(pending("t1"), "query")).toEqual({
        id: "t1",
        status: "APPROVED",
        amount: 100,
      });
    });

    it("keeps the fields that are not status", () => {
      const machine = new StateMachine(simpleTable, adapter);
      const withUrl: FakeRecord = {
        id: "t1",
        status: "PENDING",
        amount: 1250,
        redirectUrl: "https://banco.example/pagar",
      };

      const resolved = machine.transition(withUrl, "query");

      // El monto es lo que el criterio de aceptación 6 exige devolver: el problema
      // que este issue arregla es que la consulta perdía el monto del cobro creado.
      expect(resolved.amount).toBe(1250);
      expect(resolved.redirectUrl).toBe("https://banco.example/pagar");
    });

    it("does not modify the original record", () => {
      const machine = new StateMachine(simpleTable, adapter);
      const original = pending("t1");

      machine.transition(original, "query");

      expect(original.status).toBe("PENDING");
    });
  });

  describe("a transition that is not allowed", () => {
    it("returns the record intact when the request does not apply", () => {
      const machine = new StateMachine(simpleTable, adapter);
      const approved: FakeRecord = {
        id: "t1",
        status: "APPROVED",
        amount: 100,
      };

      // Consultar dos veces un cobro ya resuelto tiene que ser idempotente: el
      // criterio 1 exige que el estado se consulte igual después de crearlo.
      expect(machine.transition(approved, "query")).toBe(approved);
    });

    it("leaves intact a charge whose final status has no way out", () => {
      const machine = new StateMachine(
        [{ from: ["PENDING"], on: "query", to: "VOIDED" }],
        adapter,
      );
      const voided: FakeRecord = { id: "t1", status: "VOIDED", amount: 100 };

      expect(machine.transition(voided, "query")).toBe(voided);
    });

    it("leaves a charge intact when the request is of another kind", () => {
      const machine = new StateMachine(simpleTable, adapter);
      const record = pending("t1");

      // La tabla no tiene ninguna transición de `pay`, que es lo que pasa hoy con las
      // cuatro pasarelas salvo Rapyd.
      expect(machine.transition(record, "pay")).toBe(record);
    });

    it("reports that no transition is available", () => {
      const machine = new StateMachine(simpleTable, adapter);

      expect(machine.canTransition(pending("t1"), "query")).toBe(true);
      expect(
        machine.canTransition({ id: "t1", status: "APPROVED", amount: 1 }, "query"),
      ).toBe(false);
      expect(machine.canTransition(pending("t1"), "pay")).toBe(false);
    });
  });

  describe("the `when` predicate, which is what makes the Wompi PSE possible", () => {
    it("the first query publishes the URL and stays pending", () => {
      const machine = new StateMachine(pseTable, adapter);
      const first = machine.transition(pending("t1"), "query");

      expect(first.status).toBe("PENDING");
      expect(first.redirectUrl).toBe("https://banco.example/pagar");
    });

    it("the second query resolves", () => {
      const machine = new StateMachine(pseTable, adapter);
      const second = machine.transition(
        { ...pending("t1"), redirectUrl: "https://banco.example/pagar" },
        "query",
      );

      expect(second.status).toBe("APPROVED");
    });

    it("runs `apply` even if the target status is the same", () => {
      const machine = new StateMachine(pseTable, adapter);

      // Este es el caso que hace necesario el hook: la transición no cambia el estado,
      // pero sí agrega un campo. Un atajo que evitara escribir cuando el estado es
      // igual perdería la URL del banco.
      expect(machine.transition(pending("t1"), "query").redirectUrl).toBeDefined();
    });

    it("hands `apply` the record with the new status already set", () => {
      const seenByApply: FakeRecord[] = [];
      const tableWithApply: Transition<Status, FakeRecord>[] = [
        {
          from: ["PENDING"],
          on: "query",
          to: "APPROVED",
          apply: (record) => {
            seenByApply.push(record);
            return { ...record, extra: "dato" };
          },
        },
      ];

      const result = new StateMachine(tableWithApply, adapter).transition(
        pending("t1"),
        "query",
      );

      // El contrato importa: si `apply` recibiera el registro original, una tabla que
      // escribiera `{ ...record, otroCampo }` —que es lo natural— devolvería el cobro al
      // estado anterior y la transición quedaría a medias, sin error ni aviso. Por eso
      // `apply` ve el estado ya aplicado.
      expect(seenByApply[0].status).toBe("APPROVED");
      expect(result.status).toBe("APPROVED");
      expect(result.extra).toBe("dato");
    });

    it("passes the target status to `apply`, for the dynamic case", () => {
      const targets: Status[] = [];
      const dynamicTable: Transition<Status, FakeRecord>[] = [
        {
          from: ["PENDING"],
          on: "query",
          to: (record) => (record.id.endsWith("1") ? "APPROVED" : "DECLINED"),
          apply: (record, target) => {
            targets.push(target);
            return { ...record, extra: String(target) };
          },
        },
      ];
      const machine = new StateMachine(dynamicTable, adapter);

      expect(machine.transition(pending("t1"), "query").status).toBe("APPROVED");
      expect(machine.transition(pending("t2"), "query").status).toBe("DECLINED");
      expect(targets).toEqual<Status[]>(["APPROVED", "DECLINED"]);
    });
  });

  describe("the table validation", () => {
    it("accepts two different transitions from the same status", () => {
      expect(() => assertUnambiguousTable(pseTable)).not.toThrow();
    });

    it("rejects two transitions without a predicate for the same pair", () => {
      const ambiguous: Transition<Status, FakeRecord>[] = [
        { from: ["PENDING"], on: "query", to: "APPROVED" },
        { from: ["PENDING"], on: "query", to: "DECLINED" },
      ];

      // Sin este chequeo, cuál de las dos se aplica dependería del orden en que
      // quedaron escritas, que es el tipo de defecto invisible que el issue elimina.
      expect(() => assertUnambiguousTable(ambiguous)).toThrow(
        /dos transiciones sin predicado/,
      );
    });

    it("rejects the ambiguous table when building the machine", () => {
      const ambiguous: Transition<Status, FakeRecord>[] = [
        { from: ["PENDING"], on: "query", to: "APPROVED" },
        { from: ["PENDING"], on: "query", to: "DECLINED" },
      ];

      expect(() => new StateMachine(ambiguous, adapter)).toThrow(/ambiguas/);
    });

    it("allows two transitions to share a status if one has a predicate", () => {
      const distinct: Transition<Status, FakeRecord>[] = [
        {
          from: ["PENDING"],
          on: "query",
          to: "APPROVED",
          when: (record) => record.amount > 0,
        },
        { from: ["PENDING"], on: "query", to: "DECLINED" },
      ];

      expect(() => assertUnambiguousTable(distinct)).not.toThrow();
    });

    it("does not confuse two different statuses with the same pair", () => {
      const valid: Transition<Status, FakeRecord>[] = [
        { from: ["PENDING"], on: "query", to: "APPROVED" },
        { from: ["VOIDED"], on: "query", to: "DECLINED" },
      ];

      expect(() => assertUnambiguousTable(valid)).not.toThrow();
    });

    it("does not confuse two different requests from the same status", () => {
      const valid: Transition<Status, FakeRecord>[] = [
        { from: ["PENDING"], on: "query", to: "APPROVED" },
        { from: ["PENDING"], on: "pay", to: "DECLINED" },
      ];

      expect(() => assertUnambiguousTable(valid)).not.toThrow();
    });
  });
});