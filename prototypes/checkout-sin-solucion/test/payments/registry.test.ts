import { createPayments } from "../../src/payments";

/** Las llaves de sandbox de cada pasarela, con valores de mentira. */
const WOMPI_KEYS = { WOMPI_PUBLIC_KEY: "pub_test_x", WOMPI_PRIVATE_KEY: "prv_test_x", WOMPI_INTEGRITY_SECRET: "integrity_x" };

describe("the gateway registry of prototype D", () => {
  it("should offer, in the sandbox, only the gateways whose keys are in the environment", () => {
    const payments = createPayments(WOMPI_KEYS);

    expect(payments.listGateways()).toEqual([{ id: "wompi", name: "Wompi", cardCapture: "BROWSER_TOKEN" }]);
  });

  it("should stop at start-up and name the missing keys when no gateway can charge in the sandbox", () => {
    expect(() => createPayments({})).toThrow(/Wompi: WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_INTEGRITY_SECRET/);
    expect(() => createPayments({})).toThrow(/Mercado Pago: MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_PUBLIC_KEY/);
    expect(() => createPayments({})).toThrow(/Kushki: KUSHKI_PUBLIC_MERCHANT_ID, KUSHKI_PRIVATE_MERCHANT_ID/);
    expect(() => createPayments({})).toThrow(/Rapyd: RAPYD_API_ACCESS_KEY, RAPYD_API_SECRET_KEY/);
  });

  it("should offer Rapyd in the sandbox as a gateway that takes the card in its own page", () => {
    const payments = createPayments({ RAPYD_API_ACCESS_KEY: "access", RAPYD_API_SECRET_KEY: "secret" });

    expect(payments.listGateways()).toEqual([{ id: "rapyd", name: "Rapyd", cardCapture: "HOSTED_PAGE" }]);
    expect(payments.publicConfig("rapyd")).toEqual({ gateway: "rapyd" });
  });

  it("should offer Kushki in the sandbox with its two merchant ids", () => {
    const payments = createPayments({ KUSHKI_PUBLIC_MERCHANT_ID: "pub", KUSHKI_PRIVATE_MERCHANT_ID: "priv" });

    expect(payments.listGateways()).toEqual([{ id: "kushki", name: "Kushki", cardCapture: "BROWSER_TOKEN" }]);
    expect(payments.publicConfig("kushki")).toEqual({ gateway: "kushki", publicKey: "pub", baseUrl: "https://api-uat.kushkipagos.com" });
  });

  it("should offer Mercado Pago in the sandbox with its access token and public key", () => {
    const payments = createPayments({ MERCADOPAGO_ACCESS_TOKEN: "APP_USR-x", MERCADOPAGO_PUBLIC_KEY: "APP_USR-y" });

    expect(payments.listGateways()).toEqual([{ id: "mercadopago", name: "Mercado Pago", cardCapture: "BROWSER_TOKEN" }]);
    expect(payments.publicConfig("mercadopago")).toEqual({
      gateway: "mercadopago",
      publicKey: "APP_USR-y",
      baseUrl: "https://api.mercadopago.com/v1",
    });
  });

  it("should offer a gateway pointed elsewhere on purpose even without its keys", () => {
    const payments = createPayments({ WOMPI_BASE_URL: "http://localhost:3999/v1/sim/wompi" });

    expect(payments.listGateways().map((gateway) => gateway.id)).toEqual(["wompi"]);
  });

  it("should offer every gateway in the simulator", () => {
    const payments = createPayments({ CHECKOUT_ENVIRONMENT: "simulator" });

    expect(payments.listGateways().map((gateway) => gateway.id)).toEqual(["wompi", "mercadopago", "kushki", "rapyd"]);
  });

  it("should tell the browser which gateway its public configuration is for", () => {
    const payments = createPayments(WOMPI_KEYS);

    expect(payments.publicConfig("wompi")).toEqual(expect.objectContaining({ gateway: "wompi", publicKey: "pub_test_x" }));
  });

  it("should refuse a gateway it does not offer", async () => {
    const payments = createPayments(WOMPI_KEYS);

    expect(() => payments.publicConfig("stripe")).toThrow("El checkout no cobra con la pasarela «stripe»");
    expect(() => payments.listPseBanks("stripe")).toThrow("El checkout no cobra con la pasarela «stripe»");
  });
});
