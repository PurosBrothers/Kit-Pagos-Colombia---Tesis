import Ajv from "ajv";
import addFormats from "ajv-formats";
import { FastifyInstance } from "fastify";

/**
 * Los schemas de las rutas de simulación validan y documentan, pero no reescriben la petición
 * ni la respuesta. Fastify, por omisión, reescribe las dos, y en un mock eso cambia lo medido:
 *
 * - **La respuesta** se serializa con el schema (`fast-json-stringify`), que quita todo campo
 *   no declarado y convierte los valores al tipo declarado. Así se perdían `status_message` en
 *   la consulta de Wompi y `external_reference` en la orden de Mercado Pago, y `details` pasaba
 *   de lista a texto. Aquí sale lo que arma el handler, que es lo medido contra la pasarela.
 * - **La petición** se valida con Ajv convirtiendo tipos (`coerceTypes`), rellenando valores
 *   por omisión y quitando los campos que un `additionalProperties: false` no admite. Aquí una
 *   petición que no cumple el schema se rechaza, y una que lo cumple llega al handler como la
 *   mandó el cliente.
 *
 * Se llama al principio de cada plugin de rutas de simulación. Los compiladores quedan en el
 * contexto de ese plugin, así que no tocan `/v1/api`.
 */
const validator = addFormats(
  new Ajv({
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    allErrors: false,
    // `example` es de OpenAPI, no de JSON Schema; lo mismo que declara `app.ts`.
    keywords: ["example"],
    strictTypes: false,
  }),
);

/**
 * Un error que llega a Fastify sin respuesta propia (un JSON roto, una excepción del handler) se
 * serializa con el schema de su código si la ruta lo declara, como `Object.create(error, …)` con
 * `statusCode`, `error` y `message` no enumerables. `JSON.stringify` lo dejaría en `{}`; sale con
 * el cuerpo que Fastify arma cuando la ruta no declara ese código.
 */
function serialize(data: unknown): string {
  if (data instanceof Error) {
    const { statusCode, code, error, message } = data as Error & {
      statusCode?: number;
      code?: string;
      error?: string;
    };
    return JSON.stringify({ statusCode, code, error, message });
  }
  return JSON.stringify(data);
}

export function compileSchemasAsIs(app: FastifyInstance): void {
  app.setValidatorCompiler(({ schema }) => validator.compile(schema));
  app.setSerializerCompiler(() => serialize);
}
