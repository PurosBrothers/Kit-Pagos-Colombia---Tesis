import { Gateway } from "kit-pagos-colombia";

/**
 * A dónde van las llamadas del SDK que arma la API, según su URL base.
 *
 * - `simulator`: los mocks de `/v1/sim/<pasarela>`, locales o desplegados.
 * - `sandbox`: el ambiente de pruebas real de la pasarela.
 * - `production`: todo lo demás, porque no se puede descartar que cobre dinero real.
 */
export type TargetEnvironment = "simulator" | "sandbox" | "production";

/**
 * Hosts de sandbox que publica cada pasarela.
 *
 * Mercado Pago no tiene ninguno: usa `api.mercadopago.com` para prueba y para
 * producción, y sus llaves de prueba empiezan con `APP_USR-`, igual que las de
 * producción (medido en el `.env` del proyecto). Como no hay forma de distinguirlos,
 * una URL real de Mercado Pago se trata como producción (punto 68).
 */
const SANDBOX_HOSTS: Readonly<Record<Gateway, readonly string[]>> = {
  [Gateway.WOMPI]: ["sandbox.wompi.co"],
  [Gateway.RAPYD]: ["sandboxapi.rapyd.net"],
  [Gateway.KUSHKI]: ["api-uat.kushkipagos.com"],
  [Gateway.MERCADOPAGO]: [],
};

/**
 * Clasifica la URL base con que se instancia el SDK para una pasarela.
 *
 * Sin URL es el simulador, porque ese es el valor por omisión de los cuatro
 * adaptadores (`http://localhost:3000/v1/sim/<pasarela>`). Una URL que no se puede
 * leer, o un host que no es un sandbox conocido, se trata como producción: ante la
 * duda, la API no presta las credenciales del servidor.
 */
export function classifyTarget(
  gateway: Gateway,
  baseUrl: string | undefined,
): TargetEnvironment {
  if (baseUrl === undefined) {
    return "simulator";
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "production";
  }

  const simulatorPath = `/v1/sim/${gateway.toLowerCase()}`;
  if (url.pathname.replace(/\/+$/, "").endsWith(simulatorPath)) {
    return "simulator";
  }

  if (url.protocol === "https:" && SANDBOX_HOSTS[gateway].includes(url.hostname)) {
    return "sandbox";
  }

  return "production";
}
