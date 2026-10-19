/**
 * La tabla de transiciones: los datos de una máquina de estados (issue #124).
 *
 * Una transición es un dato, no una función. Esa es la decisión que hace posible el
 * criterio de aceptación 4 —"pruebas unitarias de su tabla de transiciones"—: una
 * tabla se lee y se verifica, un `if` anidado hay que reconstruirlo mentalmente para
 * probarlo.
 *
 * ## Por qué una transición lleva un predicado `when`
 *
 * Porque el estado nativo no alcanza para describir el ciclo de vida real. Wompi con
 * PSE es el caso que obliga a esto: una transacción PSE pasa por `PENDING` durante
 * dos consultas, y en las dos el estado nativo es el mismo.
 *
 * - La **primera** consulta todavía no resuelve. Publica la URL del banco en
 *   `payment_method.extra.async_payment_url` y sigue en `PENDING`.
 * - La **segunda** consulta resuelve, y ahí el estado pasa a `APPROVED`.
 *
 * Si la tabla se indexara solo por estado, las dos transiciones serían
 * `(PENDING, query) → …` y una taparía a la otra: el orden en que se declararan
 * pasaría a decidir el comportamiento, que es exactamente la clase de detalle
 * invisible que este issue viene a eliminar.
 *
 * El predicado `when` dice qué mira la transición **sobre el registro**, que es donde
 * vive el dato que distingue los dos pasos: si la URL del banco ya fue publicada.
 */

/**
 * Qué petición del cliente dispara una transición.
 *
 * Solo van las peticiones que el comercio o el pagador le hacen a la pasarela, y solo
 * las que **cambian el estado** de un cobro:
 *
 * - `query`: el comercio consultó el estado.
 * - `pay`: el pagador completó el pago. En el simulador se representa con la
 *   página de pago, que es el destino real de `redirect_url` en Rapyd.
 *
 * `create` no está, y es deliberado: crear no es una transición *desde* un estado, es
 * el nacimiento del registro. Qué estado inicial se elige lo decide la pasarela a
 * partir del escenario de la petición (paso 5 del issue #124), no la tabla.
 *
 * `duplicate` tampoco, y por la misma razón: la detección de pago duplicado ocurre
 * antes de que exista un registro, así que no hay estado al que mover.
 */
export type Trigger = "query" | "pay";

/**
 * Una transición: de qué estados sale, qué petición la dispara y a cuál llega.
 *
 * @typeParam TStatus Vocabulario nativo de la pasarela.
 * @typeParam TRecord Forma del registro que se transiciona.
 */
export interface Transition<TStatus extends string, TRecord = unknown> {
  /** Estados desde los que esta transición es aplicable. */
  readonly from: readonly TStatus[];

  /** Petición del cliente que la dispara. */
  readonly on: Trigger;

  /**
   * Estado al que lleva. Puede ser igual al de origen: Wompi PSE lo hace, y también
   * toda transición cuyo destino registrado es el pendiente del que sale.
   *
   * Puede ser una función cuando el destino lo decide un dato de la transacción o el
   * destino que registró la creación (`scenarioTargetFor()`). Wompi con PSE es el primer
   * caso: el estado final sale del código de banco —`1` aprueba y `2` declina (punto 43
   * del architecture-log), y `3` termina en `ERROR` (medido el 5 de octubre de 2026)—. Escribir
   * `to: "APPROVED"` y resolver `DECLINED` por otro lado sería una regla que miente
   * sobre sí misma.
   */
  readonly to: TStatus | ((record: TRecord) => TStatus);

  /**
   * Condición sobre el registro, para cuando el estado nativo no distingue dos pasos
   * distintos. Ausente significa "siempre que el estado sea uno de `from`".
   */
  readonly when?: (record: TRecord) => boolean;

