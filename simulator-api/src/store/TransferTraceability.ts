/**
 * El `trazabilityCode` (el CUS de PSE) que entregó `POST /transfer/v1/init` para cada
 * transferencia de Kushki, por token (issue #122).
 *
 * El webhook de transferencia aprobada lo trae (nivel 2,
 * https://docs.kushki.com/co/notifications/one-time-payments/webhook-transfer-in/, consultada el
 * 7 de octubre de 2026), y tiene que ser el mismo que vio el comercio al iniciar. Va al lado del
 * registro y no dentro porque el registro es la respuesta medida de
 * `GET /transfer/v1/status/{token}`, que no trae ese campo.
 */
const codes = new Map<string, string>();

/** Lo llama la ruta de `init`, con el código que va en su respuesta. */
export function rememberTraceabilityCode(token: string, code: string): void {
  codes.set(token, code);
}

/** El código entregado al iniciar la transferencia, o `undefined` si no se inició. */
export function traceabilityCodeFor(token: string): string | undefined {
  return codes.get(token);
}

/** Borra los códigos registrados. Lo llama `resetSimulatorState()`. */
export function clearTraceabilityCodes(): void {
  codes.clear();
}
