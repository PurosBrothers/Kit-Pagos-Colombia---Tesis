import { Gateway } from "../../domain/value-objects/Gateway";

/** Lo que se lee de un cuerpo de error: el código nativo y el motivo, cada uno si viene. */
interface NativeErrorDetail {
  code?: string;
  reason?: string;
}

/**
 * El largo máximo del detalle. El cuerpo de un error puede repetir campos de la petición, y
 * el mensaje es para que lo lea una persona: lo que pase de aquí sigue en `originalPayload`.
 */
const MAX_DETAIL_LENGTH = 300;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Un texto no vacío o un número, como texto; cualquier otra cosa, `undefined`. */
function text(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** El primer elemento de una lista, si es un objeto. */
function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? record(value[0]) : undefined;
}

/** Los `messages` de Wompi, `{ campo: [motivos] }`, como `campo: motivo; otro: motivo`. */
function wompiMessages(messages: unknown): string | undefined {
  const fields = Object.entries(record(messages) ?? {}).map(([field, reasons]) => {
    const list = (Array.isArray(reasons) ? reasons : [reasons]).map(text).filter(Boolean);
    return list.length > 0 ? `${field}: ${list.join(", ")}` : undefined;
  });
  const parts = fields.filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

/**
 * Dónde trae cada pasarela el código y el motivo de un error HTTP. Todas las formas son
 * medidas (`docs/testing-data/`):
 *
 * - **Kushki:** `{ code, message }`, como el `400 K220` de un token cobrado por otro monto
 *   (`kushki.md` §1.3) o el `400 K004` de una credencial inválida (§1.2).
 * - **Wompi:** `{ error: { type, reason } }`, o `{ error: { type, messages } }` cuando falla la
 *   validación, con un motivo por campo (`wompi.md` §1.3 y §1.4).
 * - **Mercado Pago:** tres formas. La Orders API responde `{ errors: [{ code, message }] }`;
 *   `/v1/payments` responde `{ code, message }` o `{ message, error, cause: [{ code }] }`
 *   (`mercado-pago.md` §1.1 y §1.2).
 * - **Rapyd:** `{ status: { error_code, message } }`, el mismo sobre de una respuesta buena
 *   (`rapyd.md` §1.1 y §2).
 */
const DETAIL_READERS: Readonly<Record<Gateway, (body: Record<string, unknown>) => NativeErrorDetail>> = {
  [Gateway.KUSHKI]: (body) => ({ code: text(body.code), reason: text(body.message) }),
  [Gateway.WOMPI]: (body) => {
    const error = record(body.error);
    return { code: text(error?.type), reason: text(error?.reason) ?? wompiMessages(error?.messages) };
  },
  [Gateway.MERCADOPAGO]: (body) => {
    const order = firstRecord(body.errors);
    if (order) return { code: text(order.code), reason: text(order.message) };
    const cause = firstRecord(body.cause);
    return {
      code: text(body.code) ?? text(body.error) ?? text(cause?.code),
      reason: text(body.message) ?? text(cause?.description),
    };
  },
  [Gateway.RAPYD]: (body) => {
    const status = record(body.status);
    return { code: text(status?.error_code), reason: text(status?.message) };
  },
};

/**
 * El código y el motivo nativos de un cuerpo de error, como `K220: Monto de la transacción…`,
 * o `undefined` si el cuerpo no trae ninguno de los dos.
 *
 * Un cuerpo que no es JSON —la página HTML de un balanceador— no aporta detalle: el texto
 * completo sigue en `originalPayload`.
 */
export function gatewayErrorDetail(gateway: Gateway, body: unknown): string | undefined {
  const fields = record(body);
  const read = DETAIL_READERS[gateway];
  if (!fields || !read) return undefined;

  const { code, reason } = read(fields);
  const detail = [code, reason].filter(Boolean).join(": ");
  if (detail === "") return undefined;
  return detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH - 1)}…` : detail;
}

/**
 * El mensaje de un error HTTP con el detalle nativo entre paréntesis, si el cuerpo lo trae.
 *
 * Antes el mensaje era solo la plantilla con el status, y `/v1/api` responde el `message`: el
 * `400 K220` de Kushki llegaba como «Kushki gateway returned an HTTP error status 400» y nadie
 * veía el motivo (issue #153, punto 107 del architecture-log.md). El `code` normalizado no
 * cambia. El mensaje sale de aquí sin limpiar: lo limpia `ErrorHandler.handle()` por patrones
 * y, para los valores exactos de las credenciales, `redactCredentials()`.
 */
export function withGatewayDetail(message: string, gateway: Gateway, body: unknown): string {
  const detail = gatewayErrorDetail(gateway, body);
  return detail ? `${message} (${detail})` : message;
}
