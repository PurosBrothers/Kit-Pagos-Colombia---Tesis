import type { FastifyInstance } from "fastify";
import { renderBankPage } from "../src/gateways/bankPage";
import { buildSignedApp } from "./helpers/signedRequests";
import { wompiTransactions } from "../src/store/GatewayStores";
import { bankReturnUrlFor, rememberBankReturnUrl, withQueryParam } from "../src/store/BankReturnUrls";

/**
 * La página de banco del PSE en las cuatro pasarelas (issue #109).
 *
 * Antes, Mercado Pago, Kushki y Rapyd publicaban la URL de su dominio real con un id que el
 * simulador inventó: «Esta página no existe», un error de DNS y una página que no reconocía el
 * pago. Estas pruebas fijan que la URL apunta al simulador, que la página existe y que devuelve
 * al pagador a la URL que pidió el comercio.
 */
const RETURN_URL = "https://comercio.example.com/retorno";
const HOST = "simulator.example.com:8443";
const ORIGIN = `http://${HOST}`;

interface BankRedirect {
  url: string;
  /** El valor que el comercio no debe ver reflejado en la página. */
  identifier: string;
  /** El enlace que la página debe ofrecer: la URL del comercio, con lo que la pasarela agregue. */
  returnHref?: string;
}

async function wompiRedirect(app: FastifyInstance, redirectUrl: string | null = RETURN_URL) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/sim/wompi/transactions",
    headers: { host: HOST },
    payload: {
      amount_in_cents: 15000000,
      currency: "COP",
      reference: "orden-pse-pagina",
      customer_email: "cliente@example.com",
      ...(redirectUrl === null ? {} : { redirect_url: redirectUrl }),
      payment_method: {
        type: "PSE",
        user_type: 0,
        user_legal_id_type: "CC",
        user_legal_id: "1099888777",
        financial_institution_code: "1",
        payment_description: "Pago orden-pse-pagina",
      },
    },
  });
  const { id } = created.json().data;
  const read = await app.inject({ method: "GET", url: `/v1/sim/wompi/transactions/${id}` });
  return {
    url: read.json().data.payment_method.extra.async_payment_url,
    identifier: id.replace(/-/g, ""),
    transactionId: id,
  };
}

async function mercadopagoRedirect(
  app: FastifyInstance,
  callbackUrl: string = RETURN_URL,
): Promise<BankRedirect> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/sim/mercadopago/orders",
    headers: { host: HOST, "x-idempotency-key": "prueba-pagina-banco" },
    payload: {
      type: "online",
      total_amount: "150000",
      external_reference: "orden-mp-pagina",
      processing_mode: "automatic",
      payer: {
        email: "cliente@example.com",
        entity_type: "individual",
        identification: { type: "CC", number: "1099888777" },
        first_name: "Juan",
        last_name: "Perez Gomez",
        phone: { area_code: "57", number: "3001234567" },
        address: {
          street_name: "Calle 10",
          street_number: "100",
          city: "Bogota",
          zip_code: "110111",
          neighborhood: "Centro",
        },
      },
      transactions: {
        payments: [
          {
            amount: "150000",
            payment_method: { id: "pse", type: "bank_transfer", financial_institution: "1051" },
          },
        ],
      },
      additional_info: { "payer.ip_address": "200.100.50.25" },
      config: { online: { callback_url: callbackUrl } },
    },
  });
  const payment = created.json().transactions.payments[0];
  const url: string = payment.payment_method.redirect_url;
  const bankId = new URL(url).pathname.split("/")[5];
  const separator = callbackUrl.includes("?") ? "&" : "?";
  return { url, identifier: payment.id, returnHref: `${callbackUrl}${separator}payment_id=${bankId}` };
}

async function kushkiRedirect(app: FastifyInstance): Promise<BankRedirect> {
  const issued = await app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/tokens",
    payload: { bankId: "007", callbackUrl: RETURN_URL },
  });
  const { token } = issued.json();
  const init = await app.inject({
    method: "POST",
    url: "/v1/sim/kushki/transfer/v1/init",
    headers: { host: HOST },
    payload: {
      token,
      amount: { subtotalIva: 0, subtotalIva0: 150000, iva: 0, currency: "COP" },
    },
  });
  return { url: init.json().redirectUrl, identifier: token };
}

