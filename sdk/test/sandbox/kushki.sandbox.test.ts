import { KitPagos } from "../../src/infrastructure/facade/KitPagos";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { Amount } from "../../src/domain/value-objects/Amount";
import { Currency } from "../../src/domain/value-objects/Currency";
import { OrderReference } from "../../src/domain/value-objects/OrderReference";
import { Payer } from "../../src/domain/value-objects/Payer";
import { PaymentMethod } from "../../src/domain/value-objects/PaymentMethod";
import { KushkiAdapter } from "../../src/infrastructure/adapters/KushkiAdapter";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { expectTransaction } from "../../src/test-support/payment-result";
import { describeSandbox, uniqueReference } from "./sandbox-env";
import { tokenizeKushkiCard } from "./tokenize";

/** Contrato de Kushki, medido contra `api-uat.kushkipagos.com`. */
describeSandbox(Gateway.KUSHKI, (credentials, baseUrl) => {
  const kitPagos = new KitPagos({
    gateway: Gateway.KUSHKI,
    credentials: { [Gateway.KUSHKI]: credentials },
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
   * El cobro con tarjeta, que es donde estaban tres de los ocho defectos.
   *
   * Que esta prueba pase significa las tres cosas a la vez: que la ruta
   * `/card/v1/charges` es la correcta, que el token va de verdad, y que la respuesta con
   * `fullResponse` trae lo suficiente para construir una `Transaction`. Si cualquiera de las
   * tres se rompe, esto falla, y falla acá y no en el comercio.
   */
  it("cobra una tarjeta y devuelve una transacción legible", async () => {
    // Kushki ata el token al monto del cobro, así que tokenizar y cobrar tienen que coincidir.
    const { token } = await tokenizeKushkiCard(credentials, 20000);

    const result = await kitPagos.createPayment({
      amount: new Amount("20000"),
      currency: new Currency("COP"),
      orderReference: new OrderReference(uniqueReference("SBX-KUSHKI-CARD")),
      payer: new Payer({ email: "jaime.pavlich@example.com" }),
      paymentMethod: PaymentMethod.card(token),
    });

    if (result.outcome === "REDIRECT_REQUIRED") {
      throw new Error(
        `Kushki devolvió una redirección para un cobro con tarjeta: ${result.redirect.redirectUrl}`,
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
   * La ruta vieja sigue sin existir, y sigue sin decirlo.
   *
   * `POST /charges` era la que el SDK usaba, y responde `403`. Lo que hace que valga la pena
   * fijarlo en una prueba es lo otro: **una ruta inventada responde lo mismo**, así que contra
   * Kushki un `403` no distingue entre "no tenés permiso" y "esto no existe". Es la trampa que
   * hizo que el defecto durara, y la razón de que la ruta correcta esté en una constante y no
   * escrita entre las llamadas.
   */
  it("sigue respondiendo 403 en la ruta vieja, igual que en una inventada", async () => {
    const charge = await fetch(`${baseUrl}/charges`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Private-Merchant-Id": credentials.privateKey,
      },
      body: JSON.stringify({ token: "irrelevante" }),
    });

    const invented = await fetch(`${baseUrl}/ruta/que/no/existe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Private-Merchant-Id": credentials.privateKey,
      },
      body: JSON.stringify({ token: "irrelevante" }),
    });

    expect(charge.status).toBe(403);
    expect(invented.status).toBe(403);
  });

  /**
   * Consultar un cobro con tarjeta del flujo síncrono no se puede, y el error tiene que
   * decir exactamente eso, no algo más fuerte.
   *
   * Es el defecto veinte, medido el 19 de septiembre de 2026: el SDK devolvía
   * `INVALID_CREDENTIALS` al consultar un cobro que Kushki acababa de aprobar, con las
   * credenciales buenas. La primera corrección se fue al otro extremo y afirmó que Kushki no
   * publica **ninguna** consulta de tarjeta; medir el espacio `card-async` mostró que sí
   * publica una, y que lo que contesta para un cobro síncrono es `CAS004 "No existe la
   * transacción"`. El adaptador la intenta y el mensaje distingue los dos casos.
   *
   * La prueba cobra de verdad y consulta de verdad, porque es el único modo de que esto siga
   * siendo cierto: si Kushki empieza a registrar los cobros síncronos en esa ruta, la
   * consulta va a responder y esta prueba se pone roja para avisar que el SDK está diseñado
   * alrededor de una restricción que ya no existe.
   */
  it("explica que no hay consulta de tarjeta, en vez de culpar a las credenciales", async () => {
    const { token } = await tokenizeKushkiCard(credentials, 20000);
    const adapter = new KushkiAdapter(baseUrl, credentials);

    const result = await adapter.createPayment({
      amount: new Amount("20000"),
      currency: new Currency("COP"),
      orderReference: new OrderReference(uniqueReference("KUSHKI-CONSULTA")),
      payer: new Payer({ email: "sandbox@example.com", fullName: "Jaime Pavlich" }),
      paymentMethod: PaymentMethod.card(token, { installments: 1 }),
    });

    const ticket = expectTransaction(result).gatewayTransactionId.value;

    // El estado ya vino en la creación, que es justo lo que el mensaje del error propone
    // usar. Sin esto, la prueba afirmaría una limitación sin mostrar la salida.
    expect(expectTransaction(result).getStatus()).toBe("APPROVED");

    await expect(adapter.getStatus(ticket)).rejects.toMatchObject({
      code: KitPagosErrorCode.UNSUPPORTED_OPERATION,
    });

    // Y dice cuál es la consulta que Kushki sí tiene, para que el comercio no salga de acá
    // creyendo que la pasarela no ofrece ninguna.
    await expect(adapter.getStatus(ticket)).rejects.toThrow(/card-async/);
  });

  /**
   * Sin `fullResponse`, la respuesta no alcanza para construir una `Transaction`.
   *
   * Es la razón por la que el SDK manda esa bandera siempre. La prueba no la manda a propósito
   * y afirma lo que falta: ni monto ni estado, solo los dos identificadores.
   */
  it("sigue devolviendo una respuesta sin monto ni estado cuando no se pide fullResponse", async () => {
    const { token } = await tokenizeKushkiCard(credentials, 20000);

    const response = await fetch(`${baseUrl}/card/v1/charges`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Private-Merchant-Id": credentials.privateKey,
      },
      body: JSON.stringify({
        token,
        amount: {
          subtotalIva: 0,
          subtotalIva0: 20000,
          ice: 0,
          iva: 0,
          currency: "COP",
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ticketNumber).toBeTruthy();
    expect(body.details).toBeUndefined();
    expect(body.transactionStatus).toBeUndefined();
  });
});
