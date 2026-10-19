import { buildApp } from "../src/app";
import {
  KUSHKI_TOKENIZATION_PREFLIGHT_HEADERS,
  MERCADOPAGO_TOKENIZATION_PREFLIGHT_HEADERS,
  WOMPI_TOKENIZATION_PREFLIGHT_HEADERS,
} from "../src/gateways/tokenizationCors";

// El origen de la página del comercio con el que se midió el 13 de octubre de 2026 (punto 89).
const MERCHANT_ORIGIN = "http://localhost:4000";

const WOMPI_TOKENS = "/v1/sim/wompi/tokens/cards";
const MERCADOPAGO_TOKENS = "/v1/sim/mercadopago/card_tokens";

const wompiCard = { number: "4242424242424242", cvc: "123", exp_month: "12", exp_year: "30", card_holder: "Pedro Perez" };
const mercadoPagoCard = {
  card_number: "4013540682746260",
  expiration_month: 11,
  expiration_year: 2030,
  security_code: "123",
  cardholder: { name: "APRO", identification: { type: "CC", number: "19119119100" } },
};

function preflight(url: string, requestHeaders: string) {
  return {
    method: "OPTIONS" as const,
    url,
    headers: {
      origin: MERCHANT_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": requestHeaders,
    },
  };
}

function accessControlHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => key.startsWith("access-control-")));
}

describe("CORS of the card tokenization routes (point 89)", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  describe("Wompi POST /v1/sim/wompi/tokens/cards", () => {
    it("should answer the browser preflight with 200 and exactly the measured headers", async () => {
      const res = await app.inject(preflight(WOMPI_TOKENS, "authorization,content-type"));

      expect(res.statusCode).toBe(200);
      expect(accessControlHeaders(res.headers)).toEqual(WOMPI_TOKENIZATION_PREFLIGHT_HEADERS);
    });

    it("should open the origin on the token response", async () => {
      const res = await app.inject({
        method: "POST",
        url: WOMPI_TOKENS,
        headers: { origin: MERCHANT_ORIGIN, authorization: "Bearer pub_test_abc" },
        payload: wompiCard,
      });

      expect(res.statusCode).toBe(201);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("should open the origin on an error too, as the measured 401 without a key does", async () => {
      const res = await app.inject({
        method: "POST",
        url: WOMPI_TOKENS,
        headers: { origin: MERCHANT_ORIGIN },
        payload: wompiCard,
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });
  });

  describe("Mercado Pago POST /v1/sim/mercadopago/card_tokens", () => {
    it("should answer the browser preflight with 200 and exactly the measured headers", async () => {
      const res = await app.inject(preflight(`${MERCADOPAGO_TOKENS}?public_key=TEST-pub-key`, "content-type"));

      expect(res.statusCode).toBe(200);
      expect(accessControlHeaders(res.headers)).toEqual(MERCADOPAGO_TOKENIZATION_PREFLIGHT_HEADERS);
    });

    it("should open the origin on the token response", async () => {
      const res = await app.inject({
        method: "POST",
        url: `${MERCADOPAGO_TOKENS}?public_key=TEST-pub-key`,
        headers: { origin: MERCHANT_ORIGIN },
        payload: mercadoPagoCard,
      });

      expect(res.statusCode).toBe(201);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("should open the origin on an error too, as the real API does on the measured 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: MERCADOPAGO_TOKENS,
        headers: { origin: MERCHANT_ORIGIN },
        payload: mercadoPagoCard,
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });
  });

  describe("Kushki POST /v1/sim/kushki/card/v1/tokens (point 106)", () => {
    const KUSHKI_TOKENS = "/v1/sim/kushki/card/v1/tokens";
    const kushkiCard = {
      card: { name: "APRO Ruiz", number: "4242424242424242", cvv: "123", expiryMonth: "11", expiryYear: "30" },
      totalAmount: 48000,
      currency: "COP",
    };

    it("should answer the browser preflight with 200 and exactly the measured headers", async () => {
      const res = await app.inject(preflight(KUSHKI_TOKENS, "content-type,public-merchant-id"));

      expect(res.statusCode).toBe(200);
      expect(accessControlHeaders(res.headers)).toEqual(KUSHKI_TOKENIZATION_PREFLIGHT_HEADERS);
    });

    it("should open the origin on the token response", async () => {
      const res = await app.inject({
        method: "POST",
        url: KUSHKI_TOKENS,
        headers: { origin: MERCHANT_ORIGIN, "public-merchant-id": "kushki_public_sim" },
        payload: kushkiCard,
      });

      expect(res.statusCode).toBe(201);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("should open the origin on a 400 too, as the measured K004 does", async () => {
      const res = await app.inject({
        method: "POST",
        url: KUSHKI_TOKENS,
        headers: { origin: MERCHANT_ORIGIN, "public-merchant-id": "kushki_invalid" },
        payload: kushkiCard,
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("should not open the origin on the 401 without merchant id, which the real API sends without CORS", async () => {
      const res = await app.inject({
        method: "POST",
        url: KUSHKI_TOKENS,
        headers: { origin: MERCHANT_ORIGIN },
        payload: kushkiCard,
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should keep the charge route, which only a backend calls, without CORS", async () => {
      const res = await app.inject(preflight("/v1/sim/kushki/card/v1/charges", "content-type,private-merchant-id"));

      expect(res.statusCode).toBe(404);
      expect(accessControlHeaders(res.headers)).toEqual({});
    });
  });

  describe("the rest of /v1/sim", () => {
    it("should keep answering a preflight to a backend-only route with 404 and no CORS headers", async () => {
      const res = await app.inject(preflight("/v1/sim/wompi/transactions", "authorization,content-type"));

      expect(res.statusCode).toBe(404);
      expect(accessControlHeaders(res.headers)).toEqual({});
    });

    it("should not open the origin on a backend-only route", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/sim/mercadopago/payment_methods",
        headers: { origin: MERCHANT_ORIGIN, authorization: "Bearer APP_USR_TEST_TOKEN" },
      });

      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});
