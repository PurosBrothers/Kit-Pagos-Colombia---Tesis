/**
 * El desenlace que deriva de los datos de una tarjeta de prueba, por token (issue #122).
 *
 * En el sandbox real el desenlace de un cobro con tarjeta lo deciden los datos de la
 * tarjeta: el número en Wompi, el nombre del titular en Mercado Pago. Esos datos viajan en
 * la tokenización y el cobro llega después con solo el token, así que el simulador tiene que
 * recordar qué decidieron.
 *
 * **Se guarda el desenlace derivado, nunca el número de la tarjeta ni el nombre.** El token
 * existe precisamente para que el número no viva en ningún servidor del comercio (puntos 77 y
 * 78), y un simulador que lo guardara enseñaría lo contrario. El tipo lo hace explícito: no
 * hay campo donde poner el dato original.
 */
export interface CardTokenOutcome {
  /** El escenario que se aplica al cobrar con este token. */
  scenario: string;
  /** El `status_detail` nativo, solo en las pasarelas que distinguen varios rechazos. */
  statusDetail?: string;
}

const outcomes = new Map<string, CardTokenOutcome>();

function keyFor(gateway: string, token: string): string {
  return `${gateway}:${token}`;
}

/** Registra el desenlace que deriva de la tarjeta tokenizada. */
export function rememberCardTokenOutcome(
  gateway: string,
  token: string,
  outcome: CardTokenOutcome,
): void {
  outcomes.set(keyFor(gateway, token), outcome);
}

/** El desenlace registrado para el token, o `undefined` si la tarjeta no está en la tabla. */
export function cardTokenOutcomeFor(gateway: string, token: unknown): CardTokenOutcome | undefined {
  return typeof token === "string" ? outcomes.get(keyFor(gateway, token)) : undefined;
}

/** Borra los desenlaces registrados. Lo llama `resetSimulatorState()`. */
export function clearCardTokenOutcomes(): void {
  outcomes.clear();
}