async function rapydRedirect(app: FastifyInstance): Promise<BankRedirect> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/sim/rapyd/payments",
    headers: { host: HOST },
    payload: {
      amount: "150000.00",
      currency: "COP",
      merchant_reference_id: "ord-1",
      customer: "cus_abc",
      payment_method: { type: "co_pse_bancolombia_bank" },
      complete_payment_url: RETURN_URL,
      error_payment_url: "https://comercio.example.com/error",
    },
  });
  const { data } = created.json();
  return { url: data.redirect_url, identifier: data.id };
}

function pathAndQuery(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

describe("the PSE bank page", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildSignedApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const gateways: Array<[string, string, (app: FastifyInstance) => Promise<BankRedirect>, RegExp]> = [
    [
      "mercadopago",
      "Mercado Pago",
      mercadopagoRedirect,
      /^\/v1\/sim\/mercadopago\/payments\/[1-9][0-9]{11}\/bank_transfer$/,
    ],
    ["kushki", "Kushki", kushkiRedirect, /^\/v1\/sim\/kushki\/transfer\/v1\/agent$/],
    ["rapyd", "Rapyd", rapydRedirect, /^\/v1\/sim\/rapyd\/complete-bank-payment$/],
  ];

  describe.each(gateways)("%s", (_gateway, displayName, redirectFor, route) => {
    it("publishes a URL on the simulator, with the path measured against the gateway", async () => {
      const { url } = await redirectFor(app);

      expect(new URL(url).origin).toBe(ORIGIN);
      expect(new URL(url).pathname).toMatch(route);
    });

    it("serves the page it publishes, and says it is simulated", async () => {
      const { url } = await redirectFor(app);

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(page.statusCode).toBe(200);
      expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(page.body).toContain("Redirección simulada al banco");
      expect(page.body).toContain(`No es de ${displayName} ni de un banco`);
    });

    it("sends the payer back to the URL the merchant asked for", async () => {
      const { url, returnHref } = await redirectFor(app);

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(page.body).toContain(`<a href="${returnHref ?? RETURN_URL}">Volver al comercio</a>`);
    });

    it("does not echo the identifier that came in the URL", async () => {
      const { url, identifier } = await redirectFor(app);

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(page.body).not.toContain(identifier);
    });

    it("answers a page without a link for a payment it does not know", async () => {
      const { url } = await redirectFor(app);
      const unknown = pathAndQuery(url)
        .replace(/\/payments\/\d+\//, "/payments/999999999999/")
        .replace(/(token=|payment_)[0-9A-Za-z]+/, "$1desconocido");

      const page = await app.inject({ method: "GET", url: unknown });

      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("El comercio no indicó a dónde devolver al pagador");
      expect(page.body).not.toContain("<a ");
    });

    it("is published on SIMULATOR_PUBLIC_ORIGIN when it is configured", async () => {
      await app.close();
      app = buildSignedApp({ publicOrigin: "https://kit-pagos-colombia.onrender.com" });
      await app.ready();

      const { url } = await redirectFor(app);

      expect(new URL(url).origin).toBe("https://kit-pagos-colombia.onrender.com");
    });
  });

  describe("mercadopago", () => {
    it("publishes the numeric id the real URL carries, and not the PAY id of the payment", async () => {
      const { url, identifier } = await mercadopagoRedirect(app);

      expect(new URL(url).pathname).toMatch(/\/payments\/[1-9][0-9]{11}\/bank_transfer$/);
      expect(url).not.toContain(identifier);
    });

    it("adds payment_id to the callback_url, as the real return does", async () => {
      const { url, returnHref } = await mercadopagoRedirect(app);

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(returnHref).toMatch(/^https:\/\/comercio\.example\.com\/retorno\?payment_id=[1-9][0-9]{11}$/);
      expect(page.body).toContain(`<a href="${returnHref}">Volver al comercio</a>`);
    });

    it("keeps the query the merchant already had on the callback_url", async () => {
      const { url, returnHref } = await mercadopagoRedirect(app, "https://comercio.example.com/retorno?orden=7");

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(returnHref).toContain("?orden=7&payment_id=");
      // En el atributo HTML el `&` va escapado, y el navegador lo lee como `&`.
      expect(page.body).toContain(`<a href="${returnHref?.replace("&", "&amp;")}">Volver al comercio</a>`);
    });

    it("does not link a callback_url that is not http or https, even with payment_id added", async () => {
      const { url } = await mercadopagoRedirect(app, "javascript:alert(1)");

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(page.body).not.toContain("<a ");
      expect(page.body).not.toContain("javascript:");
    });
  });

  describe("wompi", () => {
    it("sends the payer back to the redirect_url of the transaction", async () => {
      const { url } = await wompiRedirect(app);

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(page.statusCode).toBe(200);
      expect(page.body).toContain(`<a href="${RETURN_URL}">Volver al comercio</a>`);
    });

    it("says so when the merchant sent no redirect_url", async () => {
      const { url } = await wompiRedirect(app, null);

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(page.body).toContain("El comercio no indicó a dónde devolver al pagador");
      expect(page.body).not.toContain("<a ");
    });

    it("does not echo the ticket id", async () => {
      const { url, identifier } = await wompiRedirect(app);

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(page.body).not.toContain(identifier);
    });

    it("answers a page without a link for a ticket it does not know, and without a ticket", async () => {
      await wompiRedirect(app);

      const unknown = await app.inject({ method: "GET", url: "/v1/sim/wompi/pse/redirect?ticket_id=nope" });
      const none = await app.inject({ method: "GET", url: "/v1/sim/wompi/pse/redirect" });

      for (const page of [unknown, none]) {
        expect(page.statusCode).toBe(200);
        expect(page.body).toContain("El comercio no indicó a dónde devolver al pagador");
      }
    });

    it("moves nothing: the transaction is still PENDING after the visit", async () => {
      const { url, transactionId } = await wompiRedirect(app);

      await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(wompiTransactions.findById(transactionId)?.status).toBe("PENDING");
    });

    it("never turns a return URL that is not http or https into a link", async () => {
      const { url } = await wompiRedirect(app, "javascript:alert(document.domain)");

      const page = await app.inject({ method: "GET", url: pathAndQuery(url) });

      expect(page.body).not.toContain("javascript:");
      expect(page.body).not.toContain("<a ");
    });
  });

  describe("the markup", () => {
    it.each([
      ["javascript", "javascript:alert(1)"],
      ["data", "data:text/html,<script>alert(1)</script>"],
      ["file", "file:///etc/passwd"],
      ["a string that is not a URL", "no es una url"],
      ["an empty string", ""],
    ])("leaves out a return URL that is %s", (_case, value) => {
      const html = renderBankPage("wompi", value);

      expect(html).not.toContain("<a ");
      expect(html).toContain("El comercio no indicó a dónde devolver al pagador");
    });

    it("escapes the characters that would close the attribute or open a tag", () => {
      const html = renderBankPage("wompi", `https://comercio.example.com/r?a=1&b="x"<y>'z'`);

      expect(html).toContain("&amp;b=");
      expect(html).not.toContain('"x"');
      expect(html).not.toContain("<y>");
      expect(html.match(/<a /g)).toHaveLength(1);
    });
  });

  describe("the registry of return URLs", () => {
    it("keeps the URL of each gateway apart when two gateways use the same identifier", () => {
      rememberBankReturnUrl("wompi", "mismo-id", "https://uno.example.com/");
      rememberBankReturnUrl("kushki", "mismo-id", "https://dos.example.com/");

      expect(bankReturnUrlFor("wompi", "mismo-id")).toBe("https://uno.example.com/");
      expect(bankReturnUrlFor("kushki", "mismo-id")).toBe("https://dos.example.com/");
    });

    it("adds a query parameter to a URL, keeping the one it already has", () => {
      expect(withQueryParam("https://comercio.example.com/r", "payment_id", "1")).toBe("https://comercio.example.com/r?payment_id=1");
      expect(withQueryParam("https://comercio.example.com/r?a=2", "payment_id", "1")).toBe("https://comercio.example.com/r?a=2&payment_id=1");
    });

    it("returns no URL when the merchant sent none, and leaves a value that is not a URL as it came", () => {
      expect(withQueryParam(undefined, "payment_id", "1")).toBeUndefined();
      expect(withQueryParam("", "payment_id", "1")).toBeUndefined();
      expect(withQueryParam("esto no es una URL", "payment_id", "1")).toBe("esto no es una URL");
    });
  });
});
