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
