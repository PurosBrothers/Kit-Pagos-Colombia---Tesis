/**
 * Almacén en memoria de los registros del simulador (issue #55, genérico en #124).
 *
 * Responsabilidad única: guardar los registros creados, indexados por su identificador
 * nativo, y recuperarlos por ese mismo identificador.
 *
 * Implementado con un `Map` de Node.js porque el simulador es una herramienta de pruebas,
 * no un sistema de producción. **No agregar persistencia** (base de datos, archivo, Redis)
 * a esta clase: el estado efímero es intencional y deseable; reiniciar el simulador limpia
 * el almacén, que es el comportamiento correcto en un entorno de pruebas.
 *
 * ## Por qué es genérico
 *
 * Antes el valor guardado era `unknown` y cada lectura terminaba en una conversión forzada
 * —`findById(id) as WompiTransaction | undefined`— que el compilador no podía verificar.
 * Un almacén de transacciones de Wompi al que además se le pase una orden de Mercado Pago
 * es un error de tipos, y el `as` era la única barrera contra eso: exactamente el tipo de
 * barrera que no existe.
 *
 * Con el tipo como parámetro, la barrera la pone el compilador. Si el almacén de pagos de
 * Mercado Pago se usa donde se espera el de órdenes, el código no compila.
 *
 * Los almacenes concretos viven en `GatewayStores.ts`, uno por pasarela y recurso. Este
 * archivo solo define la clase.
 */
export class TransactionStore<TRecord> {
  private readonly store = new Map<string, TRecord>();

  /**
   * Guarda un registro en el almacén, indexado por su identificador nativo.
   *
   * Si ya existía un registro con ese identificador, se sobrescribe.
   *
   * @param id     Identificador nativo (por ejemplo, el UUID que genera Wompi).
   * @param record Registro en su forma nativa de pasarela.
   */
  save(id: string, record: TRecord): void {
    this.store.set(id, record);
  }

  /**
   * Recupera un registro por su identificador nativo.
   *
   * @param id  Identificador nativo.
   * @returns   El registro guardado, o `undefined` si no existe.
   */
  findById(id: string): TRecord | undefined {
    return this.store.get(id);
  }

  /**
   * Elimina todos los registros del almacén.
   * Útil en ganchos `afterEach` / `beforeEach` de las pruebas, para garantizar aislamiento.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Devuelve cuántos registros hay guardados ahora mismo.
   * Útil para aserciones en las pruebas.
   */
  size(): number {
    return this.store.size;
  }
}