/**
 * Ejemplo end-to-end de un pago simulado con Mercado Pago.
 *
 * Este archivo demuestra la integración del SDK desde la perspectiva de un
 * comercio externo consumiendo el paquete `kit-pagos-colombia`.
 *
 * Requisito para correrlo: la API de Simulación debe estar corriendo en el puerto 3000:
 *   cd simulator-api && npm run dev
 */
import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  KitPagosError,
  KitPagosErrorCode,
  type SDKOptions,
} from "kit-pagos-colombia";

/** Endpoint del mock de Mercado Pago en la API de Simulación local. */
const SIMULATOR_MERCADOPAGO_URL =
  "http://localhost:3000/v1/sim/mercadopago/payments";

/**
 * Paso 1: Configurar el SDK para Mercado Pago.
 * Se define la pasarela, credenciales y baseUrl apuntando al simulador.
 */
const options: SDKOptions = {
  gateway: Gateway.MERCADOPAGO,
  credentials: {
    [Gateway.MERCADOPAGO]: {
      publicKey: "APP_USR_pub_ejemplo_no_real",
      privateKey: "APP_USR_prv_ejemplo_no_real",
    },
  },
  baseUrl: SIMULATOR_MERCADOPAGO_URL,
};

async function main(): Promise<void> {
  const kitPagos = new KitPagos(options);

  console.log("=== Kit Pagos Colombia — Ejemplo de pago simulado con Mercado Pago ===\n");
  console.log(`Pasarela activa: ${Gateway.MERCADOPAGO}`);
  console.log(`Endpoint:        ${SIMULATOR_MERCADOPAGO_URL}\n`);

  /**
   * Paso 2: Describir el pago con el vocabulario de dominio unificado.
   *
   * A diferencia de Wompi, Mercado Pago recibe el monto en pesos decimales (`150000.00`),
   * no en centavos. El comercio escribe el monto igual con Amount, y el adaptador
   * de Mercado Pago se encarga de enviarlo en la unidad que la pasarela espera.
   */
  const request = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-MP-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      fullName: "Jaime Pavlich",
    }),
  };

  console.log("Solicitud de pago:");
  console.log(`  Monto:      ${request.amount.getValue()} ${request.currency.getCode()} (pesos directos, sin centavos)`);
  console.log(`  Referencia: ${request.orderReference.getValue()}`);
  console.log(`  Pagador:    ${request.payer.email}\n`);

  /**
   * Paso 3: Crear el pago en Mercado Pago.
   * Una sola llamada a través de la fachada.
   */
  console.log("Creando el pago...");
  const transaction = await kitPagos.createPayment(request);

  console.log("Transacción creada exitosamente:");
  console.log(`  ID en la pasarela:  ${transaction.gatewayTransactionId.value}`);
  console.log(`  Pasarela de origen: ${transaction.gatewayTransactionId.gateway}`);
  console.log(`  Estado normalizado: ${transaction.getStatus()}`);
  console.log(`  Estado nativo:      ${transaction.rawStatus} (en minúsculas para auditoría)`);
  console.log(`  Monto:              ${transaction.amount.getValue()} ${transaction.currency.getCode()}`);
  console.log(`  Referencia:         ${transaction.orderReference.getValue()}`);
  console.log(`  Pagador:            ${transaction.payer.email}`);
  console.log(`  Aprobada:           ${transaction.isApproved()}`);
  console.log(`  Estado final:       ${transaction.isFinal()}\n`);

  /**
   * Paso 4: Consultar el estado del pago por su ID.
   * ¡En Mercado Pago este flujo sí funciona de verdad contra el simulador!
   */
  console.log("Consultando el estado de la transacción en Mercado Pago...");
  const consulted = await kitPagos.getPaymentStatus(
    transaction.gatewayTransactionId.value
  );

  console.log("Transacción consultada exitosamente:");
  console.log(`  ID consultado:      ${consulted.gatewayTransactionId.value}`);
  console.log(`  Estado normalizado: ${consulted.getStatus()}`);
  console.log(`  Estado nativo:      ${consulted.rawStatus}`);
  console.log(`  Monto:              ${consulted.amount.getValue()} ${consulted.currency.getCode()}\n`);

  console.log("=== Fin del ejemplo de Mercado Pago ===");
}

main().catch((error: unknown) => {
  if (
    error instanceof KitPagosError &&
    error.code === KitPagosErrorCode.CONNECTION_FAILED
  ) {
    console.error("\n❌ No se pudo conectar con la API de Simulación.");
    console.error("Asegúrate de haberla iniciado en otra terminal:\n");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  console.error("\n❌ El ejemplo falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});

