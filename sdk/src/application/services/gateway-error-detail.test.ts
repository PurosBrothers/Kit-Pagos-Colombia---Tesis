import { Gateway } from "../../domain/value-objects/Gateway";
import { gatewayErrorDetail, withGatewayDetail } from "./gateway-error-detail";

/** Cuerpos de error medidos, de `docs/testing-data/`. */
const MEASURED = {
  kushkiAmountMismatch: {
    code: "K220",
    message: "Monto de la transacción es diferente al monto de la venta inicial",
  },
  wompiInvalidKey: { error: { type: "INVALID_ACCESS_TOKEN", reason: "Llave no válida" } },
  wompiValidation: {
    error: { type: "INPUT_VALIDATION_ERROR", messages: { signature: ["La firma es inválida"] } },
  },
  mercadoPagoOrders: {
    errors: [{ code: "empty_required_header", message: "Missing HTTP header: X-Idempotency-Key." }],
  },
  mercadoPagoCodeMessage: { code: "unauthorized", message: "user not found" },
  mercadoPagoWithCause: {
    message: "Must provide your access_token to proceed",
    error: "unauthorized",
    status: 401,
    cause: [{ code: 5 }],
  },
  mercadoPagoCauseCodeOnly: { message: "Header X-Idempotency-Key can't be null", cause: [{ code: 4292 }] },
  rapydNoProcessor: {
    status: {
      error_code: "ERROR_GET_GATEWAY",
      status: "ERROR",
      message: "Contact Rapyd Client Support.",
      response_code: "ERROR_GET_GATEWAY",
      operation_id: "5f0a7c1e-0000-4000-8000-000000000000",
    },
  },
};

describe("gatewayErrorDetail()", () => {
  it.each([
    [Gateway.KUSHKI, MEASURED.kushkiAmountMismatch, "K220: Monto de la transacción es diferente al monto de la venta inicial"],
    [Gateway.WOMPI, MEASURED.wompiInvalidKey, "INVALID_ACCESS_TOKEN: Llave no válida"],
    [Gateway.WOMPI, MEASURED.wompiValidation, "INPUT_VALIDATION_ERROR: signature: La firma es inválida"],
    [Gateway.MERCADOPAGO, MEASURED.mercadoPagoOrders, "empty_required_header: Missing HTTP header: X-Idempotency-Key."],
    [Gateway.MERCADOPAGO, MEASURED.mercadoPagoCodeMessage, "unauthorized: user not found"],
    [Gateway.MERCADOPAGO, MEASURED.mercadoPagoWithCause, "unauthorized: Must provide your access_token to proceed"],
    [Gateway.MERCADOPAGO, MEASURED.mercadoPagoCauseCodeOnly, "4292: Header X-Idempotency-Key can't be null"],
    [Gateway.RAPYD, MEASURED.rapydNoProcessor, "ERROR_GET_GATEWAY: Contact Rapyd Client Support."],
  ])("should read the measured %s body", (gateway, body, expected) => {
    expect(gatewayErrorDetail(gateway, body)).toBe(expected);
  });

  it("should list every field of a Wompi validation error", () => {
    const body = {
      error: { type: "INPUT_VALIDATION_ERROR", messages: { number: ["x", "y"], cvc: ["z"], empty: [] } },
    };

    expect(gatewayErrorDetail(Gateway.WOMPI, body)).toBe("INPUT_VALIDATION_ERROR: number: x, y; cvc: z");
  });

  it("should read a Wompi field whose reason comes as text instead of a list", () => {
    const body = { error: { type: "INPUT_VALIDATION_ERROR", messages: { reference: "Ya fue usada" } } };

    expect(gatewayErrorDetail(Gateway.WOMPI, body)).toBe("INPUT_VALIDATION_ERROR: reference: Ya fue usada");
  });

  it("should take the description of the first Mercado Pago cause when there is no message", () => {
    const body = { error: "not_found", cause: [{ code: 2000, description: "Payment not found" }] };

    expect(gatewayErrorDetail(Gateway.MERCADOPAGO, body)).toBe("not_found: Payment not found");
  });

  it("should keep only the code or only the reason when the body brings one", () => {
    expect(gatewayErrorDetail(Gateway.KUSHKI, { code: "K001" })).toBe("K001");
    expect(gatewayErrorDetail(Gateway.KUSHKI, { message: "Cuerpo de la petición inválido." })).toBe(
      "Cuerpo de la petición inválido.",
    );
  });

  it.each([
    ["an HTML page", "<html><body>502 Bad Gateway</body></html>"],
    ["null", null],
    ["an empty object", {}],
    ["a list", [MEASURED.kushkiAmountMismatch]],
    ["blank fields", { code: " ", message: "" }],
  ])("should give no detail for %s", (_label, body) => {
    expect(gatewayErrorDetail(Gateway.KUSHKI, body)).toBeUndefined();
  });

  it("should read each gateway with its own shape", () => {
    expect(gatewayErrorDetail(Gateway.RAPYD, MEASURED.kushkiAmountMismatch)).toBeUndefined();
    expect(gatewayErrorDetail(Gateway.WOMPI, MEASURED.rapydNoProcessor)).toBeUndefined();
    expect(gatewayErrorDetail(Gateway.KUSHKI, MEASURED.wompiInvalidKey)).toBeUndefined();
  });

  it("should give no detail for a gateway outside the table", () => {
    expect(gatewayErrorDetail("CUSTOM_GATEWAY" as Gateway, MEASURED.kushkiAmountMismatch)).toBeUndefined();
  });

  it("should cut a long detail at 300 characters", () => {
    const detail = gatewayErrorDetail(Gateway.KUSHKI, { code: "K999", message: "x".repeat(400) });

    expect(detail).toHaveLength(300);
    expect(detail?.endsWith("…")).toBe(true);
    expect(gatewayErrorDetail(Gateway.KUSHKI, { code: "K9", message: "x".repeat(296) })).toHaveLength(300);
  });
});

describe("withGatewayDetail()", () => {
  it("should append the detail in parentheses and leave the message alone without one", () => {
    expect(withGatewayDetail("HTTP 400", Gateway.KUSHKI, MEASURED.kushkiAmountMismatch)).toBe(
      "HTTP 400 (K220: Monto de la transacción es diferente al monto de la venta inicial)",
    );
    expect(withGatewayDetail("HTTP 502", Gateway.KUSHKI, "<html></html>")).toBe("HTTP 502");
  });
});
