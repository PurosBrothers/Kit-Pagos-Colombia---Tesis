/**
 * El desenlace que pidió el escenario de creación, pendiente de aplicarse.
 *
 * ## Por qué hace falta esto
 *
 * Porque hay dos clases de cobro y solo una puede resolver su desenlace en la creación.
 *
 * Un pago **sincrónico** —una tarjeta— nace ya resuelto: la pasarela lo aprueba o lo
 * rechaza antes de responder, así que el escenario se aplica en la propia respuesta y no
 * hace falta recordar nada. `POST /payments` con `DECLINED` devuelve `ERR` y el cobro ya
 * está en su estado final.
 *
 * Un cobro **asíncrono** —un PSE— nace pendiente: la respuesta dice "ve a pagar al banco",
 * y el desenlace ocurre después, cuando el pagador vuelve. Para PSE no hay forma de que la
 * creación sepa si el banco aprobará. El escenario es lo único que puede decidirlo, así que
 * **la creación lo registra y la transición lo aplica**.
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
function clave(pasarela: string, recurso: string, id: string): string {
  return `${pasarela}:${recurso}:${id}`;
}

/**
 * Registra el estado en el que un cobro asíncrono debe terminar.
 *
 * Lo llama la ruta de creación, con el estado ya traducido al vocabulario de la pasarela:
 * quien decide el texto es la tabla, no la ruta.
 *
 * @param pasarela `wompi`, `rapyd`, `mercadopago` o `kushki`.
 * @param recurso  Qué clase de cobro es, para no mezclar vocabularios.
 * @param id       Identificador nativo del cobro.
 * @param estado   Estado final, en el vocabulario de esa pasarela.
 */
export function rememberScenarioTarget(
  pasarela: string,
  recurso: string,
  id: string,
  estado: string,
): void {
  targets.set(clave(pasarela, recurso, id), estado);
}

/**
 * El desenlace registrado para este cobro, o `undefined` si no hubo escenario.
 *
 * Lo consultan las tablas desde su `to` dinámico. `undefined` significa "usa el destino
 * por defecto", que es el caso normal: sin cabecera de escenario el simulador se comporta
 * como la pasarela measuring sin intervención.
 */
export function scenarioTargetFor(
  pasarela: string,
  recurso: string,
  id: string,
): string | undefined {
  return targets.get(clave(pasarela, recurso, id));
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