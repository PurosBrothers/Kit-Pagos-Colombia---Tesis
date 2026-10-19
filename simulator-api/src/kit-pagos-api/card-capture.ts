import { Gateway } from "kit-pagos-colombia";

/**
 * Cómo recibe la tarjeta cada pasarela cuando el cobro empieza en un navegador, para que un
 * cliente de `/v1/api` sepa qué hacer sin nombrar pasarelas (punto 106 del `architecture-log.md`):
 *
 * - `BROWSER_TOKEN`: la página tokeniza con `KitPagosBrowser` y la llave pública de la
 *   pasarela, y manda el token en `paymentMethod.token`.
 * - `HOSTED_PAGE`: el pago con tarjeta se crea sin token y responde `REDIRECT_REQUIRED` hacia
 *   la página de la pasarela, donde el pagador escribe la tarjeta.
 *
 * El tipo obliga a declarar cada pasarela del SDK, y `test/card-capture.test.ts` comprueba
 * contra el simulador que cada valor describe lo que la pasarela hace con una tarjeta sin token.
 */
export type CardCapture = "BROWSER_TOKEN" | "HOSTED_PAGE";

export const CARD_CAPTURE_VALUES: readonly CardCapture[] = ["BROWSER_TOKEN", "HOSTED_PAGE"];

const CARD_CAPTURE: Readonly<Record<Gateway, CardCapture>> = {
  [Gateway.WOMPI]: "BROWSER_TOKEN",
  [Gateway.MERCADOPAGO]: "BROWSER_TOKEN",
  [Gateway.KUSHKI]: "BROWSER_TOKEN",
  [Gateway.RAPYD]: "HOSTED_PAGE",
};

/** El modo de cada pasarela con el identificador en minúsculas, como lo usa `/v1/api`. */
export function cardCaptureByGateway(): Record<string, CardCapture> {
  return Object.fromEntries(
    Object.entries(CARD_CAPTURE).map(([gateway, capture]) => [gateway.toLowerCase(), capture]),
  );
}
