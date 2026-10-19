import { KitPagos } from "../../src/infrastructure/facade/KitPagos";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { Amount } from "../../src/domain/value-objects/Amount";
import { Currency } from "../../src/domain/value-objects/Currency";
import { OrderReference } from "../../src/domain/value-objects/OrderReference";
import { Payer } from "../../src/domain/value-objects/Payer";
import { PaymentMethod } from "../../src/domain/value-objects/PaymentMethod";
import { ReturnUrlConfig } from "../../src/domain/value-objects/ReturnUrlConfig";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import {
  buildRapydHeaders,
  serializeBody,
} from "../../src/infrastructure/adapters/rapyd-signature";
import {
  RAPYD_PSE_TYPE_PREFIX,
  RAPYD_PSE_TYPES,
  RAPYD_SANDBOX_PSE_TYPES,
} from "../../src/infrastructure/adapters/rapyd-pse-banks";
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
  it("returns the PSE bank list, with code and name", async () => {
    const banks = await kitPagos.getPseBanks();

    expect(banks.length).toBeGreaterThan(0);
    for (const bank of banks) {
      expect(typeof bank.code).toBe("string");
      expect(bank.code.length).toBeGreaterThan(0);
      expect(typeof bank.name).toBe("string");
    }
  });

  /** El catálogo crudo: en el sandbox, `getPseBanks()` ya viene filtrada. */
  async function pseCatalog(): Promise<string[]> {
    const url = `${baseUrl}/payment_methods/country?country=CO`;
    const response = await fetch(url, { headers: buildRapydHeaders("get", url, "", credentials) });
    const body = (await response.json()) as { data?: { type?: string }[] };
    return (body.data ?? [])
      .map((method) => method.type ?? "")
      .filter((type) => type.startsWith(RAPYD_PSE_TYPE_PREFIX));
  }

  /**
   * Si Rapyd renombra o retira un banco, un código de `PseBankCode` queda traducido a un
   * método que ya no existe y su cobro falla. Pasó con Davibank (puntos 68 y 102).
   */
  it("should keep every bank of the translation table in Rapyd's catalog", async () => {
    const catalog = new Set(await pseCatalog());

    expect(Object.values(RAPYD_PSE_TYPES).filter((type) => !catalog.has(type))).toEqual([]);
  });

  /**
   * La lista del sandbox tiene que ser exactamente lo que el sandbox cobra, en los dos
   * sentidos: si Rapyd habilita un banco, la lista lo estaría escondiendo, y si deshabilita
   * uno, lo estaría ofreciendo. Cobra una vez con cada banco del catálogo, unos 25 s.
   */
  it("should list exactly the PSE banks the sandbox can charge", async () => {
    const chargeable: string[] = [];
    for (const type of await pseCatalog()) {
      try {
        const result = await kitPagos.createPayment({
          amount: new Amount("50000"),
          currency: new Currency("COP"),
          orderReference: new OrderReference(uniqueReference("SBX-RAPYD-PSE")),
          payer: new Payer({
            email: "jaime.pavlich@example.com",
            fullName: "Jaime Pavlich",
            phone: "3001234567",
            documentType: "CC",
            documentNumber: "1098765432",
          }),
          paymentMethod: PaymentMethod.pse({ bankCode: type }),
          returnUrlConfig: new ReturnUrlConfig("https://example.com/retorno"),
        });
        if (result.outcome === "REDIRECT_REQUIRED") {
          chargeable.push(type);
        }
      } catch (error) {
        const status = (error as KitPagosError).originalPayload as { status?: { error_code?: string } } | null;
        if (status?.status?.error_code !== "ERROR_GET_GATEWAY") {
          throw error;
        }
      }
    }
    const listed = (await kitPagos.getPseBanks()).map((bank) => bank.code);

    expect(chargeable.sort()).toEqual([...RAPYD_SANDBOX_PSE_TYPES].sort());
    expect(listed.sort()).toEqual([...RAPYD_SANDBOX_PSE_TYPES].sort());
  }, 120_000);

  /**
   * La tarjeta de Rapyd devuelve una redirección, no una transacción.
   *
   * Es la consecuencia visible de no poder cobrar servidor-a-servidor sin el número de la
   * tarjeta: el pagador la escribe en la página de Rapyd. Se afirma también que el
   * identificador lleve el prefijo `checkout_`, porque es de lo que depende que la consulta de
   * estado elija la ruta correcta.
   */
  it("creates a card checkout page and returns its URL", async () => {
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
  it("allows querying the checkout page before the payer pays", async () => {
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
  it("still rejects a card charge with a token on /payments", async () => {
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
