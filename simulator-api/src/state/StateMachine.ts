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

/** Un cambio de estado que una máquina acaba de aplicar. */
export interface StatusChange {
  /** El nombre de la máquina, por ejemplo `wompi.transaction`. */
  machine: string;
  from: string;
  to: string;
  /** El registro ya movido, con todos sus campos. */
  record: unknown;
}

export type StatusChangeListener = (change: StatusChange) => void;

const listeners = new Set<StatusChangeListener>();

/**
 * Escucha los cambios de estado de todas las máquinas (issue #122, paso 7).
 *
 * Existe para la emisión automática de webhooks, que es opcional y está apagada por omisión.
 * La máquina sigue sin saber de HTTP: avisa y sigue. Un oyente que lanza no rompe la
 * transición, porque la respuesta de la pasarela no puede depender de que el aviso salga bien.
 *
 * @returns La función que deja de escuchar.
 */
export function onStatusChange(listener: StatusChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(change: StatusChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch {
      // El aviso es secundario: el oyente registra sus propias fallas.
    }
  }
}

export interface TransitionOptions {
  /**
   * `false` para mover sin avisar. Lo usa el trigger de webhooks, que envía su propio
   * webhook y no debe provocar además el automático.
   */
  notify?: boolean;
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
   * @param name        Cómo se identifica en `onStatusChange`: `<pasarela>.<recurso>`.
   *
   * @throws Error si la tabla tiene dos transiciones indistinguibles para el mismo
   *   par `(estado, petición)`. Ver `assertUnambiguousTable()`.
   */
  constructor(
    transitions: readonly Transition<TStatus, TRecord>[],
    private readonly adapter: StateMachineAdapter<TRecord, TStatus>,
    readonly name = "unnamed",
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
  transition(record: TRecord, on: Trigger, options: TransitionOptions = {}): TRecord {
    const current = this.adapter.statusOf(record);
    const applicable = findTransition(this.transitions, record, current, on);

    if (applicable === undefined) {
      return record;
    }

    const next = resolveTarget(applicable, record);
    const moved = next === current ? record : this.adapter.withStatus(record, next);
    const result = applicable.apply !== undefined ? applicable.apply(moved, next) : moved;

    // Solo un cambio de estado avisa: publicar la URL del banco sin salir de `PENDING` no es
    // un evento que una pasarela notifique.
    if (next !== current && options.notify !== false) {
      notify({ machine: this.name, from: current, to: next, record: result });
    }

    return result;
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