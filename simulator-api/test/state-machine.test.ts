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

describe("StateMachine — la base que usan las cuatro pasarelas", () => {
  describe("una transición aplicable", () => {
    it("lleva el registro al estado de destino", () => {
      const machine = new StateMachine(simpleTable, adapter);

      expect(machine.transition(pending("t1"), "query")).toEqual({
        id: "t1",
        status: "APPROVED",
        amount: 100,
      });
    });

    it("conserva los campos que no son estado", () => {
      const machine = new StateMachine(simpleTable, adapter);
      const conUrl: FakeRecord = {
        id: "t1",
        status: "PENDING",
        amount: 1250,
        redirectUrl: "https://banco.example/pagar",
      };

      const resuelto = machine.transition(conUrl, "query");

      // El monto es lo que el criterio de aceptación 6 exige devolver: el problema
      // que este issue arregla es que la consulta perdía el monto del cobro creado.
      expect(resuelto.amount).toBe(1250);
      expect(resuelto.redirectUrl).toBe("https://banco.example/pagar");
    });

    it("no modifica el registro original", () => {
      const machine = new StateMachine(simpleTable, adapter);
      const original = pending("t1");

      machine.transition(original, "query");

      expect(original.status).toBe("PENDING");
    });
  });

  describe("una transición no permitida", () => {
    it("devuelve el registro intacto cuando la petición no aplica", () => {
      const machine = new StateMachine(simpleTable, adapter);
      const aprobado: FakeRecord = {
        id: "t1",
        status: "APPROVED",
        amount: 100,
      };

      // Consultar dos veces un cobro ya resuelto tiene que ser idempotente: el
      // criterio 1 exige que el estado se consulte igual después de crearlo.
      expect(machine.transition(aprobado, "query")).toBe(aprobado);
    });

    it("deja intacto un cobro cuyo estado final no tiene salida", () => {
      const machine = new StateMachine(
        [{ from: ["PENDING"], on: "query", to: "VOIDED" }],
        adapter,
      );
      const anulado: FakeRecord = { id: "t1", status: "VOIDED", amount: 100 };

      expect(machine.transition(anulado, "query")).toBe(anulado);
    });

    it("deja intacto un cobro cuando la petición es de otro tipo", () => {
      const machine = new StateMachine(simpleTable, adapter);
      const record = pending("t1");

      // La tabla no tiene ninguna transición de `pay`, que es lo que pasa hoy con las
      // cuatro pasarelas salvo Rapyd.
      expect(machine.transition(record, "pay")).toBe(record);
    });

    it("informa que no hay transición disponible", () => {
      const machine = new StateMachine(simpleTable, adapter);

      expect(machine.canTransition(pending("t1"), "query")).toBe(true);
      expect(
        machine.canTransition({ id: "t1", status: "APPROVED", amount: 1 }, "query"),
      ).toBe(false);
      expect(machine.canTransition(pending("t1"), "pay")).toBe(false);
    });
  });

  describe("el predicado `when`, que es lo que permite el PSE de Wompi", () => {
    it("la primera consulta publica la URL y sigue pendiente", () => {
      const machine = new StateMachine(pseTable, adapter);
      const primera = machine.transition(pending("t1"), "query");

      expect(primera.status).toBe("PENDING");
      expect(primera.redirectUrl).toBe("https://banco.example/pagar");
    });

    it("la segunda consulta resuelve", () => {
      const machine = new StateMachine(pseTable, adapter);
      const segunda = machine.transition(
        { ...pending("t1"), redirectUrl: "https://banco.example/pagar" },
        "query",
      );

      expect(segunda.status).toBe("APPROVED");
    });

    it("ejecuta el `apply` aunque el estado destino sea el mismo", () => {
      const machine = new StateMachine(pseTable, adapter);

      // Este es el caso que hace necesario el hook: la transición no cambia el estado,
      // pero sí agrega un campo. Un atajo que evitara escribir cuando el estado es
      // igual perdería la URL del banco.
      expect(machine.transition(pending("t1"), "query").redirectUrl).toBeDefined();
    });

    it("entrega a `apply` el registro con el estado nuevo ya puesto", () => {
      const vistoPorApply: FakeRecord[] = [];
      const tablaConApply: Transition<Status, FakeRecord>[] = [
        {
          from: ["PENDING"],
          on: "query",
          to: "APPROVED",
          apply: (record) => {
            vistoPorApply.push(record);
            return { ...record, extra: "dato" };
          },
        },
      ];

      const resultado = new StateMachine(tablaConApply, adapter).transition(
        pending("t1"),
        "query",
      );

      // El contrato importa: si `apply` recibiera el registro original, una tabla que
      // escribiera `{ ...record, otroCampo }` —que es lo natural— devolvería el cobro al
      // estado anterior y la transición quedaría a medias, sin error ni aviso. Por eso
      // `apply` ve el estado ya aplicado.
      expect(vistoPorApply[0].status).toBe("APPROVED");
      expect(resultado.status).toBe("APPROVED");
      expect(resultado.extra).toBe("dato");
    });

    it("pasa a `apply` el estado destino, para el caso dinámico", () => {
      const destinos: Status[] = [];
      const tablaDinamica: Transition<Status, FakeRecord>[] = [
        {
          from: ["PENDING"],
          on: "query",
          to: (record) => (record.id.endsWith("1") ? "APPROVED" : "DECLINED"),
          apply: (record, destino) => {
            destinos.push(destino);
            return { ...record, extra: String(destino) };
          },
        },
      ];
      const machine = new StateMachine(tablaDinamica, adapter);

      expect(machine.transition(pending("t1"), "query").status).toBe("APPROVED");
      expect(machine.transition(pending("t2"), "query").status).toBe("DECLINED");
      expect(destinos).toEqual<Status[]>(["APPROVED", "DECLINED"]);
    });
  });

  describe("la validación de la tabla", () => {
    it("acepta dos transiciones distintas desde el mismo estado", () => {
      expect(() => assertUnambiguousTable(pseTable)).not.toThrow();
    });

    it("rechaza dos transiciones sin predicado para el mismo par", () => {
      const ambigua: Transition<Status, FakeRecord>[] = [
        { from: ["PENDING"], on: "query", to: "APPROVED" },
        { from: ["PENDING"], on: "query", to: "DECLINED" },
      ];

      // Sin este chequeo, cuál de las dos se aplica dependería del orden en que
      // quedaron escritas, que es el tipo de defecto invisible que el issue elimina.
      expect(() => assertUnambiguousTable(ambigua)).toThrow(
        /dos transiciones sin predicado/,
      );
    });

    it("rechaza la tabla ambigua al construir la máquina", () => {
      const ambigua: Transition<Status, FakeRecord>[] = [
        { from: ["PENDING"], on: "query", to: "APPROVED" },
        { from: ["PENDING"], on: "query", to: "DECLINED" },
      ];

      expect(() => new StateMachine(ambigua, adapter)).toThrow(/ambiguas/);
    });

    it("permite que dos transiciones compartan estado si una trae predicado", () => {
      const distinguidas: Transition<Status, FakeRecord>[] = [
        {
          from: ["PENDING"],
          on: "query",
          to: "APPROVED",
          when: (record) => record.amount > 0,
        },
        { from: ["PENDING"], on: "query", to: "DECLINED" },
      ];

      expect(() => assertUnambiguousTable(distinguidas)).not.toThrow();
    });

    it("no confunde dos estados distintos con el mismo par", () => {
      const valida: Transition<Status, FakeRecord>[] = [
        { from: ["PENDING"], on: "query", to: "APPROVED" },
        { from: ["VOIDED"], on: "query", to: "DECLINED" },
      ];

      expect(() => assertUnambiguousTable(valida)).not.toThrow();
    });

    it("no confunde dos peticiones distintas desde el mismo estado", () => {
      const valida: Transition<Status, FakeRecord>[] = [
        { from: ["PENDING"], on: "query", to: "APPROVED" },
        { from: ["PENDING"], on: "pay", to: "DECLINED" },
      ];

      expect(() => assertUnambiguousTable(valida)).not.toThrow();
    });
  });
});