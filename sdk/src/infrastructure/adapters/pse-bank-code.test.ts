import { buildPseFieldsFor } from "./wompi-pse";
import { buildPseOrderPayload } from "./mercadopago-pse";
import { buildTransferTokenPayload } from "./kushki-pse";
import { buildPsePaymentPayload } from "./rapyd-pse";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { PseBankCode } from "../../domain/value-objects/PseBankCode";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";
import { TaxBreakdown } from "../../domain/value-objects/TaxBreakdown";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

/**
 * El mismo `PseBankCode.BANCOLOMBIA` tiene que llegar a cada pasarela en la forma que
 * ella entiende, sin que el comercio sepa cuál es. Es lo que pidió la dirección del
 * trabajo, y lo que el catálogo del punto 68 existe para permitir.
 *
 * La solicitud trae los datos del pagador que pide la más exigente de las cuatro
 * (Mercado Pago), para que la misma sirva en todas.
 */
function bancolombiaRequest(): CreatePaymentRequest {
  return {
    amount: new Amount("150000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ord-pse-bancolombia"),
    payer: new Payer({
      email: "cliente@example.com",
      firstName: "Juan",
      lastName: "Perez Gomez",
      fullName: "Juan Perez Gomez",
      documentType: "CC",
      documentNumber: "1099888777",
      phone: "3001234567",
      phoneAreaCode: "57",
      address: {
        streetName: "Calle 10",
        streetNumber: "100",
        city: "Bogota",
        zipCode: "110111",
        neighborhood: "Centro",
      },
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: PseBankCode.BANCOLOMBIA }),
    returnUrlConfig: new ReturnUrlConfig("https://comercio.example.com/retorno"),
    ipAddress: "200.100.50.25",
  };
}

describe("PseBankCode across the four gateways", () => {
  it("Wompi should receive the clearing code as financial_institution_code", () => {
    const request = bancolombiaRequest();
    const fields = buildPseFieldsFor(request.paymentMethod, request.payer, "ord-pse-bancolombia");
    expect(fields?.financial_institution_code).toBe("1007");
  });

  it("Mercado Pago should receive the clearing code as financial_institution", () => {
    expect(JSON.stringify(buildPseOrderPayload(bancolombiaRequest()))).toContain(
      '"financial_institution":"1007"',
    );
  });

  it("Kushki should receive the clearing code as bankId", () => {
    const request = bancolombiaRequest();
    const payload = buildTransferTokenPayload(
      request,
      TaxBreakdown.exempt(request.amount, request.currency),
    );
    expect(payload.bankId).toBe("1007");
  });

  it("Rapyd should receive its own PSE method for the same bank", () => {
    const payload = buildPsePaymentPayload(bancolombiaRequest(), "cus_abc123");
    expect((payload.payment_method as { type: string }).type).toBe("co_pse_bancolombia_bank");
  });
});
