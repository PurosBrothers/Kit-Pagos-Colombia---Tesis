import { Gateway } from "../../../domain/value-objects/Gateway";
import { extractRapydRedirect } from "./rapyd-redirect";

describe("extractRapydRedirect", () => {
  /**
   * Respuesta de Rapyd cuando el pago dispara 3DS: el pago existe y está activo,
   * pero no avanza hasta que el pagador visite `redirect_url`. Documentada en
   * docs/testing-data/rapyd.md, sección 3.
   */
  const respuesta3ds = {
    status: { status: "SUCCESS", error_code: "" },
    data: {
      id: "payment_3ds_abc123",
      status: "ACT",
      paid: false,
      amount: "150000.00",
      currency_code: "COP",
      next_action: "3d_verification",
      redirect_url: "https://sandbox.rapyd.net/v1/checkout/3ds/payment_3ds_abc123",
    },
  };

  it("extracts the redirect when Rapyd provides redirect_url", () => {
    const redirect = extractRapydRedirect(respuesta3ds);

    expect(redirect).not.toBeNull();
    expect(redirect?.redirectUrl).toBe(
      "https://sandbox.rapyd.net/v1/checkout/3ds/payment_3ds_abc123",
    );
    expect(redirect?.rawStatus).toBe("ACT");
  });

  it("keeps the identifier so the payment can be queried later", () => {
    // Sin él, un pago redirigido sería irrastreable si el pagador nunca vuelve.
    const redirect = extractRapydRedirect(respuesta3ds);

    expect(redirect?.gatewayTransactionId.value).toBe("payment_3ds_abc123");
    expect(redirect?.gatewayTransactionId.gateway).toBe(Gateway.RAPYD);
  });

  it("does not report a redirect for a normal payment without redirect_url", () => {
    const approvedPayment = {
      status: { status: "SUCCESS" },
      data: { id: "payment_ok", status: "CLO", paid: true },
    };

    expect(extractRapydRedirect(approvedPayment)).toBeNull();
  });

  it("does not report a redirect when redirect_url is empty", () => {
    // Rapyd incluye la clave con string vacío en los pagos que no la necesitan;
    // tratar la presencia de la clave como señal daría falsos positivos.
    const withEmptyUrl = {
      data: { id: "payment_ok", status: "CLO", redirect_url: "" },
    };

    expect(extractRapydRedirect(withEmptyUrl)).toBeNull();
  });

  it("does not report a redirect when the id is missing, so the payer is not sent to an untraceable payment", () => {
    const withoutId = {
      data: { status: "ACT", redirect_url: "https://sandbox.rapyd.net/3ds/x" },
    };

    expect(extractRapydRedirect(withoutId)).toBeNull();
  });

  it("tolerates responses without a data envelope without throwing", () => {
    expect(extractRapydRedirect(null)).toBeNull();
    expect(extractRapydRedirect({})).toBeNull();
    expect(extractRapydRedirect({ status: { status: "ERROR" } })).toBeNull();
  });
});
