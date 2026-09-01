import { KitPagos } from "./KitPagos";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

describe("KitPagos", () => {
  const kitPagos = new KitPagos();

  it("createPayment() debe existir y lanzar stub error", async () => {
    const request: CreatePaymentRequest = {
      amount: new Amount(50000),
      currency: new Currency("COP"),
      orderReference: new OrderReference("ORDER-123"),
      payer: new Payer({ email: "test@example.com" }),
    };

    await expect(kitPagos.createPayment(request)).rejects.toThrow(
      "KitPagos.createPayment aun no esta implementado"
    );
  });

  it("getPaymentStatus() debe existir y lanzar stub error", async () => {
    await expect(kitPagos.getPaymentStatus("tx-123")).rejects.toThrow(
      "KitPagos.getPaymentStatus aun no esta implementado"
    );
  });

  it("validateWebhook() debe existir y lanzar stub error", () => {
    expect(() => kitPagos.validateWebhook("{}", {})).toThrow(
      "KitPagos.validateWebhook aun no esta implementado"
    );
  });
});
