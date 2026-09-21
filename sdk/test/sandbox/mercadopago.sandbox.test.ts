import * as crypto from "crypto";
import { KitPagos } from "../../src/infrastructure/facade/KitPagos";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { Amount } from "../../src/domain/value-objects/Amount";
import { Currency } from "../../src/domain/value-objects/Currency";
import { OrderReference } from "../../src/domain/value-objects/OrderReference";
import { Payer } from "../../src/domain/value-objects/Payer";
import { PaymentMethod } from "../../src/domain/value-objects/PaymentMethod";
import { describeSandbox, uniqueReference } from "./sandbox-env";
import { tokenizeMercadoPagoCard } from "./tokenize";

/** Contrato de Mercado Pago, medido contra `api.mercadopago.com`. */
describeSandbox(Gateway.MERCADOPAGO, (credentials, baseUrl) => {
  const kitPagos = new KitPagos({
    gateway: Gateway.MERCADOPAGO,
    credentials: { [Gateway.MERCADOPAGO]: credentials },
    baseUrl,
  });

  it("responde la lista de bancos de PSE, con código y nombre", async () => {
    const banks = await kitPagos.getPseBanks();

    expect(banks.length).toBeGreaterThan(0);
    for (const bank of banks) {
      expect(typeof bank.code).toBe("string");
      expect(bank.code.length).toBeGreaterThan(0);
      expect(typeof bank.name).toBe("string");
    }
  });

  /**
   * El cobro con tarjeta.
   *
   * No se afirma que quede aprobado, y conviene saber por qué: la cuenta de prueba rechaza por
   * antifraude (`cc_rejected_high_risk`, `cc_rejected_max_attempts`) con HTTP `201`, así que
   * exigir `APPROVED` haría fallar la prueba por una decisión de riesgo de Mercado Pago. Lo
   * que sí es del SDK, y lo que se afirma, es que el cobro se cree y que el SDK pueda leer la
   * respuesta y construir una `Transaction` con el monto y la referencia que se mandaron.
   */
  it("cobra una tarjeta y devuelve una transacción legible", async () => {
    const reference = uniqueReference("SBX-MP-CARD");
    const { token } = await tokenizeMercadoPagoCard(credentials);

    const result = await kitPagos.createPayment({
      amount: new Amount("20000"),
      currency: new Currency("COP"),
      orderReference: new OrderReference(reference),
      payer: new Payer({ email: "jaime.pavlich@example.com" }),
      paymentMethod: PaymentMethod.card(token, { installments: 1 }),
    });

    if (result.outcome === "REDIRECT_REQUIRED") {
      throw new Error(
        `Mercado Pago devolvió una redirección para un cobro con tarjeta: ${result.redirect.redirectUrl}`,
      );
    }

    expect(result.transaction.gatewayTransactionId.value).toBeTruthy();
    // El monto se compara como número y no como texto a propósito: Wompi trabaja en centavos
    // y el SDK lo reconstruye con dos decimales (`"20000.00"`), mientras que Mercado Pago y
    // Kushki lo devuelven en pesos y el SDK preserva lo que vino (`"20000"`). Son el mismo
    // valor y `Amount` no impone una escala, así que afirmar la cadena exacta ataría la
    // prueba a un detalle de formato de cada pasarela en vez de al monto.
    expect(Number(result.transaction.amount.getValue())).toBe(20000);
    expect(["APPROVED", "PENDING", "DECLINED"]).toContain(
      result.transaction.getStatus(),
    );
  });

  /**
   * Las cuotas siguen siendo obligatorias.
   *
   * Esta es la razón por la que `installments` vive en `PaymentMethod` y no la resuelve cada
   * adaptador con un valor por omisión propio. Es la única de las cuatro pasarelas que las
   * exige siempre, incluso cuando son una, y si algún día dejara de hacerlo, este es el lugar
   * donde se va a notar.
   */
  it("sigue rechazando un cobro con token y sin cuotas", async () => {
    const { token } = await tokenizeMercadoPagoCard(credentials);

    const response = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.privateKey}`,
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: 20000,
        description: uniqueReference("SBX-MP-NOINST"),
        token,
        payer: { email: "jaime.pavlich@example.com" },
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("Invalid installments");
  });

  /**
   * Sin token, la queja es sobre un campo que el comercio no escribe.
   *
   * `payment_method_id` lo deduce Mercado Pago del token, así que el SDK no lo manda nunca. El
   * mensaje nombrando ese campo es lo que hace valioso que el SDK falle antes, con un error
   * que diga que falta el token y dónde se tokeniza.
   */
  it("sigue pidiendo el token nombrando payment_method_id", async () => {
    const response = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.privateKey}`,
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: 20000,
        description: uniqueReference("SBX-MP-NOTOKEN"),
        installments: 1,
        payer: { email: "jaime.pavlich@example.com" },
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("payment_method_id");
  });
});
