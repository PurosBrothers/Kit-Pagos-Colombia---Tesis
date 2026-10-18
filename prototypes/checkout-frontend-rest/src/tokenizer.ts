/**
 * El módulo de navegador del SDK, cargado desde jsDelivr en vez de instalarlo (punto 91 del
 * `architecture-log.md`). La versión va fija: con un rango, la tarjeta del pagador quedaría en
 * manos de la próxima versión que se publique, sin que nadie la revise.
 */
export const KIT_PAGOS_BROWSER_URL =
  "https://cdn.jsdelivr.net/npm/kit-pagos-colombia@0.6.0-rc.4/dist/browser/index.js";

export interface CardInput {
  number: string;
  cvc: string;
  expMonth: string;
  expYear: string;
  cardHolder: string;
  docType?: string;
  docNumber?: string;
}

export interface TokenizeCardParams {
  gateway: string;
  publicKey: string;
  card: CardInput;
  environment: string;
  /** El monto del cobro: hay pasarelas que atan el token a él, y las demás lo ignoran. */
  amount: string;
  currency: string;
}

/** La parte de `KitPagosBrowser` que usa este cliente. */
export interface CardTokenizer {
  tokenizeCard(params: TokenizeCardParams): Promise<{ token: string }>;
}

type ModuleImporter = (url: string) => Promise<{ KitPagosBrowser: CardTokenizer }>;

const importFromCdn: ModuleImporter = (url) => import(/* @vite-ignore */ url);

/**
 * Se importa al pagar con tarjeta y no al cargar la página: el cobro con PSE no descarga
 * ningún código del SDK.
 */
export async function loadCardTokenizer(importer: ModuleImporter = importFromCdn): Promise<CardTokenizer> {
  const module = await importer(KIT_PAGOS_BROWSER_URL);
  return module.KitPagosBrowser;
}
