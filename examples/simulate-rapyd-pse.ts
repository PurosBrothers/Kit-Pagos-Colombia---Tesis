/**
 * Pago con PSE en Rapyd contra la API de Simulación.
 *
 * ## Qué demuestra este ejemplo que los otros no
 *
 * Que **la cantidad de llamadas que hace falta antes de redirigir no es la misma en
 * todas las pasarelas, y el comercio no se entera**. En Wompi y en Mercado Pago PSE es
 * una llamada; en Rapyd son dos, porque el `customer` es una entidad propia que hay
 * que crear antes del pago: un `POST /v1/payments` sin cliente previo responde
 * `MISSING_PAYMENT_METHOD_REQUIRED_FIELD - [CUSTOMER]`, medido contra el sandbox real
 * el 18 de septiembre de 2026.
 *
 * El código de este ejemplo es el mismo que el de Wompi salvo la configuración y el
 * código de banco. La segunda llamada existe y no se ve, y eso es la decisión de
 * diseño, no un descuido: el punto 47 del `architecture-log.md` explica por qué se
 * escondió y qué cuesta esconderla.
 *
 * ## Lo otro que muestra: Rapyd no llama "PSE" a PSE
 *
 * En Rapyd PSE no es un método con un campo de banco: son **47 métodos de pago
 * distintos**, uno por entidad, con el patrón `co_pse_{banco}_bank`. Por eso el
 * `bankCode` que recibe `PaymentMethod.pse()` acá es `"co_pse_bancolombia_bank"` y no
 * un número. El ejemplo lo saca de `getPseBanks()` en vez de escribirlo, que es la
 * única forma en que un comercio puede conocerlo sin leer la documentación de Rapyd.
 *
 * Requisito para correrlo: la API de Simulación arriba en el puerto 3000.
 */
import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  PaymentMethod,
  ReturnUrlConfig,
  KitPagosError,
  KitPagosErrorCode,
  type SDKOptions,
} from "kit-pagos-colombia";

/** Raíz de la API de Rapyd en el simulador, no el endpoint de pagos. */
const SIMULATOR_RAPYD_URL = "http://localhost:3000/v1/sim/rapyd";

const options: SDKOptions = {
  gateway: Gateway.RAPYD,
  credentials: {
    [Gateway.RAPYD]: {
      // En Rapyd la llave pública es el `access_key`, que viaja en claro en un
      // header, y la privada es el `secret_key`, que nunca se transmite: solo
      // participa del cálculo de la firma de cada petición.
      publicKey: "rak_test_ejemplo_no_real",
      privateKey: "rsk_test_ejemplo_no_real",
    },
  },
  baseUrl: SIMULATOR_RAPYD_URL,
};

async function main(): Promise<void> {
  const kitPagos = new KitPagos(options);

  console.log("=== Kit Pagos Colombia — PSE en Rapyd ===\n");

  // Paso previo al cobro, y el único que necesita una persona en el medio: el
  // pagador elige su banco de esta lista.
  const banks = await kitPagos.getPseBanks();
  const banco = banks[0];

  if (!banco) {
    console.error("Rapyd no devolvió ningún banco habilitado para PSE.");
    process.exit(1);
  }

  console.log(`Bancos disponibles: ${banks.length}`);
  console.log(`Elegido:            ${banco.name}  (${banco.code})\n`);

  /**
   * Los datos del pagador que Rapyd exige para PSE son más que en las otras
   * pasarelas, y el SDK los verifica **antes** de la primera llamada.
   *
   * No es una validación de adorno: se midió que si falta el correo, Rapyd crea el
   * cliente igual y falla recién en el pago, dejando un cliente huérfano que nadie
   * va a limpiar. Verificar antes no elimina ese estado a medias —una caída de red
   * entre las dos llamadas todavía lo produce— pero saca del camino la causa
   * prevenible.
   */
  const request = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-PSE-RAPYD-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      // Rapyd rechaza el cliente sin nombre con `INVALID_CUSTOMER_NAME`.
      fullName: "Jaime Pavlich Mariscal",
      // Y el pago sin teléfono con `[PHONE_NUMBER]`, que su propio endpoint de
      // campos obligatorios no menciona. Va sin prefijo internacional a propósito:
      // se midió que Rapyd acepta las dos formas, así que el SDK no lo transforma.
      phone: "3001234567",
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: banco.code }),
    returnUrlConfig: new ReturnUrlConfig(
      "https://comercio-de-prueba.example.com/retorno",
    ),
  };

  console.log("Solicitud de pago:");
  console.log(`  Monto:        ${request.amount.getValue()} ${request.currency.getCode()}`);
  console.log("  Ojo:          Rapyd recibe pesos, NO centavos, a diferencia de Wompi");
  console.log(`  Referencia:   ${request.orderReference.getValue()}`);
  console.log(`  Pagador:      ${request.payer.fullName} <${request.payer.email}>`);
  console.log(`  Documento:    ${request.payer.documentType} ${request.payer.documentNumber}`);
  console.log(`  Método:       ${request.paymentMethod.type} vía ${banco.code}\n`);

  console.log("Lo que pasa por debajo, y que este código no muestra:");
  console.log("  1. POST /v1/customers   — crea el cliente");
  console.log("  2. POST /v1/payments    — cobra, referenciando ese cliente\n");

  const result = await kitPagos.createPayment(request);

  if (result.outcome !== "REDIRECT_REQUIRED") {
    console.error("Se esperaba una redirección pendiente y llegó una transacción.");
    process.exit(1);
  }

  console.log("Redirección pendiente:");
  console.log(`  URL del banco:   ${result.redirect.redirectUrl}`);
  console.log(`  ID en pasarela:  ${result.redirect.gatewayTransactionId.value}`);
  // `ACT` es el estado nativo de Rapyd para un pago en curso. El SDK lo normaliza a
  // PENDING, y conserva el valor nativo para auditoría.
  console.log(`  Estado nativo:   ${result.redirect.rawStatus}\n`);

  console.log(
    "Notar que las dos URL de retorno del comercio viajan dentro de esa URL, como\n" +
      "parámetros: es el destino al que el banco devuelve al pagador cuando termina.\n",
  );

  console.log("Consultando el estado después de la redirección...");
  const transaction = await kitPagos.getPaymentStatus(
    result.redirect.gatewayTransactionId.value,
  );

  console.log(`  Estado normalizado:  ${transaction.getStatus()}`);
  console.log(`  Estado nativo:       ${transaction.rawStatus}`);
  console.log(`  ¿Aprobado?           ${transaction.isApproved()}`);
  console.log(`  ¿Estado final?       ${transaction.isFinal()}\n`);

  console.log("=== Fin del ejemplo ===");
}

main().catch((error: unknown) => {
  if (
    error instanceof KitPagosError &&
    error.code === KitPagosErrorCode.CONNECTION_FAILED
  ) {
    console.error("\nNo se pudo conectar con la API de Simulación.");
    console.error("Levantala en otra terminal y volvé a correr el ejemplo:\n");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  /**
   * Los datos que faltan se detectan antes de cualquier petición, así que este error
   * llega sin haber creado nada en Rapyd. Es la diferencia entre enterarse acá y
   * enterarse después de haber dejado un cliente huérfano.
   */
  if (
    error instanceof KitPagosError &&
    error.code === KitPagosErrorCode.INVALID_REQUEST
  ) {
    console.error(`\nLa solicitud es inválida: ${error.message}\n`);
    process.exit(1);
  }

  console.error("\nEl ejemplo falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});
