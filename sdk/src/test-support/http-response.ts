/**
 * Respuesta HTTP fallida con cuerpo JSON, para sustituir `fetch` en las pruebas.
 *
 * Expone `json()` y `text()` sobre el mismo cuerpo porque los adaptadores leen el cuerpo de
 * error una sola vez, como texto (ver `http-failure.ts`). Un mock que solo trae `json()` ya
 * no imita lo que devuelve el `fetch` real.
 */
export function jsonErrorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
