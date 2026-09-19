import * as fs from "fs";
import * as path from "path";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { Credentials } from "../../src/domain/value-objects/Credentials";

/**
 * Soporte para las pruebas de contrato contra los sandboxes reales.
 *
 * ## Qué son estas pruebas y por qué están separadas
 *
 * Las pruebas de `src/` no tocan la red: sustituyen `fetch` y afirman sobre respuestas
 * fijas. Eso las hace rápidas y deterministas, y es lo correcto para ellas, pero tiene un
 * límite que este proyecto ya pagó tres veces: **una prueba con `fetch` sustituido no puede
 * detectar que la pasarela cambió**, ni que la forma que el mock devuelve nunca fue la que
 * la pasarela devuelve. Los 18 defectos de los puntos 43, 44, 46, 48 y 50 del
 * `architecture-log.md` estaban todos con la suite en verde.
 *
 * Las pruebas de este directorio llaman a las APIs de verdad. Son el otro lado de esa
 * moneda: detectan lo que las unitarias no pueden, y a cambio son lentas, necesitan
 * credenciales, dependen de que el sandbox esté arriba y pueden fallar por motivos ajenos al
 * SDK. Por eso **no corren con `npm test`** —`jest.config.js` las excluye por nombre— sino
 * con `npm run test:sandbox`, y por eso la suite que se corre en cada cambio sigue siendo
 * hermética.
 *
 * ## Qué afirman y qué no
 *
 * Afirman que **la pasarela sigue aceptando lo que el SDK manda y devolviendo lo que el SDK
 * lee**. No afirman desenlaces: que un cobro termine aprobado depende del antifraude de una
 * cuenta de prueba y no del SDK, así que una prueba que lo exija falla por algo que no es un
 * defecto, y una prueba que falla por motivos ajenos se termina ignorando.
 *
 * Donde una decisión de diseño salió de un error medido, la prueba **afirma que ese error
 * sigue ocurriendo**. Suena al revés y es lo más valioso que hay acá: el día que Kushki
 * publique `POST /charges`, o que Mercado Pago deje de exigir las cuotas, la prueba lo dice y
 * la decisión se puede revisar con evidencia en vez de quedar como folclore del repositorio.
 */

/** Lee el `.env` de la raíz sin sumar una dependencia al SDK por una prueba. */
function loadRepoEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../../.env");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const entries: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    entries[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }
  return entries;
}

const env = { ...loadRepoEnv(), ...process.env };

/** Las URL de los sandboxes, con la misma convención que usa cada adaptador: la raíz. */
export const SANDBOX_BASE_URL: Record<Gateway, string> = {
  [Gateway.WOMPI]: "https://sandbox.wompi.co/v1",
  [Gateway.MERCADOPAGO]: "https://api.mercadopago.com/v1",
  [Gateway.KUSHKI]: "https://api-uat.kushkipagos.com",
  [Gateway.RAPYD]: "https://sandboxapi.rapyd.net/v1",
};

/**
 * Credenciales de cada pasarela, o `undefined` si el `.env` no las tiene.
 *
 * Devolver `undefined` en vez de fallar es lo que permite que quien clone el repositorio sin
 * credenciales vea las pruebas saltadas y no rotas. Una prueba roja por una credencial que
 * falta enseña a ignorar el rojo.
 */
export function sandboxCredentials(gateway: Gateway): Credentials | undefined {
  const pairs: Record<Gateway, [string | undefined, string | undefined]> = {
    [Gateway.WOMPI]: [env.WOMPI_PUBLIC_KEY, env.WOMPI_PRIVATE_KEY],
    [Gateway.MERCADOPAGO]: [
      env.MERCADOPAGO_PUBLIC_KEY,
      env.MERCADOPAGO_ACCESS_TOKEN,
    ],
    [Gateway.KUSHKI]: [
      env.KUSHKI_PUBLIC_MERCHANT_ID,
      env.KUSHKI_PRIVATE_MERCHANT_ID,
    ],
    [Gateway.RAPYD]: [env.RAPYD_API_ACCESS_KEY, env.RAPYD_API_SECRET_KEY],
  };

  const [publicKey, privateKey] = pairs[gateway];
  if (!publicKey || !privateKey) {
    return undefined;
  }

  const credentials: Credentials = { publicKey, privateKey };
  if (gateway === Gateway.WOMPI && env.WOMPI_INTEGRITY_SECRET) {
    // Wompi no crea ninguna transacción sin la firma de integridad, así que sin este
    // secreto las pruebas de cobro medirían un 422 y no el contrato (punto 50).
    credentials.integritySecret = env.WOMPI_INTEGRITY_SECRET;
  }
  return credentials;
}

/**
 * `describe` que se salta solo cuando faltan las credenciales de esa pasarela.
 *
 * El nombre del bloque dice contra qué URL corre, para que la salida de la suite sirva como
 * evidencia de qué se midió y no solo de que pasó.
 */
export function describeSandbox(
  gateway: Gateway,
  suite: (credentials: Credentials, baseUrl: string) => void,
): void {
  const credentials = sandboxCredentials(gateway);
  const baseUrl = SANDBOX_BASE_URL[gateway];
  const title = `${gateway} contra el sandbox real (${baseUrl})`;

  if (!credentials) {
    describe.skip(`${title} — saltado: faltan credenciales en .env`, () => {
      it("necesita credenciales", () => undefined);
    });
    return;
  }

  describe(title, () => suite(credentials, baseUrl));
}

/**
 * Referencia de orden única.
 *
 * Única por corrida y no fija, porque varias de estas pasarelas rechazan una referencia
 * repetida como pago duplicado, y una prueba que falla la segunda vez que se corre es una
 * prueba que nadie vuelve a correr.
 */
export function uniqueReference(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
