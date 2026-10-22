import { createPayments } from "../../src/payments";

/** Las llaves de sandbox de cada pasarela, con valores de mentira. */
const WOMPI_KEYS = { WOMPI_PUBLIC_KEY: "pub_test_x", WOMPI_PRIVATE_KEY: "prv_test_x", WOMPI_INTEGRITY_SECRET: "integrity_x" };

describe("the gateway registry of prototype A", () => {
  it("should offer, in the sandbox, only the gateways whose keys are in the environment", () => {
    const payments = createPayments(WOMPI_KEYS);

    expect(payments.listGateways()).toEqual([{ id: "wompi", name: "Wompi", cardCapture: "BROWSER_TOKEN" }]);
  });

  it("should stop at start-up and name the missing keys when no gateway can charge in the sandbox", () => {
    expect(() => createPayments({})).toThrow(/Wompi: WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_INTEGRITY_SECRET/);
  });

  it("should offer a gateway pointed elsewhere on purpose even without its keys", () => {
    const payments = createPayments({ WOMPI_BASE_URL: "http://localhost:3999/v1/sim/wompi" });

    expect(payments.listGateways().map((gateway) => gateway.id)).toEqual(["wompi"]);
  });

  it("should offer every gateway in the simulator", () => {
    const payments = createPayments({ CHECKOUT_ENVIRONMENT: "simulator" });

    expect(payments.listGateways().map((gateway) => gateway.id)).toEqual(["wompi"]);
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
