// @ts-check
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Servidor estático del build, sin dependencias (punto 91 del `architecture-log.md`). Corre en
 * otro origen que la API para que el navegador aplique CORS de verdad: es lo que el issue #109
 * pide verificar.
 */

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const PUBLIC_KEY_PREFIX = "CHECKOUT_PUBLIC_KEY_";

/**
 * `/config.json`, armado del entorno. Cada `CHECKOUT_PUBLIC_KEY_<PASARELA>` se entrega con el
 * nombre de la pasarela en minúsculas, que es el valor que usa la API.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function clientConfigFrom(env) {
  /** @type {Record<string, string>} */
  const publicKeys = {};
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith(PUBLIC_KEY_PREFIX) && value) {
      publicKeys[name.slice(PUBLIC_KEY_PREFIX.length).toLowerCase()] = value;
    }
  }
  return {
    apiBaseUrl: env.KIT_PAGOS_API_URL || "http://localhost:3000/v1/api",
    tokenizationEnvironment: env.TOKENIZATION_ENVIRONMENT || "simulator",
    publicKeys,
  };
}

/**
 * @param {{ root: string, env?: NodeJS.ProcessEnv }} options
 */
export function createStaticServer({ root, env = process.env }) {
  const rootDir = resolve(root);
  const config = JSON.stringify(clientConfigFrom(env));

  return createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }

    if (pathname === "/config.json") {
      response.writeHead(200, { "content-type": CONTENT_TYPES[".json"], "cache-control": "no-store" }).end(config);
      return;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const filePath = resolve(join(rootDir, decoded === "/" ? "index.html" : decoded));
    if (!filePath.startsWith(rootDir + sep)) {
      response.writeHead(404).end();
      return;
    }

    try {
      const body = await readFile(filePath);
      const type = CONTENT_TYPES[/** @type {keyof typeof CONTENT_TYPES} */ (extname(filePath))];
      response.writeHead(200, { "content-type": type ?? "application/octet-stream" });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4100;
  const root = fileURLToPath(new URL("./dist", import.meta.url));
  createStaticServer({ root }).listen(port, "127.0.0.1", () => {
    console.log(`Prototipo C en http://localhost:${port} (API: ${clientConfigFrom(process.env).apiBaseUrl})`);
  });
}
