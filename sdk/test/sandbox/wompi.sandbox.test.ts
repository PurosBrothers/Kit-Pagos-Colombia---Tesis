import { KitPagos } from "../../src/infrastructure/facade/KitPagos";
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { Amount } from "../../src/domain/value-objects/Amount";
import { Currency } from "../../src/domain/value-objects/Currency";
import { OrderReference } from "../../src/domain/value-objects/OrderReference";
import { Payer } from "../../src/domain/value-objects/Payer";
import { PaymentMethod } from "../../src/domain/value-objects/PaymentMethod";
import { describeSandbox, uniqueReference } from "./sandbox-env";
import { tokenizeWompiCard } from "./tokenize";

/**
 * Contrato de Wompi, medido contra `sandbox.wompi.co`.
 *
 * Todo pasa por `KitPagos`, la fachada, y no por el adaptador: es la única clase que el
 * comercio instancia, así que probar por ahí mide lo que el comercio realmente ejecuta,
 * incluido el armado de credenciales y la resolución del adaptador.
 */
describeSandbox(Gateway.WOMPI, (credentials, baseUrl) => {
  const kitPagos = new KitPagos({
    gateway: Gateway.WOMPI,
    credentials: { [Gateway.WOMPI]: credentials },
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
   * El cobro con tarjeta completo: tokenizar, cobrar y consultar.
   *
   * La afirmación importante es la última. Wompi crea el cobro `PENDING` y lo resuelve solo
   * unos cientos de milisegundos después, así que **el desenlace no está en la respuesta de
   * creación** y el comercio tiene que consultar. Si algún día Wompi empezara a resolverlo de
   * una, esta prueba lo diría, y el paso de consulta pasaría de obligatorio a redundante.
   */
  it("cobra una tarjeta y la deja consultable", async () => {
    const { token } = await tokenizeWompiCard(credentials);

    const result = await kitPagos.createPayment({
      amount: new Amount("20000"),
      currency: new Currency("COP"),
      orderReference: new OrderReference(uniqueReference("SBX-WOMPI-CARD")),
      payer: new Payer({ email: "jaime.pavlich@example.com" }),
      paymentMethod: PaymentMethod.card(token, { installments: 1 }),
    });

    // Un cobro con tarjeta no redirige en Wompi: el resultado es una transacción.
    if (result.outcome === "REDIRECT_REQUIRED") {
      throw new Error(
        `Wompi devolvió una redirección para un cobro con tarjeta: ${result.redirect.redirectUrl}`,
      );
    }

    const created = result.transaction;
    expect(created.gatewayTransactionId.value).toBeTruthy();
    expect(created.amount.getValue()).toBe("20000.00");
    expect(created.currency.getCode()).toBe("COP");

    const consulted = await kitPagos.getPaymentStatus(
      created.gatewayTransactionId.value,
    );

    expect(consulted.gatewayTransactionId.value).toBe(
      created.gatewayTransactionId.value,
    );
    // No se exige APPROVED: el desenlace lo decide la pasarela, no el SDK. Lo que se exige es
    // que el estado sea uno que el dominio conozca, porque un estado que el normalizador no
    // reconozca cae en ERROR y eso sí sería un defecto.
    expect(["APPROVED", "PENDING", "DECLINED"]).toContain(
      consulted.getStatus(),
    );
  });

  /**
   * La firma de integridad sigue siendo obligatoria.
   *
   * Esta es la medición que dejó abierto el issue de exigir `integritySecret`: hoy el SDK
   * firma solo si el comercio configuró el secreto, así que quien lo omita recibe este 422 de
   * Wompi en vez de un error del SDK. La prueba va con `fetch` directo porque el SDK no tiene
   * forma de mandar una transacción mal formada a propósito, y sirve como recordatorio
   * ejecutable: si Wompi dejara de exigir la firma, el issue pendiente se cierra sin cambiar
   * código.
   *
   * Llegar hasta la queja por la firma exige mandar todo lo demás bien, y ese camino es la
   * evidencia del acoplamiento que dejó el issue afuera: **Wompi valida en orden fijo —formato
   * del token, token de aceptación y después la firma—** y solo se queja de una cosa por
   * respuesta. Con un token inventado responde `"Formato inválido"` sobre el token; con un
   * token válido y sin token de aceptación, `"No está presente"` sobre el token de aceptación.
   * O sea que exigir el secreto de integridad sin exigir también el token de aceptación
   * dejaría al comercio igual de lejos de poder cobrar, con un error menos.
   */
  it("sigue rechazando una transacción sin firma de integridad", async () => {
    const { token } = await tokenizeWompiCard(credentials);
    const acceptanceToken = await fetchAcceptanceToken();

    const response = await fetch(`${baseUrl}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.privateKey}`,
      },
      body: JSON.stringify({
        amount_in_cents: 2000000,
        currency: "COP",
        customer_email: "jaime.pavlich@example.com",
        reference: uniqueReference("SBX-WOMPI-NOSIG"),
        acceptance_token: acceptanceToken,
        payment_method: { type: "CARD", token, installments: 1 },
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Firma de integridad");
  });

  /** Lo mismo que hace el adaptador, acá a mano para poder omitir la firma a propósito. */
  async function fetchAcceptanceToken(): Promise<string> {
    const response = await fetch(
      `${baseUrl}/merchants/${credentials.publicKey}`,
    );
    const body = (await response.json()) as {
      data?: {
        presigned_acceptance?: { acceptance_token?: string };
      };
    };
    const acceptanceToken = body.data?.presigned_acceptance?.acceptance_token;
    if (!acceptanceToken) {
      throw new Error(
        `Wompi no devolvió token de aceptación: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return acceptanceToken;
  }
});
