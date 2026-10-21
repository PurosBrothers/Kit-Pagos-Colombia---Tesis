import { createPayments } from "../../src/payments";

// Las pruebas del módulo de pagos de este prototipo. En el esqueleto común solo comprueban
// que el módulo todavía no existe; el issue de cada prototipo las reemplaza.
describe("payments module (skeleton placeholder)", () => {
  const payments = createPayments();

  it("should fail every operation until the prototype implements it", async () => {
    expect(() => payments.publicConfig()).toThrow(/todavía no está implementado/);
    await expect(payments.listPseBanks()).rejects.toThrow(/todavía no está implementado/);
    await expect(payments.getPaymentStatus("tx")).rejects.toThrow(/todavía no está implementado/);
    await expect(payments.verifyWebhook({ rawBody: "", headers: {}, query: {} })).rejects.toThrow(
      /todavía no está implementado/,
    );
    await expect(
      payments.createPayment({
        orderReference: "ORD-1",
        amountInPesos: 1000,
        description: "x",
        payer: { fullName: "a", email: "a@b.c", documentType: "CC", documentNumber: "1", phone: "1" },
        method: { type: "PSE", bankCode: "1007", personType: "NATURAL" },
        returnUrl: "http://localhost:4000/orders/ORD-1",
      }),
    ).rejects.toThrow(/todavía no está implementado/);
  });
});
