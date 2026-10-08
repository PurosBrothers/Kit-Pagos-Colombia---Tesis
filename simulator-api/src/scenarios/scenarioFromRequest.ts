import { FastifyRequest } from "fastify";
import { KushkiAmount } from "../gateways/kushki/types";

/** Cabeceras reconocidas para solicitar escenarios de simulación. */
export const SCENARIO_HEADERS = [
  "x-simulator-scenario",
  "x-simulate-scenario",
] as const;

/** Escenario por defecto cuando nada en la petición elige otro. */
export const DEFAULT_SCENARIO = "APPROVED";

/**
 * Una falla que la creación registra y que aplica después la consulta de estado.
 *
 * Existe porque la consulta es la operación que el SDK reintenta (`RetryHandler`) y la
 * creación no (punto 35): una falla técnica en el `POST` no puede mostrar un reintento.
 */
export type QueryFailure = "QUERY_FLAPPING" | "QUERY_SERVER_ERROR" | "QUERY_SLOW";

/**
 * Montos reservados para la creación, en pesos enteros (issue #122).
 *
 * Convención propia del simulador, sin equivalente en ninguna pasarela. Son pesos
 * enteros porque el PSE de Mercado Pago no admite centavos, y se eligieron alrededor de
 * 10 000 porque es un monto que las cuatro pasarelas aceptan en tarjeta y en PSE.
 *
 * `INVALID_CREDENTIALS` no tiene monto: lo pide la credencial, no el cuerpo, porque la
 * pasarela rechaza la llave antes de leer el cobro. Ver `invalidCredential.ts`.
 */
export const RESERVED_AMOUNTS: ReadonlyMap<number, string> = new Map([
  [10100, "DECLINED"],
  [10101, "PENDING"],
  [10102, "EXPIRED"],
  [10409, "DUPLICATE_PAYMENT"],
  [10429, "RATE_LIMIT"],
  [10500, "SERVER_ERROR"],
  [10502, "BAD_GATEWAY"],
  [10503, "SERVICE_UNAVAILABLE"],
  [10504, "TIMEOUT"],
  [10001, "NETWORK_ERROR"],
  [10002, "FLAPPING"],
  [10003, "SLOW"],
  [10004, "MALFORMED_JSON"],
  [10005, "MALFORMED_BODY"],
  [10006, "HTML_ERROR"],
]);

/** Montos reservados cuya creación sale bien y cuya consulta falla. */
export const QUERY_FAILURE_AMOUNTS: ReadonlyMap<number, QueryFailure> = new Map([
  [10600, "QUERY_SERVER_ERROR"],
  [10602, "QUERY_FLAPPING"],
  [10604, "QUERY_SLOW"],
]);

/** De dónde salió el escenario que se va a aplicar. */
export type ScenarioSource = "header" | "gateway_data" | "amount" | "default";

export interface ResolvedScenario {
  scenario: string;
  source: ScenarioSource;
  /** Presente solo cuando el monto pidió una falla en la consulta posterior. */
  queryFailure?: QueryFailure;
}

/** Lo que la ruta encontró en el cuerpo de la petición, ya traducido. */
export interface ScenarioInputs {
  /** El escenario que deriva del dato de prueba de la pasarela, si lo hay. */
  gatewayData?: string;
  /** El monto en pesos enteros, o `undefined` si no es un número entero de pesos. */
  wholePesos?: number;
}

/** El escenario que pide la cabecera, o `undefined` si no vino ninguna. */
export function headerScenario(request: FastifyRequest): string | undefined {
  const headerValue =
    request.headers["x-simulator-scenario"] ?? request.headers["x-simulate-scenario"];

  if (!headerValue) {
    return undefined;
  }

  // Node colapsa una cabecera repetida en un solo string; la rama del arreglo existe por el
  // tipo de Fastify, no porque se alcance por HTTP.
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return raw.trim().toUpperCase();
}

/**
 * Elige el escenario con el orden aprobado el 6 de octubre de 2026 (issue #122):
 * cabecera > dato de prueba de la pasarela > monto reservado > `APPROVED`.
 *
 * La cabecera va primero para que las pruebas que ya la usan no cambien de resultado. El
 * dato de prueba va antes que el monto porque es lo mismo que haría el sandbox real: un
 * comercio que paga con la tarjeta que declina espera un rechazo, cualquiera sea el monto.
 */
export function resolveScenario(
  request: FastifyRequest,
  inputs: ScenarioInputs = {},
): ResolvedScenario {
  const fromHeader = headerScenario(request);
  if (fromHeader !== undefined) {
    return { scenario: fromHeader, source: "header" };
  }

  if (inputs.gatewayData !== undefined) {
    return { scenario: inputs.gatewayData, source: "gateway_data" };
  }

  if (inputs.wholePesos !== undefined) {
    const reserved = RESERVED_AMOUNTS.get(inputs.wholePesos);
    if (reserved !== undefined) {
      return { scenario: reserved, source: "amount" };
    }

    const queryFailure = QUERY_FAILURE_AMOUNTS.get(inputs.wholePesos);
    if (queryFailure !== undefined) {
      return { scenario: DEFAULT_SCENARIO, source: "amount", queryFailure };
    }
  }

  return { scenario: DEFAULT_SCENARIO, source: "default" };
}

/** Un monto en centavos enteros (Wompi, `amount_in_cents`) expresado en pesos enteros. */
export function wholePesosFromCents(cents: unknown): number | undefined {
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents % 100 !== 0) {
    return undefined;
  }
  return cents / 100;
}

/**
 * Un monto en pesos con decimales, número o string, expresado en pesos enteros.
 *
 * Mercado Pago tarjeta manda `transaction_amount` como número, Mercado Pago PSE manda
 * `total_amount` como string sin decimales y Rapyd manda `amount` como string con la escala
 * de la divisa (`"10100.00"`). Un monto con centavos distintos de cero no es un monto
 * reservado.
 */
export function wholePesosFromDecimal(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())
        ? Number(value)
        : NaN;

  return Number.isInteger(parsed) ? parsed : undefined;
}

/** El total del objeto `amount` de Kushki (la suma de su desglose), en pesos enteros. */
export function wholePesosFromKushkiAmount(amount: KushkiAmount | undefined): number | undefined {
  if (!amount || typeof amount !== "object") {
    return undefined;
  }

  // Se suma en centavos para no arrastrar el error de punto flotante de 0,1 + 0,2.
  const cents = [amount.subtotalIva0, amount.subtotalIva, amount.iva, amount.ice].reduce<number>(
    (total, part) => total + Math.round((typeof part === "number" ? part : 0) * 100),
    0,
  );

  return wholePesosFromCents(cents);
}
