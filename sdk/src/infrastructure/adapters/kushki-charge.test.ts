import {
  CARD_CHARGE_PATH,
  buildCardChargePayload,
  reclassifyKushkiCredentialError,
} from "./kushki-charge";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Gateway } from "../../domain/value-objects/Gateway";

describe("kushki-charge", () => {
  const baseRequest: CreatePaymentRequest = {
    amount: new Amount("50000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-12345"),
    payer: new Payer({ email: "cliente@example.com" }),
    paymentMethod: PaymentMethod.card("kushki-card-token-abc"),
  };

  /**
   * La ruta vieja no era un detalle: `POST /charges` responde `403 Forbidden` contra
   * api-uat.kushkipagos.com, lo mismo que una ruta inventada, así que el cobro con
   * tarjeta nunca habría funcionado fuera del simulador.
   */
  it("charges on the route that really exists", () => {
    expect(CARD_CHARGE_PATH).toBe("/card/v1/charges");
  });

  it("sends the merchant token and not a literal", () => {
    const payload = buildCardChargePayload(baseRequest);

    expect(payload.token).toBe("kushki-card-token-abc");
    expect(JSON.stringify(payload)).not.toContain("simulated-token");
  });

  it("asks for fullResponse, because without it the response is not enough for a Transaction", () => {
    expect(buildCardChargePayload(baseRequest).fullResponse).toBe(true);
  });

  it("keeps the merchant reference in trackingCode", () => {
    expect(buildCardChargePayload(baseRequest).trackingCode).toBe("ord-12345");
  });

  it("sends the amount breakdown Kushki requires", () => {
    expect(buildCardChargePayload(baseRequest).amount).toEqual({
      subtotalIva0: 50000,
      subtotalIva: 0,
      iva: 0,
      ice: 0,
      currency: "COP",
    });
  });

  describe("installments", () => {
    it("does not send months for a single-installment payment", () => {
      expect(buildCardChargePayload(baseRequest).months).toBeUndefined();
    });

    /** Kushki llama `months` a las cuotas. Se midió que las acepta y las devuelve. */
    it("maps installments to months when there is more than one", () => {
      const payload = buildCardChargePayload({
        ...baseRequest,
        paymentMethod: PaymentMethod.card("kushki-card-token-abc", {
          installments: 3,
        }),
      });

      expect(payload.months).toBe(3);
    });
  });

  describe("without token", () => {
    it("fails with INVALID_REQUEST and says where to tokenize", () => {
      try {
        buildCardChargePayload({ ...baseRequest, paymentMethod: undefined });
        fail("debía lanzar");
      } catch (error) {
        const kitPagosError = error as {
          code: KitPagosErrorCode;
          gateway: Gateway;
          message: string;
        };
        expect(kitPagosError.code).toBe(KitPagosErrorCode.INVALID_REQUEST);
        expect(kitPagosError.gateway).toBe(Gateway.KUSHKI);
        expect(kitPagosError.message).toContain("POST /card/v1/tokens");
      }
    });
  });

  describe("reclassifyKushkiCredentialError()", () => {
    const k004 = { message: "ID de comercio o credencial no válido", code: "K004" };

    it("turns the INVALID_REQUEST with K004 into INVALID_CREDENTIALS", () => {
      const result = reclassifyKushkiCredentialError(
        new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, Gateway.KUSHKI, k004, "HTTP 400"),
      );

      expect(result.code).toBe(KitPagosErrorCode.INVALID_CREDENTIALS);
      expect(result.gateway).toBe(Gateway.KUSHKI);
      expect(result.originalPayload).toBe(k004);
      expect(result.message).toContain("K004");
    });

    it.each([
      ["otro código de Kushki", KitPagosErrorCode.INVALID_REQUEST, { code: "K001" }],
      ["un cuerpo de texto", KitPagosErrorCode.INVALID_REQUEST, "Bad Request"],
      ["un cuerpo nulo", KitPagosErrorCode.INVALID_REQUEST, null],
      ["K004 con otro status", KitPagosErrorCode.GATEWAY_SERVER_ERROR, k004],
    ])("leaves the error with %s untouched", (_scenario, code, payload) => {
      const original = new KitPagosError(code, Gateway.KUSHKI, payload, "fallo");

      expect(reclassifyKushkiCredentialError(original)).toBe(original);
    });
  });
});
