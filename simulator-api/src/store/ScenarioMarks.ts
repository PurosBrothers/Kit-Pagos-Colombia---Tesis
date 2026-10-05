/**
 * Marcas auxiliares de los escenarios del simulador, fuera del almacén de
 * transacciones (issue #124).
 *
 * Antes vivían en el mismo `Map<string, unknown>` que las transacciones, con un prefijo
 * de texto —`dup_*`, `flapping_*`— como única diferencia entre las dos cosas. La razón de
 * separarlas no es que las claves pudieran chocar —un identificador nativo con prefijo
 * `flapping_` es algo que ninguna pasarela emite— sino que **el tipo del almacén era
 * `unknown`**: cada lectura terminaba en una conversión forzada que el compilador no podía
 * verificar, y un cobro y un contador de reintentos compartían un tipo que no describe
 * ninguno de los dos. Un almacén por pasarela con su tipo propio elimina esa conversión.
 *
 * Lo que vive acá **no es estado de máquina**: no es un cobro, no lo consulta el SDK y no
 * aparece en ninguna respuesta. Es contabilidad interna del simulador sobre cuántas
 * veces se pidió un comportamiento, y por eso se separa del registro que las máquinas de
 * estados van a leer y escribir.
 */
const duplicateMarks = new Set<string>();

const flappingAttempts = new Map<string, number>();

/** ¿Ya se pidió crear un cobro con esta misma clave de negocio? */
export function hasDuplicateMark(key: string): boolean {
  return duplicateMarks.has(key);
}

/** Registra que esta clave de negocio ya tuvo un cobro, para que el reintento dé 409. */
export function markDuplicate(key: string): void {
  duplicateMarks.add(key);
}

/** Borra todas las marcas de pago duplicado. */
export function clearDuplicateMarks(): void {
  duplicateMarks.clear();
}

/**
 * Contabiliza un intento de una falla técnica que se recupera sola, y dice si hay que
 * seguir fallando.
 *
 * `FLAPPING` es una falla que se autorecobra: las primeras peticiones fallan y a partir
 * de la enésima la pasarela contesta bien, que es lo que hace que el `RetryHandler` del
 * SDK termine teniendo éxito. Por eso el estado que importa es un contador, y por eso
 * vive acá y no en el almacén de transacciones.
 *
 * @param key               Identificador de la petición que está fallando.
 * @param requiredAttempts  Cuántos intentos deben fallar antes de dejar pasar.
 * @returns `true` si hay que responder con la falla, `false` si ya se recuperó.
 */
export function nextFlappingAttempt(key: string, requiredAttempts = 2): boolean {
  const current = flappingAttempts.get(key) ?? 0;

  if (current < requiredAttempts) {
    flappingAttempts.set(key, current + 1);
    return true;
  }

  flappingAttempts.set(key, 0);
  return false;
}

/** Borra todos los contadores de falla autorecuperable. */
export function clearFlappingAttempts(): void {
  flappingAttempts.clear();
}

/** Borra todas las marcas auxiliares de los escenarios. */
export function clearScenarioMarks(): void {
  clearDuplicateMarks();
  clearFlappingAttempts();
}