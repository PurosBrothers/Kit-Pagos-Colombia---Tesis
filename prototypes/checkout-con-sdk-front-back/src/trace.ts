import { FastifyInstance } from "fastify";

/**
 * La traza del checkout en la terminal, para ver qué pasa por debajo de la tienda: cada
 * petición que llega del navegador o de la pasarela, y cada llamada que sale hacia la pasarela.
 *
 * Es del esqueleto común. Ve las llamadas del módulo de pagos envolviendo `fetch`, sin tocar el
 * módulo, porque su código es el que se mide en el experimento. Nunca registra cabeceras ni
 * cuerpos: solo el método, la ruta sin la query y con las llaves tapadas, el código HTTP, el
 * estado que devolvió la pasarela y el tiempo. Está apagada hasta que `server.ts` la enciende,
 * así que las pruebas no la imprimen.
 */
export type TraceWriter = (line: string) => void;

let writer: TraceWriter | undefined;

export function enableTrace(write: TraceWriter = (line) => console.log(line)): void {
  writer = write;
}

export function disableTrace(): void {
  writer = undefined;
}

export function trace(line: string): void {
  writer?.(`[checkout] ${line}`);
}

/** Las formas de las llaves de las pasarelas, que no salen nunca en la traza: queda el prefijo. */
const KEY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(pub|prv)_(test|prod|stagtest)_[A-Za-z0-9]+/g, "$1_$2_…"],
  [/\b(APP_USR|TEST)-[A-Za-z0-9-]+/g, "$1-…"],
];

/** La URL sin la query, sin el esquema y con las llaves tapadas. */
export function describeUrl(url: string): string {
  let shown: string;
  try {
    const parsed = new URL(url);
    shown = `${parsed.host}${parsed.pathname}`;
  } catch {
    shown = url.split("?")[0];
  }
  return KEY_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), shown);
}

/** El estado que trae la respuesta de la pasarela, si es JSON y lo trae. */
async function nativeStatusOf(response: Response): Promise<string | undefined> {
  if (!response.headers.get("content-type")?.includes("json")) return undefined;
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    const data = body.data as Record<string, unknown> | undefined;
    const status = data?.status ?? body.status;
    return typeof status === "string" ? status : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Envuelve el `fetch` del proceso: una línea por llamada saliente. Devuelve la función que deja
 * el `fetch` original, para las pruebas.
 */
export function traceOutgoingCalls(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const started = Date.now();
    try {
      const response = await original(input, init);
      const status = await nativeStatusOf(response);
      trace(
        `  tienda → pasarela  ${method} ${describeUrl(url)} → ${response.status}${status ? ` · estado ${status}` : ""} · ${Date.now() - started} ms`,
      );
      return response;
    } catch (error) {
      trace(`  tienda → pasarela  ${method} ${describeUrl(url)} → sin respuesta: ${(error as Error).message} · ${Date.now() - started} ms`);
      throw error;
    }
  };
  return () => {
    globalThis.fetch = original;
  };
}

/** Las rutas que se registran: la API de la página, sus páginas de orden y los webhooks. */
function traced(url: string): boolean {
  return url.startsWith("/api/") || url.startsWith("/orders/") || url.startsWith("/webhooks");
}

/** Una línea al llegar cada petición y otra al responderla. */
export function traceIncomingRequests(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    if (!traced(request.url)) return;
    const from = request.url.startsWith("/webhooks") ? "pasarela → tienda " : "navegador → tienda";
    trace(`${from}  ${request.method} ${request.url.split("?")[0]}`);
  });
  app.addHook("onResponse", async (request, reply) => {
    if (!traced(request.url)) return;
    const to = request.url.startsWith("/webhooks") ? "pasarela ← tienda " : "navegador ← tienda";
    trace(`${to}  ${request.method} ${request.url.split("?")[0]} → ${reply.statusCode} · ${Math.round(reply.elapsedTime)} ms`);
  });
}
