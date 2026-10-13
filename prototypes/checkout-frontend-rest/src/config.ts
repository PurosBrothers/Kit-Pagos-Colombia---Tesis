/**
 * Configuración de despliegue que el servidor estático entrega en `/config.json`. El código
 * del cliente no trae ninguna llave: la pública de cada pasarela llega aquí, en tiempo de
 * ejecución, y solo hace falta para tokenizar una tarjeta.
 */
export interface ClientConfig {
  apiBaseUrl: string;
  tokenizationEnvironment: string;
  publicKeys: Record<string, string>;
}

export const DEFAULT_CONFIG: ClientConfig = {
  apiBaseUrl: "http://localhost:3000/v1/api",
  tokenizationEnvironment: "simulator",
  publicKeys: {},
};

type FetchLike = (input: string) => Promise<Response>;

export async function loadConfig(fetchFn: FetchLike = fetch, url = "./config.json"): Promise<ClientConfig> {
  const response = await fetchFn(url);
  if (!response.ok) {
    return DEFAULT_CONFIG;
  }
  const loaded = (await response.json()) as Partial<ClientConfig>;
  return {
    apiBaseUrl: loaded.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl,
    tokenizationEnvironment: loaded.tokenizationEnvironment || DEFAULT_CONFIG.tokenizationEnvironment,
    publicKeys: { ...loaded.publicKeys },
  };
}
