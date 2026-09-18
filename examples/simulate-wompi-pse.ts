/**
 * Pago con PSE contra la API de Simulación (issue #64).
 *
 * Está escrito desde la posición de un desarrollador externo: importa el SDK por
 * su nombre público, como si lo hubiera instalado con `npm install`, y no por
 * rutas relativas a `sdk/src`.
 *
 * ## Qué demuestra que el ejemplo de tarjeta no puede demostrar
 *
 * Que un pago **no siempre termina en una transacción**. PSE necesita que el
 * pagador vaya al banco, así que `createPayment()` devuelve una redirección
 * pendiente, y el compilador obliga a distinguir los dos casos: `result.transaction`
 * no existe hasta haber descartado la redirección.
 *
 * ## Por qué corre contra el simulador y no contra el sandbox de Wompi
 *
 * No es comodidad. El sandbox de Wompi publica la URL de redirección en el mismo
 * instante en que resuelve el pago (medido el 18 de septiembre de 2026: 1075 ms
 * junto con `APPROVED`), o sea que resuelve solo, sin que nadie visite el banco,
 * y cuando la URL existe ya no sirve. Contra ese sandbox no hay ninguna ventana
 * en la que redirigir tenga sentido. El simulador sí reproduce el orden real, y
 * por eso es el único lugar donde este flujo se puede ejercitar.
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

/** Raíz de la API de Wompi en el simulador, no el endpoint de transacciones. */
const SIMULATOR_WOMPI_URL = "http://localhost:3000/v1/sim/wompi";

/**
 * Banco de pruebas. El simulador usa los mismos códigos que el sandbox de Wompi:
 * `1` aprueba, `2` declina y `3` simula un error. Son opacos y con alcance de
 * pasarela: este `"1"` no significa nada para Rapyd ni para Kushki.
 */
const BANK_CODE = "1";

const options: SDKOptions = {
  gateway: Gateway.WOMPI,
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_ejemplo_no_real",
      privateKey: "prv_test_ejemplo_no_real",
      // Wompi firma cada transacción con este secreto. Es distinto del secreto
      // de eventos con el que se validan los webhooks: uno firma lo que sale, el
      // otro valida lo que entra. El simulador no las valida, pero el dato viaja
      // por el mismo camino que uno real.
      integritySecret: "test_integrity_ejemplo_no_real",
    },
  },
  baseUrl: SIMULATOR_WOMPI_URL,
};

async function main(): Promise<void> {
  const kitPagos = new KitPagos(options);

  console.log("=== Kit Pagos Colombia — pago con PSE simulado ===\n");

  /**
   * El pago se describe en vocabulario del dominio. Dos cosas que PSE agrega
   * frente a un pago con tarjeta:
   *
   * - `paymentMethod`, con el banco elegido. En PSE no hay banco por defecto: el
   *   pagador siempre elige uno de la lista de la pasarela activa.
   * - el documento del pagador, que PSE exige por regulación. Va en `Payer` y no
   *   en el método de pago para no tener dos fuentes de verdad del mismo dato.
   */
  const request = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-PSE-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      fullName: "Jaime Pavlich",
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: BANK_CODE }),
    returnUrlConfig: new ReturnUrlConfig("https://comercio-de-prueba.example.com/retorno"),
  };

  console.log("Solicitud de pago:");
  console.log(`  Monto:        ${request.amount.getValue()} ${request.currency.getCode()}`);
  console.log(`  En centavos:  ${request.amount.toMinorUnits(request.currency)} (lo que recibe Wompi)`);
  console.log(`  Referencia:   ${request.orderReference.getValue()}`);
  console.log(`  Pagador:      ${request.payer.email}`);
  console.log(`  Documento:    ${request.payer.documentType} ${request.payer.documentNumber}`);
  console.log(`  Método:       ${request.paymentMethod.type} contra el banco "${BANK_CODE}"`);
  console.log(`  ¿Exige documento?  ${request.paymentMethod.requiresPayerDocument()}\n`);

  const result = await kitPagos.createPayment(request);

  // Acá está el punto del ejemplo. Con tarjeta esta rama no se alcanza nunca;
  // con PSE es la única que se alcanza. Y no se puede omitir: mientras no se
  // descarte, TypeScript no deja leer `result.transaction`.
  if (result.outcome !== "REDIRECT_REQUIRED") {
    console.error("Se esperaba una redirección pendiente y llegó una transacción.");
    process.exit(1);
  }

  console.log("Redirección pendiente:");
  console.log(`  URL del banco:   ${result.redirect.redirectUrl}`);
  console.log(`  ID en pasarela:  ${result.redirect.gatewayTransactionId.value}`);
  console.log(`  Pasarela:        ${result.redirect.gatewayTransactionId.gateway}`);
  console.log(`  Estado nativo:   ${result.redirect.rawStatus}\n`);

  console.log("En una integración real, acá el comercio redirige al pagador a esa URL.");
  console.log("El pago NO está aprobado todavía: sigue pendiente de que pague en el banco.\n");

  /**
   * Después de la redirección el comercio consulta el estado. Esto es lo que
   * haría al recibir de vuelta al pagador, o al procesar el webhook.
   */
  console.log("Consultando el estado después de la redirección...");
  const transaction = await kitPagos.getPaymentStatus(
    result.redirect.gatewayTransactionId.value,
  );

  console.log(`  Estado normalizado:  ${transaction.getStatus()}`);
  console.log(`  Estado nativo:       ${transaction.rawStatus}`);
  console.log(`  ¿Aprobado?           ${transaction.isApproved()}`);
  console.log(`  ¿Estado final?       ${transaction.isFinal()}`);
  console.log(`  Referencia:          ${transaction.orderReference.getValue()}\n`);

  console.log("=== Fin del ejemplo ===");
}

main().catch((error: unknown) => {
  if (error instanceof KitPagosError && error.code === KitPagosErrorCode.CONNECTION_FAILED) {
    console.error("\nNo se pudo conectar con la API de Simulación.");
    console.error("Levantala en otra terminal y volvé a correr el ejemplo:\n");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  // Un documento faltante o de un tipo que Wompi no acepta se detecta local,
  // antes de cualquier petición. El mensaje dice qué falta, en vez de llegar
  // como un HTTP 422 genérico de la pasarela.
  if (error instanceof KitPagosError && error.code === KitPagosErrorCode.INVALID_REQUEST) {
    console.error(`\nLa solicitud es inválida: ${error.message}\n`);
    process.exit(1);
  }

  console.error("\nEl ejemplo falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});
