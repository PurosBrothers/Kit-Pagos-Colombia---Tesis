/**
 * Ejemplo end-to-end de un pago simulado con Kushki.
 *
 * Requiere la API de Simulación en el puerto 3000:
 *   cd simulator-api && npm run dev
 */
import {
  Amount,
  Currency,
  Gateway,
  KitPagos,
  KitPagosError,
  KitPagosErrorCode,
  OrderReference,
  Payer,
  TaxBreakdown,
  type SDKOptions,
} from "kit-pagos-colombia";

const SIMULATOR_KUSHKI_URL = "http://localhost:3000/v1/sim/kushki/charges";

const options: SDKOptions = {
  gateway: Gateway.KUSHKI,
  credentials: {
    [Gateway.KUSHKI]: {
      publicKey: "kushki_public_id_ejemplo_no_real",
      privateKey: "kushki_private_id_ejemplo_no_real",
    },
  },
  baseUrl: SIMULATOR_KUSHKI_URL,
};

async function main(): Promise<void> {
  const kitPagos = new KitPagos(options);
  const currency = new Currency("COP");
  const amount = new Amount("119000.00");

  // Kushki exige este desglose. Al precio ya incluir IVA, la base y el IVA se
  // derivan sin perder centavos y siempre suman exactamente el total cobrado.
  const taxBreakdown = TaxBreakdown.fromTaxIncluded(amount, "0.19", currency);
  const request = {
    amount,
    currency,
    orderReference: new OrderReference(`ORDER-KUSHKI-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      fullName: "Jaime Pavlich",
    }),
    taxBreakdown,
  };

  console.log("=== Kit Pagos Colombia — Ejemplo de pago simulado con Kushki ===\n");
  console.log(`Pasarela activa: ${Gateway.KUSHKI}`);
  console.log(`Endpoint:        ${SIMULATOR_KUSHKI_URL}`);
  console.log(`Monto total:     ${amount.getValue()} ${currency.getCode()}`);
  console.log(`Base gravable:   ${taxBreakdown.subtotalIva.getValue()} COP`);
  console.log(`IVA:             ${taxBreakdown.iva.getValue()} COP\n`);

  console.log("Creando el pago...");
  const transaction = await kitPagos.createPayment(request);

  console.log("Transacción creada exitosamente:");
  console.log(`  ID en la pasarela:  ${transaction.gatewayTransactionId.value}`);
  console.log(`  Estado normalizado: ${transaction.getStatus()}`);
  console.log(`  Estado nativo:      ${transaction.rawStatus}`);
  console.log(`  Monto:              ${transaction.amount.getValue()} ${transaction.currency.getCode()}`);
  console.log(`  Referencia:         ${transaction.orderReference.getValue()}`);
  console.log(`  Aprobada:           ${transaction.isApproved()}\n`);

  console.log("Consultando el estado de la transacción en Kushki...");
  const consulted = await kitPagos.getPaymentStatus(
    transaction.gatewayTransactionId.value,
  );
  console.log(`  ID consultado:      ${consulted.gatewayTransactionId.value}`);
  console.log(`  Estado normalizado: ${consulted.getStatus()}`);
  console.log(`  Estado nativo:      ${consulted.rawStatus}`);
  console.log("\n=== Fin del ejemplo de Kushki ===");
}

main().catch((error: unknown) => {
  if (
    error instanceof KitPagosError &&
    error.code === KitPagosErrorCode.CONNECTION_FAILED
  ) {
    console.error("\nNo se pudo conectar con la API de Simulación.");
    console.error("Iníciala en otra terminal:\n");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  console.error("\nEl ejemplo falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});
