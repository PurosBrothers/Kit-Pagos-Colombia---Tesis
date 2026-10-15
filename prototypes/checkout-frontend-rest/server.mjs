// @ts-check
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Servidor estático del build, sin dependencias (punto 91 del `architecture-log.md`). Corre en
 * otro origen que la API para que el navegador aplique CORS de verdad: es lo que el issue #109
 * pide verificar.
 *
 * A qué API y a qué ambiente apunta el cliente se decide aquí, al arrancar (punto 94). Se puede
 * pasar con argumentos (`npm start -- --environment=sandbox`) o con variables de entorno. Los
 * argumentos son los que sirven igual en bash, PowerShell y cmd: `set VARIABLE=valor` no define
 * una variable de entorno en PowerShell, y el servidor arrancaría apuntando a la API por omisión
 * sin avisar.
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

/** La API de Simulación desplegada. Con ella el prototipo corre sin encender nada en local. */
export const DEFAULT_API_URL = "https://kit-pagos-colombia.onrender.com/v1/api";

/**
 * Los ambientes que acepta el cliente. `production` no está: exigiría llaves privadas del
 * comercio, y un navegador no debe tenerlas (`/v1/api` responde 401 sin ellas).
 */
export const ENVIRONMENTS = ["simulator", "sandbox"];

export const USAGE = `Uso: npm start -- [opciones]

  --api-url=<url>               La API de Kit Pagos (/v1/api). Por omisión, ${DEFAULT_API_URL}
  --environment=<ambiente>      simulator (por omisión) o sandbox. Con sandbox la API cobra
                                contra el sandbox oficial de cada pasarela
  --public-key=<pasarela>:<llave>
                                La llave pública que hace falta para tokenizar una tarjeta.
                                Se puede repetir, una vez por pasarela
  --port=<puerto>               Puerto de este servidor (por omisión 4100)
  --help                        Esta ayuda

Las mismas opciones, como variables de entorno: KIT_PAGOS_API_URL, KIT_PAGOS_ENVIRONMENT,
CHECKOUT_PUBLIC_KEY_<PASARELA> y PORT. Un argumento gana sobre su variable.`;

/** @param {string | undefined} value */
function resolveEnvironment(value) {
  const environment = value || "simulator";
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`Ambiente «${environment}» no válido: use ${ENVIRONMENTS.join(" o ")}.`);
  }
  return environment;
}

/** @param {string | undefined} value */
function resolveApiUrl(value) {
  const apiUrl = value || DEFAULT_API_URL;
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error(`La URL de la API «${apiUrl}» no es válida.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`La URL de la API «${apiUrl}» debe empezar por http:// o https://.`);
  }
  return apiUrl;
}

/**
 * @typedef {object} CliOptions
 * @property {string} [apiUrl]
 * @property {string} [environment]
 * @property {number} [port]
 * @property {Record<string, string>} [publicKeys]
 * @property {boolean} [help]
 */

/**
 * Lee `--opción=valor` y `--opción valor`. Lo que no reconoce es un error y no se ignora: una
 * opción mal escrita que se descarta deja el servidor apuntando a donde no se quería.
 *
 * @param {string[]} argv
 * @returns {CliOptions}
 */
export function parseArguments(argv) {
  /** @type {CliOptions} */
  const options = { publicKeys: {} };
  const publicKeys = /** @type {Record<string, string>} */ (options.publicKeys);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const match = /^--(api-url|environment|public-key|port)(?:=(.*))?$/.exec(argument);
    if (!match) {
      throw new Error(`Argumento desconocido: ${argument}. Use --help para ver las opciones.`);
    }
    const [, name] = match;
    let value = match[2];
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`Falta el valor de --${name}.`);
    }

    if (name === "api-url") {
      options.apiUrl = value;
    } else if (name === "environment") {
      options.environment = value;
    } else if (name === "port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`El puerto «${value}» no es válido.`);
      }
      options.port = port;
    } else {
      const separator = value.indexOf(":");
      const gateway = value.slice(0, separator).trim().toLowerCase();
      const key = value.slice(separator + 1).trim();
      if (separator < 1 || !key) {
        throw new Error("--public-key lleva la forma <pasarela>:<llave>.");
      }
      publicKeys[gateway] = key;
    }
  }
  return options;
}

/**
 * `/config.json`, armado de los argumentos y del entorno. Cada `CHECKOUT_PUBLIC_KEY_<PASARELA>`
 * se entrega con el nombre de la pasarela en minúsculas, que es el valor que usa la API.
 * Un valor inválido lanza un error: el servidor no arranca con una configuración a medias.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {CliOptions} [options]
 */
export function clientConfigFrom(env, options = {}) {
  /** @type {Record<string, string>} */
  const publicKeys = {};
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith(PUBLIC_KEY_PREFIX) && value) {
      publicKeys[name.slice(PUBLIC_KEY_PREFIX.length).toLowerCase()] = value;
    }
  }
  Object.assign(publicKeys, options.publicKeys);
  return {
    apiBaseUrl: resolveApiUrl(options.apiUrl || env.KIT_PAGOS_API_URL),
    environment: resolveEnvironment(options.environment || env.KIT_PAGOS_ENVIRONMENT),
    publicKeys,
  };
}

/**
 * @param {{ root: string, env?: NodeJS.ProcessEnv, options?: CliOptions }} settings
 */
export function createStaticServer({ root, env = process.env, options = {} }) {
  const rootDir = resolve(root);
  const config = JSON.stringify(clientConfigFrom(env, options));

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

/**
 * Todo lo que hace `npm start` salvo escuchar en el puerto, para poder probarlo: lee los
 * argumentos, comprueba que el build existe y arma el servidor. Cualquier problema sale como
 * un `Error` con un mensaje que dice qué corregir.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {string} root
 */
export function prepareServer(argv, env, root) {
  const options = parseArguments(argv);
  if (options.help) {
    return { help: USAGE };
  }
  const config = clientConfigFrom(env, options);
  if (!existsSync(join(root, "index.html"))) {
    throw new Error("Falta el build del cliente: corra «npm run build» antes de «npm start».");
  }
  return {
    config,
    port: options.port ?? (Number(env.PORT) || 4100),
    server: createStaticServer({ root, env, options }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const prepared = prepareServer(
      process.argv.slice(2),
      process.env,
      fileURLToPath(new URL("./dist", import.meta.url)),
    );
    if ("help" in prepared) {
      console.log(prepared.help);
    } else {
      const { config, port, server } = prepared;
      server.listen(port, "127.0.0.1", () => {
        console.log(`Prototipo C en http://localhost:${port}`);
        console.log(`  API:      ${config.apiBaseUrl}`);
        console.log(`  Ambiente: ${config.environment}`);
        const withKey = Object.keys(config.publicKeys);
        console.log(`  Llaves públicas para tarjeta: ${withKey.length ? withKey.join(", ") : "ninguna"}`);
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
