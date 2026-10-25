import { readFileSync } from "node:fs";
import path from "node:path";

describe("Verificación Arquitectónica: Cero SDK en el Frontend", () => {
  const checkoutJsPath = path.resolve(__dirname, "..", "src", "public", "checkout.js");
  const checkoutJsContent = readFileSync(checkoutJsPath, "utf8");

  it("garantiza que checkout.js NO importa ni referencia kit-pagos-colombia/browser", () => {
    expect(checkoutJsContent).not.toContain("kit-pagos-colombia/browser");
    expect(checkoutJsContent).not.toContain("KitPagosBrowser");
    expect(checkoutJsContent).not.toContain("@kit-pagos");
  });

  it("al servidor del comercio solo le manda el token de la tarjeta, nunca el número ni el CVC", () => {
    const start = checkoutJsContent.indexOf("async function cardMethod");
    const cardMethod = checkoutJsContent.slice(start, checkoutJsContent.indexOf('form.addEventListener("submit"', start));

    expect(cardMethod.match(/return \{[^}]*\}/g)).toEqual([
      'return { type: "CARD", installments }',
      'return { type: "CARD", cardToken, installments }',
    ]);
    expect(checkoutJsContent).toContain("body: JSON.stringify({ gateway: gateway.id, items, payer, method })");
  });

  it("garantiza que checkout.js contiene la tokenización nativa directa para las pasarelas", () => {
    // Wompi directo
    expect(checkoutJsContent).toContain("Wompi");
    expect(checkoutJsContent).toContain("Authorization");
    // Mercado Pago directo
    expect(checkoutJsContent).toContain("MERCADOPAGO");
    expect(checkoutJsContent).toContain("card_number");
    // Kushki directo
    expect(checkoutJsContent).toContain("KUSHKI");
    expect(checkoutJsContent).toContain("Public-Merchant-Id");
    // Rapyd hosted
    expect(checkoutJsContent).toContain("RAPYD");
  });
});
