/**
 * El desenlace que pidió el escenario de creación, pendiente de aplicarse.
 *
 * ## Por qué hace falta esto
 *
 * Porque hay dos clases de cobro y solo una puede resolver su desenlace en la creación.
 *
 * Un pago **sincrónico** nace ya resuelto: la pasarela lo aprueba o lo rechaza antes de
 * responder, así que el escenario se aplica en la propia respuesta y no hace falta
 * recordar nada. Es la tarjeta de Mercado Pago y de Kushki: `POST /payments` con
 * `DECLINED` devuelve `rejected` y el cobro ya está en su estado final.
 *
 * Un cobro **asíncrono** nace pendiente y el desenlace ocurre después: cuando el pagador
 * vuelve del banco (los PSE), cuando llena la página de pago (la tarjeta de Rapyd) o cuando
 * la pasarela termina de procesar (la tarjeta de Wompi, que nace `PENDING`). La creación
 * no puede responder el desenlace, así que **la creación lo registra y la transición lo
 * aplica**.
 *
 * ## Por qué no va dentro del registro
 *
 * Porque el registro es la respuesta nativa de la pasarela. Agregarle un campo propio del
 * simulador sería mandar en la respuesta algo que la pasarela real no manda, que es
 * exactamente el defecto que este issue viene corrigiendo en las cuatro pasarelas —el
 * `transaction_status` en la raíz de Kushki, el `status` en el `init` de una
 * transferencia, el `next_action` de una orden de Mercado Pago. Este módulo está al lado
 * del registro, no dentro.
 *
 * ## No es el almacén de transacciones
 *
 * Un `Map<string, string>` con una clave por pasarela y recurso, porque los estados no se
 * pueden compartir entre pasarelas: `approvedTransaction` de Kushki y `approved` de
 * Mercado Pago son el mismo desenlace y textos distintos, y confundirlos produciría un
 * estado que ninguna pasarela emite.
 *
 * Lo limpia `resetSimulatorState()` junto con los almacenes y las marcas de escenarios,
 * porque es la misma clase de cosa: estado del simulador que existe entre peticiones y que
 * una prueba no debe heredar de otra.
 */
const targets = new Map<string, string>();

/** La clave con la que se guarda y se busca el desenlace de un cobro. */
function keyFor(gateway: string, resource: string, id: string): string {
  return `${gateway}:${resource}:${id}`;
}

/**
 * Registra el estado en el que un cobro asíncrono debe terminar.
 *
 * Lo llama la ruta de creación, con el escenario ya traducido al vocabulario de la
 * pasarela. La ruta decide qué se pidió; la tabla decide qué destinos existen, y por eso
 * `scenarioTargetFor` solo devuelve un estado que la tabla haya declarado.
 *
 * @param gateway  `wompi`, `rapyd`, `mercadopago` o `kushki`.
 * @param resource Qué clase de cobro es, para no mezclar vocabularios.
 * @param id       Identificador nativo del cobro.
 * @param status   Estado final, en el vocabulario de esa pasarela.
 */
export function rememberScenarioTarget(
  gateway: string,
  resource: string,
  id: string,
  status: string,
): void {
  targets.set(keyFor(gateway, resource, id), status);
}

/**
 * El desenlace registrado para este cobro, o `undefined` si no hubo escenario.
 *
 * Lo consultan las tablas desde su `to` dinámico. `undefined` significa "usa el destino
 * por defecto", que es el caso normal: sin cabecera de escenario el simulador se comporta
 * como la pasarela medida, sin intervención.
 *
 * Recibe la lista de destinos que declara la tabla, y el tipo del resultado sale de esa
 * lista. Antes cada tabla convertía la cadena con `as`, que el compilador no revisa: un
 * estado mal escrito en la ruta se volvía estado del cobro.
 *
 * @throws Error si el destino registrado no está en la lista. No se cae al destino por
 *   defecto porque el defecto suele ser el aprobado, y un escenario mal traducido que
 *   termina en un cobro aprobado es el error que este módulo existe para evitar.
 */
export function scenarioTargetFor<TStatus extends string>(
  declaredTargets: readonly TStatus[],
  gateway: string,
  resource: string,
  id: string,
): TStatus | undefined {
  const registered = targets.get(keyFor(gateway, resource, id));

  if (registered === undefined) {
    return undefined;
  }

  const declared = declaredTargets.find((target) => target === registered);

  if (declared === undefined) {
    throw new Error(
      `El destino '${registered}' registrado para ${gateway}/${resource} no está ` +
        `declarado en la tabla. Destinos declarados: ${declaredTargets.join(", ")}.`,
    );
  }

  return declared;
}

/**
 * Borra los desenlaces pendientes.
 *
 * Sin esto, un cobro que una prueba dejó a medio camino dejaría su desenlace registrado y
 * la prueba siguiente que reutilizara el mismo identificador —Kushki emite tokens de 32
 * hexadecimales y las pruebas los hardcodean— heredaría un estado que nadie pidió.
 */
export function clearScenarioTargets(): void {
  targets.clear();
}