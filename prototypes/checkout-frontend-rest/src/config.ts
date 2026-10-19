/**
 * Configuración de despliegue que el servidor estático entrega en `/config.json`. El código
 * del cliente no trae ninguna llave: la pública de cada pasarela llega aquí, en tiempo de
 * ejecución, y solo hace falta para tokenizar una tarjeta.
 */

import type { CardCapture } from "./api";

/**
 * El ambiente al que apunta todo el cobro, y el único que entiende el cliente: el mismo valor
 * va en la cabecera `x-kit-pagos-environment` de cada llamada a `/v1/api` y es el `environment`
 * con el que `KitPagosBrowser` tokeniza la tarjeta. Si los dos difirieran, el token saldría de
 * un ambiente y se cobraría en otro. `production` no existe aquí: exigiría llaves privadas.
 */
export type KitPagosEnvironment = "simulator" | "sandbox";

export interface ClientConfig {
  apiBaseUrl: string;
  environment: KitPagosEnvironment;
  publicKeys: Record<string, string>;
}

/** La API de Simulación desplegada; es la misma que usa `server.mjs` por omisión. */
export const DEFAULT_API_URL = "https://kit-pagos-colombia.onrender.com/v1/api";

export const DEFAULT_CONFIG: ClientConfig = {
  apiBaseUrl: DEFAULT_API_URL,
  environment: "sandbox",
  publicKeys: {},
};

type FetchLike = (input: string) => Promise<Response>;

function asEnvironment(value: unknown): KitPagosEnvironment {
  return value === "simulator" ? "simulator" : DEFAULT_CONFIG.environment;
}

export async function loadConfig(fetchFn: FetchLike = fetch, url = "./config.json"): Promise<ClientConfig> {
  const response = await fetchFn(url);
  if (!response.ok) {
    return DEFAULT_CONFIG;
  }
  const loaded = (await response.json()) as Partial<ClientConfig>;
  return {
    apiBaseUrl: loaded.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl,
    environment: asEnvironment(loaded.environment),
    publicKeys: { ...loaded.publicKeys },
  };
}

/**
 * Por qué la tienda no ofrece tarjeta con esta pasarela, o `undefined` si la ofrece. Cómo la
 * recibe cada pasarela lo dice la API (`cardCapture` de `GET /v1/api/gateways`): en su página,
 * sin nada más, o tokenizada en el navegador con su llave pública, que llega en `/config.json`.
 * Sin ese dato, la API corre un código anterior y la tienda no adivina.
 */
export function cardUnavailableFor(
  config: Pick<ClientConfig, "publicKeys">,
  capture: CardCapture | undefined,
  gateway: string,
): string | undefined {
  if (capture === "HOSTED_PAGE") {
    return undefined;
  }
  if (capture === "BROWSER_TOKEN") {
    return config.publicKeys[gateway]
      ? undefined
      : "La tarjeta no está disponible con esta pasarela: se tokeniza en tu navegador con su llave pública, " +
          "y esta tienda arrancó sin ella. Paga con PSE o elige otra pasarela.";
  }
  return "Con esta pasarela no ofrecemos tarjeta: la API no dice cómo la recibe. Paga con PSE o elige otra pasarela.";
}

/**
 * Si la página no recibió ninguna llave pública, las pasarelas que tokenizan en el navegador
 * quedan sin tarjeta: el aviso va a la consola, para quien prueba, y no al comprador.
 */
export function missingPublicKeysProblem(config: Pick<ClientConfig, "publicKeys">): string | undefined {
  if (Object.keys(config.publicKeys).length > 0) {
    return undefined;
  }
  return (
    "la página no recibió ninguna llave pública en /config.json: la tarjeta queda deshabilitada con " +
    "las pasarelas que tokenizan en el navegador. Arranque el servidor con --dotenv=<ruta del .env> (guía de prueba)."
  );
}

/**
 * Dónde tokeniza `KitPagosBrowser` en el ambiente `simulator`: un valor fijo del SDK, que no
 * deja pasar otro host para que la tarjeta no pueda mandarse a donde no es.
 */
const SIMULATOR_TOKENIZATION_PORT = "3000";
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/**
 * Con el ambiente `simulator`, el SDK manda la tarjeta a `localhost:3000`. Si la API no es esa,
 * el token lo emitió un proceso y lo cobraría otro que no lo conoce, y la tarjeta habría ido a
 * lo que haya escuchando en el puerto 3000 de la máquina del pagador. Devuelve por qué la
 * tarjeta no se puede cobrar con esta configuración, o `undefined` si se puede.
 */
export function cardTokenizationProblem(config: Pick<ClientConfig, "apiBaseUrl" | "environment">): string | undefined {
  if (config.environment !== "simulator") {
    return undefined;
  }
  const api = new URL(config.apiBaseUrl);
  if (LOCAL_HOSTS.includes(api.hostname) && api.port === SIMULATOR_TOKENIZATION_PORT) {
    return undefined;
  }
  return (
    `Con el ambiente simulator, el SDK tokeniza la tarjeta contra localhost:${SIMULATOR_TOKENIZATION_PORT}, ` +
    `y esta API está en ${api.origin}: el token no serviría y la tarjeta no se envía. ` +
    "Pague con PSE, arranque con «npm run start:local» y la API de Simulación en localhost:3000, " +
    "o con «npm start», que cobra en el sandbox con la llave pública de la pasarela."
  );
}
