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

  it("extrae la redirección cuando Rapyd entrega redirect_url", () => {
    const redirect = extractRapydRedirect(respuesta3ds);

    expect(redirect).not.toBeNull();
    expect(redirect?.redirectUrl).toBe(
      "https://sandbox.rapyd.net/v1/checkout/3ds/payment_3ds_abc123",
    );
    expect(redirect?.rawStatus).toBe("ACT");
  });

  it("conserva el identificador para poder consultar el pago después", () => {
    // Sin él, un pago redirigido sería irrastreable si el pagador nunca vuelve.
    const redirect = extractRapydRedirect(respuesta3ds);

    expect(redirect?.gatewayTransactionId.value).toBe("payment_3ds_abc123");
    expect(redirect?.gatewayTransactionId.gateway).toBe(Gateway.RAPYD);
  });

  it("no reporta redirección en un pago normal sin redirect_url", () => {
    const aprobado = {
      status: { status: "SUCCESS" },
      data: { id: "payment_ok", status: "CLO", paid: true },
    };

    expect(extractRapydRedirect(aprobado)).toBeNull();
  });

  it("no reporta redirección cuando redirect_url viene vacía", () => {
    // Rapyd incluye la clave con string vacío en los pagos que no la necesitan;
    // tratar la presencia de la clave como señal daría falsos positivos.
    const conUrlVacia = {
      data: { id: "payment_ok", status: "CLO", redirect_url: "" },
    };

    expect(extractRapydRedirect(conUrlVacia)).toBeNull();
  });

  it("no reporta redirección cuando falta el id, para no mandar al pagador a un pago irrastreable", () => {
    const sinId = {
      data: { status: "ACT", redirect_url: "https://sandbox.rapyd.net/3ds/x" },
    };

    expect(extractRapydRedirect(sinId)).toBeNull();
  });

  it("tolera respuestas sin envoltorio data sin lanzar", () => {
    expect(extractRapydRedirect(null)).toBeNull();
    expect(extractRapydRedirect({})).toBeNull();
    expect(extractRapydRedirect({ status: { status: "ERROR" } })).toBeNull();
  });
});
