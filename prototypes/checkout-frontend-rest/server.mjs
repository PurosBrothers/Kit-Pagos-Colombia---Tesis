// @ts-check
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Servidor estático del build, sin dependencias (punto 91 del `architecture-log.md`). Corre en
 * otro origen que la API para que el navegador aplique CORS de verdad: es lo que el issue #109
 * pide verificar.
 *
 * A qué API y a qué ambiente apunta el cliente se decide aquí, al arrancar (punto 94). Se puede
 * pasar con argumentos (`npm start -- --environment=simulator`) o con variables de entorno. Los
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

/**
 * Lo único que se lee del `.env`: `<PASARELA>_PUBLIC_KEY`, con la pasarela en una sola palabra,
 * que es como la API nombra las llaves públicas. El mismo archivo guarda llaves privadas y
 * secretos, y ninguno tiene esa forma; un valor que no se lee no puede llegar a `/config.json`.
 */
const ENV_FILE_PUBLIC_KEY = /^([A-Z][A-Z0-9]*)_PUBLIC_KEY$/;

/** El `.env` de la raíz del repositorio, el mismo que lee la API de Simulación. */
export const DEFAULT_ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));

/** La API de Simulación desplegada. Con ella el prototipo corre sin encender nada en local. */
export const DEFAULT_API_URL = "https://kit-pagos-colombia.onrender.com/v1/api";

/**
 * Los ambientes que acepta el cliente. `production` no está: exigiría llaves privadas del
 * comercio, y un navegador no debe tenerlas (`/v1/api` responde 401 sin ellas).
 */
export const ENVIRONMENTS = ["simulator", "sandbox"];

/** Por omisión el cliente cobra en el sandbox oficial de cada pasarela, a través de la API desplegada. */
export const DEFAULT_ENVIRONMENT = "sandbox";

export const USAGE = `Uso: npm start -- [opciones]

  --api-url=<url>               La API de Kit Pagos (/v1/api). Por omisión, ${DEFAULT_API_URL}
  --environment=<ambiente>      sandbox (por omisión) o simulator. Con sandbox la API cobra
                                contra el sandbox oficial de cada pasarela; con simulator,
                                contra su propio simulador
  --public-key=<pasarela>:<llave>
                                La llave pública que hace falta para tokenizar una tarjeta.
                                Se puede repetir, una vez por pasarela
  --dotenv=<ruta>               El .env del que se leen las llaves públicas. Por omisión, el
                                de la raíz del repositorio: ${DEFAULT_ENV_FILE}
  --port=<puerto>               Puerto de este servidor (por omisión 4100)
  --help                        Esta ayuda

Las mismas opciones, como variables de entorno: KIT_PAGOS_API_URL, KIT_PAGOS_ENVIRONMENT,
CHECKOUT_PUBLIC_KEY_<PASARELA>, KIT_PAGOS_DOTENV y PORT. Un argumento gana sobre su variable.

Del .env solo se leen las variables <PASARELA>_PUBLIC_KEY, con los nombres que usa la API; el
resto del archivo no se lee. Por cada pasarela, --public-key gana sobre
CHECKOUT_PUBLIC_KEY_<PASARELA>, y esa variable sobre el archivo. Si el .env de la raíz no existe,
el servidor arranca sin él; si no existe el que se pidió con --dotenv, no arranca.`;

/** @param {string | undefined} value */
function resolveEnvironment(value) {
  const environment = value || DEFAULT_ENVIRONMENT;
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
 * @property {string} [dotenv]
 * @property {boolean} [help]
 */

/**
 * Lee `--opción=valor` y `--opción valor`. Lo que no reconoce es un error y no se ignora: una
 * opción mal escrita que se descarta deja el servidor apuntando a donde no se quería.
 *
 * La del `.env` se llama `--dotenv` y no `--env-file` porque Node revisa por su cuenta un
 * `--env-file` aunque vaya después del script, y si el archivo no existe termina con código 9
 * antes de llegar aquí (medido el 15 de octubre de 2026 en Node 20.20.2, 22.22.3 y 24.19.0).
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
    const match = /^--(api-url|environment|public-key|dotenv|port)(?:=(.*))?$/.exec(argument);
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
    } else if (name === "dotenv") {
      options.dotenv = value;
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
 * Las llaves públicas de un `.env`, y nada más del archivo. Se lee como lo leen
 * `loadServerEnv()` de la API y `sandbox-env.ts` del SDK —corta en el primer `=`, recorta
 * espacios, salta comentarios y líneas vacías, no quita comillas, y si un nombre se repite vale
 * el primero, como en la API— para que el mismo archivo dé la misma llave aquí y allí.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function publicKeysFromEnvFile(content) {
  /** @type {Record<string, string>} */
  const firstValues = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || separator < 0) {
      continue;
    }
    const match = ENV_FILE_PUBLIC_KEY.exec(trimmed.slice(0, separator).trim());
    const gateway = match?.[1].toLowerCase();
    if (gateway && !(gateway in firstValues)) {
      firstValues[gateway] = trimmed.slice(separator + 1).trim();
    }
  }
  return Object.fromEntries(Object.entries(firstValues).filter(([, value]) => value));
}

/**
 * @typedef {object} EnvFile
 * @property {string} path
 * @property {boolean} found
 * @property {Record<string, string>} publicKeys
 */

