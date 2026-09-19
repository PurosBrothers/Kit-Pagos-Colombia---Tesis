import { KitPagos } from "../../src/infrastructure/facade/KitPagos";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { Amount } from "../../src/domain/value-objects/Amount";
import { Currency } from "../../src/domain/value-objects/Currency";
import { OrderReference } from "../../src/domain/value-objects/OrderReference";
import { Payer } from "../../src/domain/value-objects/Payer";
import { PaymentMethod } from "../../src/domain/value-objects/PaymentMethod";
import {
  buildRapydHeaders,
  serializeBody,
} from "../../src/infrastructure/adapters/rapyd-signature";
import { describeSandbox, uniqueReference } from "./sandbox-env";

/** Contrato de Rapyd, medido contra `sandboxapi.rapyd.net`. */
describeSandbox(Gateway.RAPYD, (credentials, baseUrl) => {
  const kitPagos = new KitPagos({
    gateway: Gateway.RAPYD,
    credentials: { [Gateway.RAPYD]: credentials },
    baseUrl,
  });

  /**
   * Que esto pase prueba además que el algoritmo de firma sigue siendo el correcto: Rapyd
   * firma **todas** sus peticiones, así que una firma mal calculada no deja pasar ni una
   * lectura. Es la afirmación más barata que cubre más superficie de todo el archivo.
   */
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
   * La tarjeta de Rapyd devuelve una redirección, no una transacción.
   *
   * Es la consecuencia visible de no poder cobrar servidor-a-servidor sin el número de la
   * tarjeta: el pagador la escribe en la página de Rapyd. Se afirma también que el
   * identificador lleve el prefijo `checkout_`, porque es de lo que depende que la consulta de
   * estado elija la ruta correcta.
   */
  it("crea una página de pago para la tarjeta y devuelve su URL", async () => {
    const result = await kitPagos.createPayment({
      amount: new Amount("20000"),
      currency: new Currency("COP"),
      orderReference: new OrderReference(uniqueReference("SBX-RAPYD-CARD")),
      payer: new Payer({
        email: "jaime.pavlich@example.com",
        documentType: "CC",
        documentNumber: "1098765432",
      }),
      paymentMethod: PaymentMethod.card(),
    });

    if (result.outcome !== "REDIRECT_REQUIRED") {
      throw new Error(
        "Rapyd resolvió un cobro con tarjeta sin redirigir, lo que contradice lo medido: " +
          `estado ${result.transaction.getStatus()}`,
      );
    }

    expect(result.redirect.redirectUrl).toMatch(/^https:\/\//);
    expect(result.redirect.gatewayTransactionId.value).toContain("checkout_");
  });

  /**
   * Una página recién creada se puede consultar y todavía no tiene pago.
   *
   * Es el estado en el que queda mientras el pagador no ha hecho nada, y la razón de que el
   * adaptador tenga que sintetizar un `PENDING` en vez de leer un pago que no existe.
   */
  it("deja consultar la página de pago antes de que el pagador pague", async () => {
    const created = await kitPagos.createPayment({
      amount: new Amount("20000"),
      currency: new Currency("COP"),
      orderReference: new OrderReference(uniqueReference("SBX-RAPYD-GET")),
      payer: new Payer({
        email: "jaime.pavlich@example.com",
        documentType: "CC",
        documentNumber: "1098765432",
      }),
      paymentMethod: PaymentMethod.card(),
    });

    if (created.outcome !== "REDIRECT_REQUIRED") {
      throw new Error("Se esperaba una redirección");
    }

    const consulted = await kitPagos.getPaymentStatus(
      created.redirect.gatewayTransactionId.value,
    );

    expect(consulted.getStatus()).toBe("PENDING");
  });

  /**
   * Cobrar un token de tarjeta servidor-a-servidor sigue siendo imposible.
   *
   * Esta es **la prueba que sostiene la decisión de usar la página alojada**. Si Rapyd algún
   * día aceptara un token sin pedir el número de la tarjeta, esto falla y el cobro con tarjeta
   * de Rapyd puede volverse igual al de las otras tres, sin redirección. Mientras falle como
   * hoy, la página alojada es la única opción que no mete al comercio en el alcance de PCI DSS.
   */
  it("sigue rechazando un cobro de tarjeta con token en /payments", async () => {
    const url = `${baseUrl}/payments`;
    const payload = {
      amount: 20000,
      currency: "COP",
      payment_method: {
        type: "co_visa_card",
        fields: { token: "card_irrelevante" },
      },
    };
    const bodyString = serializeBody(payload);

    const response = await fetch(url, {
      method: "POST",
      headers: buildRapydHeaders("post", url, bodyString, credentials),
      body: bodyString,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as {
      status?: { error_code?: string };
    };
    // El nombre del código es largo y dice exactamente el problema: o los campos, o el token,
    // y con el token solo no alcanza.
    expect(body.status?.error_code).toBeTruthy();
    expect(body.status?.error_code).not.toBe("SUCCESS");
  });
});
