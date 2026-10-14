/**
 * La URL a la que el comercio pidió devolver al pagador, por cada cobro con redirección al
 * banco (issue #109).
 *
 * La página de banco del simulador la lee de aquí para ofrecer el enlace de vuelta. Se guarda
 * al crear el cobro, con lo que mandó el comercio, y no se lee de la URL de la página: una
 * dirección que llega en la query no se devuelve convertida en un enlace.
 *
 * Va al lado del registro y no dentro por la misma razón que `BankRedirectOrigins.ts`: el
 * registro es la respuesta nativa de la pasarela, y un campo propio del simulador viajaría
 * en ella.
 */
const returnUrls = new Map<string, string>();

function keyFor(gateway: string, id: string): string {
  return `${gateway}:${id}`;
}

/** Registra la URL de retorno del cobro. Sin URL (el comercio no la mandó) no registra nada. */
export function rememberBankReturnUrl(gateway: string, id: string, returnUrl: string | undefined): void {
  if (returnUrl) {
    returnUrls.set(keyFor(gateway, id), returnUrl);
  }
}

/** La URL de retorno registrada para el cobro, o `undefined` si no hay ninguna. */
export function bankReturnUrlFor(gateway: string, id: string): string | undefined {
  return returnUrls.get(keyFor(gateway, id));
}

/** Borra las URL registradas. Lo llama `resetSimulatorState()`. */
export function clearBankReturnUrls(): void {
  returnUrls.clear();
}

/**
 * La URL con un parámetro de query agregado, o la misma si no es una URL.
 *
 * Mercado Pago lo hace al volver del banco: `callback_url` + `?payment_id=<id>` (medido el
 * 14 de octubre de 2026). Respeta la query que ya traiga la URL del comercio.
 */
export function withQueryParam(url: string | undefined, name: string, value: string): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.append(name, value);
    return parsed.href;
  } catch {
    return url;
  }
}
