import {
  assertUnambiguousTable,
  findTransition,
  resolveTarget,
  Transition,
  Trigger,
} from "./Transition";

/**
 * Funciones que una pasarela tiene que aportar para que su tabla sea declarativa.
 *
 * Se pasan por parámetro y no se heredan de una clase base porque cada pasarela
 * almacena el estado en un campo distinto: Wompi en `status`, Rapyd en
 * `status` del pago o del checkout, Mercado Pago en `status` de la orden. Una clase
 * abstracta obligaría a las cuatro a declarar un método vacío o a renombrar su campo.
 *
 * @typeParam TRecord Forma del registro que guarda la pasarela.
 * @typeParam TStatus Vocabulario nativo de estados de esa pasarela.
 */
export interface StateMachineAdapter<TRecord, TStatus extends string> {
  /** Lee el estado actual del registro. */
  statusOf: (record: TRecord) => TStatus;

  /** Devuelve una copia del registro con el estado nuevo. */
  withStatus: (record: TRecord, status: TStatus) => TRecord;
}

/**
 * La máquina de estados de una pasarela (issue #124).
 *
 * Responde a una sola pregunta: **dada una petición del cliente, ¿qué estado tiene
 * este cobro ahora?** Todo lo demás —persistir, serializar, aplicar el escenario de
 * creación— es de la ruta o de la fábrica, porque esta clase no sabe de HTTP.
 *
 * ## Por qué el resultado es un registro y no un estado
 *
 * Porque la respuesta nativa de cada pasarela tiene que conservar los campos que ya
 * traía el cobro. Consultar un pago de Rapyd tiene que devolver el monto y la
 * referencia que se crearon, y cambiar solo el estado perdería los dos. El
 * registro va y vuelve completo.
 *
 * ## Por qué no hay eventos de creación ni de duplicado
 *
 * Porque ninguno de los dos mueve un estado existente: crear nace, y el pago
 * duplicado se rechaza antes de existir un registro. `Trigger` los deja afuera a
 * propósito.
 *
 * ## Qué pasa con una transición que no está en la tabla
 *
 * Se devuelve el registro tal cual. No es un error ni un caso raro: es lo que
 * significa un cobro ya en estado final, que no vuelve a moverse, y lo que hace que
 * consultar dos veces una transacción aprobada sea idempotente.
 *
 * @typeParam TRecord Forma del registro que guarda la pasarela.
 * @typeParam TStatus Vocabulario nativo de estados de esa pasarela.
 */
export class StateMachine<TRecord, TStatus extends string> {
  private readonly transitions: readonly Transition<TStatus, TRecord>[];

  /**
   * @param transitions La tabla de transiciones de la pasarela.
   * @param adapter     Cómo se lee y se escribe el estado del registro.
   *
   * @throws Error si la tabla tiene dos transiciones indistinguibles para el mismo
   *   par `(estado, petición)`. Ver `assertUnambiguousTable()`.
   */
  constructor(
    transitions: readonly Transition<TStatus, TRecord>[],
    private readonly adapter: StateMachineAdapter<TRecord, TStatus>,
  ) {
    assertUnambiguousTable(transitions);
    this.transitions = transitions;
  }

  /**
   * Aplica la transición que dispara `on` sobre `record`.
   *
   * ## `apply` no tiene que volver a poner el estado
   *
   * A `apply` se le pasa el registro **con el estado nuevo ya puesto**, no el original.
   * Es lo que hace que una transición con `to` y con `apply` no pueda perder el estado por
   * descuido: si `apply` recibiera el original y una tabla escribiera `{ ...checkout,
   * payment: ... }`, el checkout volvería al estado anterior y la transición quedaría a
   * medias. Pasarle el registro ya actualizado deja `apply` con una sola tarea, la de
   * tocar los campos que el estado no describe —una URL que publicar, un identificador
   * que asignar— y no la de repetir el destino.
   *
   * @returns El registro nuevo, o el mismo registro si la petición no mueve el estado.
   */
  transition(record: TRecord, on: Trigger): TRecord {
    const current = this.adapter.statusOf(record);
    const applicable = findTransition(this.transitions, record, current, on);

    if (applicable === undefined) {
      return record;
    }

    const next = resolveTarget(applicable, record);
    const moved = next === current ? record : this.adapter.withStatus(record, next);

    return applicable.apply !== undefined ? applicable.apply(moved, next) : moved;
  }

  /**
   * ¿Hay alguna transición aplicable para esta petición?
   *
   * La usan las rutas para decidir si una transición no permitida tiene que
   * contestarse con el error nativo de la pasarela o queda sin efecto, que es el
   * paso 3 del issue #124.
   */
  canTransition(record: TRecord, on: Trigger): boolean {
    return (
      findTransition(
        this.transitions,
        record,
        this.adapter.statusOf(record),
        on,
      ) !== undefined
    );
  }

  /** El estado actual del registro. */
  statusOf(record: TRecord): TStatus {
    return this.adapter.statusOf(record);
  }
}