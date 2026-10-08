import * as crypto from "crypto";
import {
  kushkiSignature,
  mercadoPagoManifest,
  mercadoPagoSignature,
  rapydWebhookSignature,
  wompiChecksumInput,
  wompiEventChecksum,
} from "../src/webhooks/signatures";

/**
 * Las firmas del `SignatureGenerator` contra la documentación oficial (issue #122, paso 7;
 * issue #130, bloque 1).
 *
 * Ninguna pasarela publica un vector completo —entradas, secreto y firma resultante—
 * (revisado el 6 de octubre de 2026). Por eso:
 *
 * - Wompi: la prueba afirma exacta la concatenación publicada. El digest va **calculado**
 *   con `shasum -a 256`, no publicado: el que publica la documentación (`3476DDA5…`) no se
 *   reproduce con esa cadena (punto 67).
 * - Mercado Pago, Kushki y Rapyd: el esperado se calcula aquí con la fórmula documentada,
 *   escrita de nuevo con `crypto` y sin pasar por el código que se prueba.
 */
describe("webhook signatures, against the official formulas", () => {
  // https://docs.wompi.co/docs/colombia/eventos/
  it("Wompi: concatenates the documented example exactly; the SHA-256 is calculated, not published", () => {
    const values = ["1234-1610641025-49201", "APPROVED", 4490000];
    const secret = "prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z";

    expect(wompiChecksumInput(values, 1530291411, secret)).toBe(
      "1234-1610641025-49201APPROVED44900001530291411prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z",
    );
    expect(wompiEventChecksum(values, 1530291411, secret)).toBe(
      "5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe",
    );
  });

  // https://www.mercadopago.com.co/developers/es/docs/your-integrations/notifications/webhooks
  it("Mercado Pago: HMAC-SHA256 hex of id:[data.id];request-id:[x-request-id];ts:[ts]; with data.id in lowercase", () => {
    const manifest = mercadoPagoManifest("ORD01ABC", "req-1", "1742505638683");
    const expected = crypto
      .createHmac("sha256", "mp_secret")
      .update("id:ord01abc;request-id:req-1;ts:1742505638683;")
      .digest("hex");

    expect(manifest).toBe("id:ord01abc;request-id:req-1;ts:1742505638683;");
    expect(mercadoPagoSignature("ORD01ABC", "req-1", "1742505638683", "mp_secret")).toBe(expected);
  });

  // https://docs.kushki.com/co/notifications/overview
  it("Kushki: HMAC-SHA256 hex of `${body}.${x-kushki-id}`", () => {
    const body = '{"transaction_id":"1","transaction_status":"APPROVAL"}';
    const expected = crypto.createHmac("sha256", "kushki_secret").update(`${body}.1601587937`).digest("hex");

    expect(kushkiSignature(body, "1601587937", "kushki_secret")).toBe(expected);
  });

  // https://docs.rapyd.net/en/webhook-authentication.html
  it("Rapyd: base64 of the hex HMAC-SHA256 of url + salt + timestamp + access_key + secret + body", () => {
    const parts = {
      webhookUrl: "https://comercio.example.com/webhooks/rapyd",
      salt: "salt123",
      timestamp: "1700000000",
      accessKey: "access",
      secret: "secret",
      body: '{"type":"PAYMENT_COMPLETED"}',
    };
    const hex = crypto
      .createHmac("sha256", "secret")
      .update('https://comercio.example.com/webhooks/rapydsalt1231700000000accesssecret{"type":"PAYMENT_COMPLETED"}')
      .digest("hex");

    expect(rapydWebhookSignature(parts)).toBe(Buffer.from(hex).toString("base64"));
  });
});
