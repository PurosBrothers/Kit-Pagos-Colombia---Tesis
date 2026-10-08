import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import {
  resolveRequestTimeoutMs,
  withRequestTimeout,
} from "../../src/infrastructure/config/request-timeout";

/** Nombre comercial de cada pasarela, para los mensajes que ve el comercio. */
const GATEWAY_LABELS: Readonly<Record<string, string>> = {
  [Gateway.WOMPI]: "Wompi",
  [Gateway.MERCADOPAGO]: "Mercado Pago",
};

/** La respuesta de la pasarela con su cuerpo ya leído como texto. */
export interface CardTokenReply {
  readonly response: Response;
  readonly text: string;
}

/**
 * Reconoce el rechazo de `fetch` por un `AbortSignal` vencido, por `name` y no por
 * `instanceof`, con el mismo criterio que `ErrorHandler` del SDK de servidor.
 */
function isAbortSignalError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Envía la petición de tokenización con un límite de tiempo y lee el cuerpo.
 *
 * Sin límite, una pasarela que acepta la conexión y no responde deja el formulario del
 * pagador esperando lo que decida el navegador. El límite se valida y se aplica con las
 * mismas funciones que `SDKOptions.timeoutMs` (`request-timeout.ts`), reutilizadas porque
 * no importan módulos de Node, y por omisión es el mismo: 30 000 ms. Cubre también la
 * lectura del cuerpo, y se cumple aunque el `fetch` inyectado ignore la señal.
 *
 * El `url` lo arma cada tokenizador desde su catálogo cerrado (`resolveCatalogUrl`); esta
 * función no lo elige ni lo modifica.
 */
export async function sendCardTokenRequest(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
  timeoutMs: number | undefined,
  gateway: Gateway,
): Promise<CardTokenReply> {
  const limitMs = resolveRequestTimeoutMs(timeoutMs, gateway);
  const label = GATEWAY_LABELS[gateway] ?? gateway;

  try {
    return await withRequestTimeout(limitMs, async (signal) => {
      const response = await fetchFn(url, { ...init, signal });
      return { response, text: await response.text() };
    });
  } catch (error) {
    if (isAbortSignalError(error)) {
      throw new KitPagosError(
        KitPagosErrorCode.GATEWAY_TIMEOUT,
        gateway,
        error,
        `${label} no respondió la tokenización en ${limitMs} ms.`,
      );
    }
    throw new KitPagosError(
      KitPagosErrorCode.CONNECTION_FAILED,
      gateway,
      error,
      `Error de conexión al tokenizar tarjeta en ${label}: ${(error as Error).message}`,
    );
  }
}
