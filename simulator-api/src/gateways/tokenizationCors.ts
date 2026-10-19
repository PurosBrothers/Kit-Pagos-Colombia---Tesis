import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/**
 * CORS de las dos rutas de tokenización de tarjeta, las únicas de `/v1/sim` que llama un
 * navegador: `KitPagosBrowser` y el checkout de los prototipos tokenizan desde la página del
 * comercio, en otro origen que el simulador.
 *
 * Nivel 1 — medido el 13 de octubre de 2026 a las 12:22 (UTC−5), con
 * `Origin: http://localhost:4000` (punto 89 del `architecture-log.md`):
 * - el preflight de `https://sandbox.wompi.co/v1/tokens/cards` y el de
 *   `https://api.mercadopago.com/v1/card_tokens` responden 200 con las cabeceras de abajo;
 * - las respuestas del `POST` traen `access-control-allow-origin: *` también cuando son un
 *   error (Wompi 401 sin llave, Mercado Pago 404 con una llave inexistente).
 *
 * El resto de `/v1/sim` sigue sin CORS (punto 64, decisión 3): solo lo consume un backend.
 */
export const WOMPI_TOKENIZATION_PREFLIGHT_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT",
  "access-control-allow-headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
};

export const MERCADOPAGO_TOKENIZATION_PREFLIGHT_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "accept, content-type, x-request-id, x-product-id, authorization",
  "access-control-allow-methods": "POST, PUT, GET, OPTIONS, PATCH",
  "access-control-max-age": "10",
};

/** `onSend` de la ruta de tokenización: toda respuesta, también los errores, lleva el origen abierto. */
export async function allowAnyOrigin(
  _request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  reply.header("access-control-allow-origin", "*");
  return payload;
}

/** Registra el preflight `OPTIONS` de una ruta de tokenización con las cabeceras medidas. */
export function registerTokenizationPreflight(
  app: FastifyInstance,
  path: string,
  headers: Readonly<Record<string, string>>,
): void {
  app.options(
    path,
    {
      schema: {
        summary: "Responder preflight CORS de tokenización",
        description:
          "Permite que una página de comercio llame la ruta de tokenización desde el navegador.",
        response: {
          200: {
            description: "Preflight CORS aceptado.",
            headers: Object.fromEntries(
              Object.entries(headers).map(([name, value]) => [
                name,
                { type: "string", example: value },
              ]),
            ),
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).headers(headers).send();
    },
  );
}
