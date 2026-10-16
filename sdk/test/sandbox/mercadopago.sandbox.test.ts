import * as crypto from "crypto";
import { KitPagos } from "../../src/infrastructure/facade/KitPagos";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { Amount } from "../../src/domain/value-objects/Amount";
import { Currency } from "../../src/domain/value-objects/Currency";
import { OrderReference } from "../../src/domain/value-objects/OrderReference";
import { Payer } from "../../src/domain/value-objects/Payer";
import { PaymentMethod } from "../../src/domain/value-objects/PaymentMethod";
import { PseBankCode } from "../../src/domain/value-objects/PseBankCode";
import { describeSandbox, uniqueReference } from "./sandbox-env";
import { tokenizeMercadoPagoCard } from "./tokenize";
import { KitPagosBrowser } from "../../src-browser/KitPagosBrowser";

/** Contrato de Mercado Pago, medido contra `api.mercadopago.com`. */
describeSandbox(Gateway.MERCADOPAGO, (credentials, baseUrl) => {
  const kitPagos = new KitPagos({
    gateway: Gateway.MERCADOPAGO,
    credentials: { [Gateway.MERCADOPAGO]: credentials },
    baseUrl,
  });

  it("returns the PSE bank list, with code and name", async () => {
    const banks = await kitPagos.getPseBanks();

    expect(banks.length).toBeGreaterThan(0);
    for (const bank of banks) {
      expect(typeof bank.code).toBe("string");
      expect(bank.code.length).toBeGreaterThan(0);
      expect(typeof bank.name).toBe("string");
    }
  });

  /**
   * Mercado Pago identifica a los bancos con el código de compensación, así que su lista
   * es la referencia viva de `PseBankCode`. Si ACH habilita o retira una entidad, esto lo
   * dice (punto 68).
   */
  it("should list exactly the entities of PseBankCode, each one with its achCode", async () => {
    const banks = await kitPagos.getPseBanks();

    expect(banks.map((bank) => bank.code).sort()).toEqual(
      [...Object.values(PseBankCode)].sort(),
    );
    expect(banks.every((bank) => bank.achCode === bank.code)).toBe(true);
  });

  /**
   * El cobro con tarjeta, que desde la versión 0.6.0 es una orden de la Orders API.
   *
   * Sigue sin afirmarse que quede aprobado, aunque con las credenciales del 15 de octubre de
   * 2026 el titular `APRO` sí aprueba: entre las 13:52 y las 14:00 (UTC−5) de ese día, 12 de 13
   * órdenes con `APRO` salieron `processed / accredited`, y la otra, a las 13:52, salió
   * `failed / high_risk` en una tanda en que todos los titulares recibieron `high_risk`. Mercado
   * Pago no informa la causa, así que exigir `APPROVED` haría fallar la prueba por una decisión
   * de riesgo de la pasarela.
   * Lo que sí es del SDK, y lo que se afirma, es que el cobro sea una orden, que el SDK la lea
   * con el monto y la referencia que se mandaron, y que un rechazo llegue como `DECLINED` con
   * su motivo y no como una excepción.
   */
  it("charges a card as an order and returns a readable transaction", async () => {
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

    expect(result.transaction.gatewayTransactionId.value).toMatch(/^ORD/);
    expect(result.transaction.orderReference.getValue()).toBe(reference);
    if (result.transaction.getStatus() === "DECLINED") {
      expect(result.transaction.rawStatus).toBe("failed");
      expect(result.transaction.rejectionReason?.rejectionCode).toBeTruthy();
    }
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
   * Tokenización de tarjeta desde el navegador con KitPagosBrowser y cobro en servidor.
   * Medido el 4 de octubre de 2026 contra sandbox de Mercado Pago (issue #127).
   */
  it("tokenizes a card with KitPagosBrowser and charges through the server SDK", async () => {
    const tokenResult = await KitPagosBrowser.tokenizeCard({
      gateway: Gateway.MERCADOPAGO,
      publicKey: credentials.publicKey,
      environment: "sandbox",
      card: {
        number: "4013540682746260",
        cvc: "123",
        expMonth: "11",
        expYear: "30",
        cardHolder: "APRO",
        docType: "CC",
        docNumber: "19119119100",
      },
    });

    expect(tokenResult.token).toBeTruthy();
    expect(tokenResult.gateway).toBe(Gateway.MERCADOPAGO);

    const result = await kitPagos.createPayment({
      amount: new Amount("20000"),
      currency: new Currency("COP"),
      orderReference: new OrderReference(uniqueReference("SBX-MP-BROWSER-CARD")),
      payer: new Payer({ email: "jaime.pavlich@example.com" }),
      paymentMethod: PaymentMethod.card(tokenResult.token, { installments: 1 }),
    });

    if (result.outcome === "REDIRECT_REQUIRED") {
      throw new Error("Mercado Pago devolvió una redirección para tarjeta");
    }

    expect(result.transaction.gatewayTransactionId.value).toMatch(/^ORD/);
    expect(Number(result.transaction.amount.getValue())).toBe(20000);
    expect(["APPROVED", "PENDING", "DECLINED"]).toContain(
      result.transaction.getStatus(),
    );
  });

  /**
   * Un rechazo es un pago `DECLINED`, no una excepción.
   *
   * La Orders API responde el rechazo con `402` y la orden fallida en `data`. Con `FUND` el
   * motivo medido es `insufficient_amount`, pero no se afirma el código: en la tanda de
   * `high_risk` del 15 de octubre de 2026 el mismo titular salió con ese otro motivo. Lo
   * estable es que el SDK convierta el `402` en una transacción rechazada con su motivo.
   */
  it("returns a declined card order as a DECLINED transaction with its reason", async () => {
    const { token } = await tokenizeMercadoPagoCard(credentials, "FUND");

    const result = await kitPagos.createPayment({
      amount: new Amount("20000"),
      currency: new Currency("COP"),
      orderReference: new OrderReference(uniqueReference("SBX-MP-CARD-FUND")),
      payer: new Payer({ email: "jaime.pavlich@example.com" }),
      paymentMethod: PaymentMethod.card(token, { installments: 1 }),
    });

    if (result.outcome === "REDIRECT_REQUIRED") {
      throw new Error("Mercado Pago devolvió una redirección para tarjeta");
    }

    expect(result.transaction.getStatus()).toBe("DECLINED");
    expect(result.transaction.rawStatus).toBe("failed");
    expect(result.transaction.gatewayTransactionId.value).toMatch(/^ORD/);
    expect(result.transaction.rejectionReason?.rejectionCode).toBeTruthy();

    const queried = await kitPagos.getPaymentStatus(result.transaction.gatewayTransactionId.value);
    expect(queried.getStatus()).toBe("DECLINED");
  });

  /**
   * La Payments API rechaza estas credenciales.
   *
   * Es la razón por la que tarjeta pasó a la Orders API en la versión 0.6.0: con las
   * credenciales del vendedor de prueba de la aplicación «Checkout API via Orders», el cobro
   * por `POST /v1/payments` responde `401` (medido el 15 de octubre de 2026). Si algún día
   * deja de hacerlo, la decisión se puede revisar con evidencia.
   */
  it("still refuses a card charge through the Payments API with these credentials", async () => {
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
        description: uniqueReference("SBX-MP-PAYMENTS"),
        token,
        installments: 1,
        payment_method_id: "visa",
        payer: { email: "jaime.pavlich@example.com" },
      }),
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("Unauthorized use of live credentials");
  });

  /**
   * La Orders API no deduce la marca del token.
   *
   * Es la razón de las dos consultas que el SDK hace antes de cobrar (`mercadopago-card.ts`):
   * sin `payment_method.id` ni `payment_method.type` la orden responde `400
   * required_properties`. Si Mercado Pago empezara a deducirlos, las dos consultas sobrarían.
   */
  it("still requires the payment method id and type in a card order", async () => {
    const { token } = await tokenizeMercadoPagoCard(credentials);

    const response = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.privateKey}`,
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        type: "online",
        processing_mode: "automatic",
        total_amount: "20000",
        external_reference: uniqueReference("SBX-MP-NOMETHOD"),
        payer: { email: "jaime.pavlich@example.com" },
        transactions: { payments: [{ amount: "20000", payment_method: { token, installments: 1 } }] },
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors?: { code?: string; details?: string[] }[] };
    expect(body.errors?.[0]?.code).toBe("required_properties");
    expect(body.errors?.[0]?.details?.join(" ")).toContain("'id', 'type'");
  });
});
