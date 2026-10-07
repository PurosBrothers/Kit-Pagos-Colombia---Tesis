import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

/**
 * Límite por petición HTTP a la pasarela cuando el comercio no configura `timeoutMs`
 * (issue #122, hueco 5). Sin él, una pasarela que acepta la conexión y no responde deja al
 * SDK esperando lo que decida el `fetch` de Node.
 *
 * Es un valor de criterio, no medido: cabe con holgura un cobro con tarjeta y deja al
 * comercio tiempo para responderle a su propio cliente antes de que este se canse.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Máximo que acepta el temporizador de Node. Medido el 6 de octubre de 2026 en Node 20.20.2 y
 * 22.22.3 con `AbortSignal.timeout`, y el 7 de octubre en 22.22.3 y 24.19.0 con
 * `setTimeout`, que es lo que usa `withRequestTimeout`: con 2 147 483 648 Node emite
 * `TimeoutOverflowWarning`, fija el plazo en 1 ms y abortaría todas las peticiones. Por eso
 * el límite se valida al configurar y no se deja pasar.
 */
const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

/**
 * Valida `SDKOptions.timeoutMs` y devuelve el valor efectivo.
 *
 * Exige un entero positivo: `0` o un negativo no tienen una lectura razonable («sin límite»
 * sería volver al problema que la opción resuelve), y una fracción se redondearía en
 * silencio dentro del temporizador.
 */
export function resolveRequestTimeoutMs(value: unknown, gateway: Gateway): number {
  if (value === undefined) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_REQUEST_TIMEOUT_MS) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      gateway,
      null,
      `timeoutMs must be an integer between 1 and ${MAX_REQUEST_TIMEOUT_MS} milliseconds; received ${String(value)}`,
    );
  }
  return value as number;
}

/**
 * Ejecuta `operation` —el `fetch` y la lectura del cuerpo— con `timeoutMs` como plazo.
 *
 * Pasarle la señal a `fetch` no basta: el plazo solo se cumple si ese `fetch` la respeta.
 * Medido el 7 de octubre de 2026 con el paquete instalado: con un `fetch` inyectado que
 * ignora el `signal`, `tokenizeCard({ timeoutMs: 50 })` seguía pendiente a los 2 000 ms. Por
 * eso la operación compite con una promesa que se rechaza al abortar la misma señal, y el
 * plazo vale aunque `fetch`, `json()` o `text()` nunca terminen.
 *
 * El rechazo es un `DOMException` de `name` `"TimeoutError"`, el mismo que produce
 * `AbortSignal.timeout`, para que `ErrorHandler` y el tokenizador lo sigan traduciendo a
 * `GATEWAY_TIMEOUT` por su nombre. Si `onTimeout` viene, el rechazo es lo que devuelva.
 *
 * Se usa `setTimeout` y no `AbortSignal.timeout` porque el temporizador de este último no se
 * puede cancelar: cuando la pasarela responde a tiempo, aquí se cancela y se quita el
 * listener, y no queda nada pendiente. `unref()` existe solo en Node; ahí evita que una
 * petición en curso mantenga vivo el proceso.
 *
 * No importa módulos de Node: la usa también `kit-pagos-colombia/browser`.
 */
export async function withRequestTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  onTimeout: (reason: unknown) => unknown = (reason) => reason,
): Promise<T> {
  const controller = new AbortController();
  const { signal } = controller;
  let rejectOnAbort!: () => void;
  // `onTimeout` corre en la cadena de la promesa y no dentro del listener: si lanzara ahí,
  // sería una excepción no capturada del `EventTarget` y la petición quedaría pendiente.
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(signal.reason);
  }).catch((reason: unknown) => {
    throw onTimeout(reason);
  });
  signal.addEventListener("abort", rejectOnAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`The request exceeded ${timeoutMs} ms`, "TimeoutError"));
  }, timeoutMs);
  (timer as { unref?: () => void }).unref?.();

  try {
    return await Promise.race([operation(signal), deadline]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", rejectOnAbort);
  }
}