/**
 * Lee el `.env` de `--dotenv`, de `KIT_PAGOS_DOTENV` o, sin ninguno, el de la raíz. Que
 * falte el de la raíz no es un error: un clon sin credenciales también arranca. Que falte uno
 * pedido sí lo es, porque arrancar sin sus llaves no es lo que se pidió.
 *
 * Se lee también con el ambiente `simulator`: las rutas de tokenización del simulador aceptan
 * cualquier llave pública que no esté vacía ni lleve una marca de credencial inválida, aunque
 * no sea la que él tiene configurada (medido el 15 de octubre de 2026).
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {CliOptions} options
 * @param {string} defaultPath
 * @returns {EnvFile}
 */
export function readEnvFile(env, options, defaultPath) {
  const requestedBy = options.dotenv ? "--dotenv" : env.KIT_PAGOS_DOTENV ? "KIT_PAGOS_DOTENV" : undefined;
  const path = resolve(options.dotenv || env.KIT_PAGOS_DOTENV || defaultPath);
  if (!existsSync(path)) {
    if (requestedBy) {
      throw new Error(`El archivo «${path}» de ${requestedBy} no existe.`);
    }
    return { path, found: false, publicKeys: {} };
  }
  return { path, found: true, publicKeys: publicKeysFromEnvFile(readFileSync(path, "utf8")) };
}

/** @typedef {"argumento" | "variable" | "archivo"} KeySource */

/**
 * La llave pública de cada pasarela y de dónde salió. Por pasarela, el argumento gana sobre
 * `CHECKOUT_PUBLIC_KEY_<PASARELA>` y esa variable sobre el `.env`. La pasarela va en minúsculas,
 * que es el valor que usa la API.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {CliOptions} [options]
 * @param {Record<string, string>} [fileKeys]
 * @returns {Record<string, { key: string, source: KeySource }>}
 */
export function resolvePublicKeys(env, options = {}, fileKeys = {}) {
  /** @type {Record<string, { key: string, source: KeySource }>} */
  const resolved = {};
  for (const [gateway, key] of Object.entries(fileKeys)) {
    resolved[gateway] = { key, source: "archivo" };
  }
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith(PUBLIC_KEY_PREFIX) && value) {
      resolved[name.slice(PUBLIC_KEY_PREFIX.length).toLowerCase()] = { key: value, source: "variable" };
    }
  }
  for (const [gateway, key] of Object.entries(options.publicKeys ?? {})) {
    resolved[gateway] = { key, source: "argumento" };
  }
  return resolved;
}

/**
 * `/config.json`, armado de los argumentos, del entorno y de las llaves del `.env`.
 * Un valor inválido lanza un error: el servidor no arranca con una configuración a medias.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {CliOptions} [options]
 * @param {Record<string, string>} [fileKeys]
 */
export function clientConfigFrom(env, options = {}, fileKeys = {}) {
  const resolved = resolvePublicKeys(env, options, fileKeys);
  return {
    apiBaseUrl: resolveApiUrl(options.apiUrl || env.KIT_PAGOS_API_URL),
    environment: resolveEnvironment(options.environment || env.KIT_PAGOS_ENVIRONMENT),
    publicKeys: Object.fromEntries(Object.entries(resolved).map(([gateway, { key }]) => [gateway, key])),
  };
}

/**
 * @param {{ root: string, env?: NodeJS.ProcessEnv, options?: CliOptions, fileKeys?: Record<string, string> }} settings
 */
export function createStaticServer({ root, env = process.env, options = {}, fileKeys = {} }) {
  const rootDir = resolve(root);
  const config = JSON.stringify(clientConfigFrom(env, options, fileKeys));

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
 * argumentos y el `.env`, comprueba que el build existe y arma el servidor. Cualquier problema
 * sale como un `Error` con un mensaje que dice qué corregir.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {string} root
 * @param {string} [defaultEnvFile]
 */
export function prepareServer(argv, env, root, defaultEnvFile = DEFAULT_ENV_FILE) {
  const options = parseArguments(argv);
  if (options.help) {
    return { help: USAGE };
  }
  const envFile = readEnvFile(env, options, defaultEnvFile);
  const config = clientConfigFrom(env, options, envFile.publicKeys);
  if (!existsSync(join(root, "index.html"))) {
    throw new Error("Falta el build del cliente: corra «npm run build» antes de «npm start».");
  }
  const sources = Object.fromEntries(
    Object.entries(resolvePublicKeys(env, options, envFile.publicKeys)).map(([gateway, { source }]) => [gateway, source]),
  );
  return {
    config,
    sources,
    envFile: { path: envFile.path, found: envFile.found },
    port: options.port ?? (Number(env.PORT) || 4100),
    server: createStaticServer({ root, env, options, fileKeys: envFile.publicKeys }),
  };
}

/**
 * Lo que imprime `npm start` al arrancar: de dónde salió cada llave pública, nunca su valor.
 *
 * @param {{ config: { apiBaseUrl: string, environment: string }, port: number, sources: Record<string, KeySource>, envFile: { path: string, found: boolean } }} prepared
 */
export function startupSummary({ config, port, sources, envFile }) {
  const withKey = Object.entries(sources).map(([gateway, source]) => `${gateway} (${source})`);
  return [
    `Prototipo C en http://localhost:${port}`,
    `  API:      ${config.apiBaseUrl}`,
    `  Ambiente: ${config.environment}`,
    `  Llaves públicas para tarjeta: ${withKey.length ? withKey.join(", ") : "ninguna"}`,
    `  Archivo .env: ${envFile.path}${envFile.found ? "" : " (no existe; no se leyó)"}`,
    ...(config.environment === "sandbox"
      ? ["  En sandbox, alguna pasarela no deja volver a localhost: sirva la página por un túnel (guía de prueba)."]
      : []),
  ].join("\n");
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
      prepared.server.listen(prepared.port, "127.0.0.1", () => {
        console.log(startupSummary(prepared));
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