  /**
   * Cómo se construye el registro nuevo, cuando cambiar el estado no basta.
   *
   * Recibe el registro **con el estado destino ya aplicado**, más el destino por si
   * hace falta. Cuando el destino es igual al origen recibe el registro original, y
   * devolverlo tal cual es lo que le dice a la ruta que no hay nada que guardar. En la
   * mayoría de las transiciones sobra —cambiar el estado es todo lo que hace falta— y
   * se omite.
   *
   * Existe para lo que el estado no describe, y hay cuatro casos en las cuatro tablas:
   * publicar la URL del banco en el PSE de Wompi; asignar el identificador y el desenlace
   * del pago que nace cuando se paga la página de Rapyd; poner `paid: true` junto con
   * `CLO` en un pago de Rapyd, para que un pago cerrado no se confunda con uno cobrado; y
   * quitar la redirección y poner el `status_detail` de una orden de Mercado Pago que sale
   * de `action_required`. Son cosas que el vocabulario de estados no puede expresar, y sin
   * el hook habría que escribirlas dentro del router, que es donde no se pueden probar
   * solas.
   */
  readonly apply?: (record: TRecord, to: TStatus) => TRecord;
}

/**
 * Busca la primera transición aplicable a esta petición.
 *
 * Devuelve `undefined` cuando no hay ninguna, que es la respuesta que significa "no
 * pasa nada": un cobro ya en estado final no vuelve a moverse, y una consulta sobre
 * un cobro de tarjeta no avanza el paso de una transacción PSE.
 *
 * La primera que coincide gana. Por eso dos transiciones sin predicado no pueden
 * compartir el mismo par `(estado, petición)`: sería el orden de declaración decidiendo
 * el comportamiento. `assertUnambiguousTable()` lo impide.
 *
 * Con predicado, el orden sí decide. Si dos `when` del mismo par son verdaderos a la vez,
 * gana la que se declaró primero y nada lo advierte. La tabla de Wompi tiene tres
 * transiciones `(PENDING, query)` con predicado, y que no se solapen depende de cómo
 * están escritos sus `when`, no de esta función.
 */
export function findTransition<TStatus extends string, TRecord>(
  transitions: readonly Transition<TStatus, TRecord>[],
  record: TRecord,
  status: TStatus,
  on: Trigger,
): Transition<TStatus, TRecord> | undefined {
  return transitions.find(
    (transition) =>
      transition.from.includes(status) &&
      transition.on === on &&
      (transition.when === undefined || transition.when(record)),
  );
}

/**
 * El estado al que lleva la transición, resolviendo `to` si es una función.
 *
 * Se resuelve aquí y no en el motor porque `assertUnambiguousTable()` solo necesita
 * mirar el par `(estado, petición)`, y el destino resuelto es lo que se escribe en el
 * registro.
 */
export function resolveTarget<TStatus extends string, TRecord>(
  transition: Transition<TStatus, TRecord>,
  record: TRecord,
): TStatus {
  return typeof transition.to === "function" ? transition.to(record) : transition.to;
}

/**
 * Verifica que dos transiciones sin predicado no compitan por el mismo par
 * `(estado, petición)`.
 *
 * Sin predicado no hay forma de distinguirlas, así que el orden de declaración
 * decidiría cuál se aplica. Es un error de la tabla, no del registro, y por eso se
 * detecta al construir la máquina en vez de aparecer como un comportamiento raro en una
 * prueba de integración.
 *
 * **Ignora las transiciones con `when`.** Saber si dos predicados se solapan exigiría
 * evaluarlos sobre todos los registros posibles, y esta función no tiene registros. Una
 * tabla con predicados que se solapan pasa la verificación y se resuelve por orden de
 * declaración (ver `findTransition()`); las pruebas de cada tabla son las que lo cubren.
 *
 * @throws Error si dos transiciones sin predicado son indistinguibles.
 */
export function assertUnambiguousTable<TStatus extends string, TRecord>(
  transitions: readonly Transition<TStatus, TRecord>[],
): void {
  const seen = new Set<string>();

  for (const transition of transitions) {
    if (transition.when !== undefined) {
      continue;
    }

    for (const from of transition.from) {
      const key = `${from}+${transition.on}`;

      if (seen.has(key)) {
        throw new Error(
          `Transiciones ambiguas para '${from}' con la petición '${transition.on}': ` +
            `dos transiciones sin predicado para el mismo par. Agregar 'when' a una ` +
            `de las dos para que se distinguan.`,
        );
      }

      seen.add(key);
    }
  }
}