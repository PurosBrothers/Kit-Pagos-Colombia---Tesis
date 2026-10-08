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
 * Desde el issue #122 guarda también las fallas pedidas para la consulta de un cobro, que
 * son de la misma clase: no aparecen en ninguna respuesta y no son estado del cobro.
 *
 * Lo que vive aquí **no es estado de máquina**: no es un cobro, no lo consulta el SDK y no
 * aparece en ninguna respuesta. Es contabilidad interna del simulador sobre cuántas
 * veces se pidió un comportamiento, y por eso se separa del registro que las máquinas de
 * estados van a leer y escribir.
 */
import type { QueryFailure } from "../scenarios/scenarioFromRequest";

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
 * vive aquí y no en el almacén de transacciones.
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

/**
 * Las fallas que la creación pidió para la consulta posterior (issue #122), por cobro.
 *
 * La clave es pasarela, recurso e identificador nativo, igual que en `scenarioTarget.ts`,
 * porque Kushki emite tokens de transferencia y tickets de tarjeta que no se distinguen por
 * el valor (punto 48).
 */
const queryFailures = new Map<string, QueryFailure>();

function queryKey(gateway: string, resource: string, id: string): string {
  return `${gateway}:${resource}:${id}`;
}

/** Registra que las consultas de este cobro deben fallar de esta manera. */
export function rememberQueryFailure(
  gateway: string,
  resource: string,
  id: string,
  failure: QueryFailure,
): void {
  queryFailures.set(queryKey(gateway, resource, id), failure);
}

/** La falla registrada para las consultas de este cobro, o `undefined`. */
export function queryFailureFor(
  gateway: string,
  resource: string,
  id: string,
): QueryFailure | undefined {
  return queryFailures.get(queryKey(gateway, resource, id));
}

/** Borra todas las marcas auxiliares de los escenarios. */
export function clearScenarioMarks(): void {
  clearDuplicateMarks();
  clearFlappingAttempts();
  queryFailures.clear();
}