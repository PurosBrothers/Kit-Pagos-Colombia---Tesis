/**
 * Ejemplo de punta a punta de un pago simulado por Wompi (issue #31, actualizado en el #55).
 *
 * Este archivo está escrito desde la perspectiva de un desarrollador externo:
 * vive por fuera del paquete del SDK y lo importa por su nombre público, igual
 * que si lo hubiera instalado con `npm install kit-pagos-colombia`. No usa rutas
 * relativas hacia `sdk/src` a propósito, porque el objetivo no es probar código
 * interno sino demostrar que la superficie pública del paquete alcanza para
 * integrar un pago completo.
 *
 * Prerrequisito para correrlo: la API de Simulación tiene que estar levantada en
 * el puerto 3000. Ver el README de esta carpeta.
 */
import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  PaymentMethod,
  KitPagosError,
  KitPagosErrorCode,
  type SDKOptions,
} from "kit-pagos-colombia";

// Raíz de la API de Wompi en el simulador. Desde el issue #64 es la raíz y no el
// endpoint de transacciones: el adaptador le agrega la ruta que necesite, porque
// PSE además consulta /merchants para el token de aceptación. Esto, junto con las
// llaves, debería vivir en configuración externa como un .env.
const SIMULATOR_WOMPI_URL = "http://localhost:3000/v1/sim/wompi";

/**
 * Paso 1: configurar el SDK.
 *
 * Es la única decisión que un comercio tiene que tomar: qué pasarela usar y con
 * qué credenciales. `baseUrl` apunta al simulador; en producción se omite y cada
 * adaptador usa el endpoint real de su pasarela. Las credenciales de este ejemplo
 * son ficticias porque el mock no autentica, pero recorren el mismo camino que
 * las reales.
 */
const options: SDKOptions = {
  gateway: Gateway.WOMPI,
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_ejemplo_no_real",
      privateKey: "prv_test_ejemplo_no_real",
      // Wompi firma cada transacción saliente con este secreto y no crea ninguna
      // sin él: la API real responde `422 "Firma de integridad requerida no
      // enviada"`. Desde el issue #92 el SDK lo exige por adelantado, así que un
      // comercio que configura credenciales recibe un mensaje que nombra el ajuste
      // que falta en lugar de ese 422. Es un valor distinto del secreto de eventos
      // que verifica los webhooks: uno firma lo que sale, el otro valida lo que
      // entra, y Wompi los entrega juntos en el mismo panel.
      integritySecret: "test_integrity_ejemplo_no_real",
    },
  },
  baseUrl: SIMULATOR_WOMPI_URL,
};

async function main(): Promise<void> {
  const kitPagos = new KitPagos(options);

  console.log("=== Kit Pagos Colombia — ejemplo de pago simulado por Wompi ===\n");
  console.log(`Pasarela activa: ${Gateway.WOMPI}`);
  console.log(`Endpoint: ${SIMULATOR_WOMPI_URL}\n`);

  /**
   * Paso 2: describir el pago con vocabulario del dominio.
   *
   * Acá no se escribe ningún campo nativo de Wompi como `amount_in_cents`. Se usan
   * objetos de valor que validan en su propio constructor: un monto con más de dos
   * decimales, una divisa que no sea ISO 4217 o un pagador sin correo fallan acá,
   * antes de que exista cualquier petición de red.
   *
   * El monto se escribe como string, no como number. Es el único tipo que preserva
   * la escala: `new Amount("150000.00")` sigue leyéndose como "150000.00", mientras
   * que `150000.00` en JavaScript es indistinguible de `150000`. Esa diferencia
   * importa porque Rapyd calcula la firma de la petición sobre el cuerpo serializado,
   * donde "19.90" y "19.9" no son lo mismo.
   */
  const request = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      fullName: "Jaime Pavlich",
    }),
    /**
     * El token de la tarjeta, y nada sobre la tarjeta misma.
     *
     * El comercio lo obtiene de la tokenización de la propia pasarela —en Wompi,
     * `POST /v1/tokens/cards` desde el navegador— y el SDK lo trata como una cadena
     * opaca. El número de la tarjeta nunca llega a este código, que es lo que
     * mantiene al servidor del comercio fuera del alcance de PCI DSS. `installments`
     * son las cuotas: una significa un solo cobro.
     */
    paymentMethod: PaymentMethod.card("tok_test_ejemplo_no_real", {
      installments: 1,
    }),
  };

  console.log("Solicitud de pago:");
  console.log(`  Monto:       ${request.amount.getValue()} ${request.currency.getCode()}`);
  // Lo que el adaptador le va a mandar a Wompi. Se imprime para mostrar que la
  // conversión a centavos ocurre en la capa de infraestructura, y no la escribe
  // el comercio.
  console.log(`  En centavos: ${request.amount.toMinorUnits(request.currency)} (lo que recibe Wompi)`);
  console.log(`  Referencia:  ${request.orderReference.getValue()}`);
  console.log(`  Pagador:     ${request.payer.email}`);
  console.log(`  Cuotas:      ${request.paymentMethod.installments}\n`);

  /**
   * Paso 3: crear el pago.
   *
   * Una sola llamada. Por dentro el SDK resuelve la pasarela activa, obtiene sus
   * credenciales, construye el adaptador de Wompi, traduce los objetos de valor al
   * formato nativo, hace la petición HTTP y normaliza la respuesta. Nada de eso se
   * filtra hasta acá.
   */
  const result = await kitPagos.createPayment(request);

  // createPayment() devuelve o una transacción o una redirección pendiente, y el
  // compilador obliga a distinguirlas: `result.transaction` no existe hasta que se
  // descarta el caso de redirección. Un cobro con tarjeta en Wompi nunca redirige
  // —el comercio cobra el token de servidor a servidor— así que esta rama no se
  // alcanza acá. Es la rama que toma PSE, y también el flujo de tarjeta de Rapyd.
  if (result.outcome === "REDIRECT_REQUIRED") {
    console.log(`El pago requiere redirigir a: ${result.redirect.redirectUrl}`);
    return;
  }

  const transaction = result.transaction;

  console.log("Transacción creada:");
  console.log(`  ID de la pasarela:   ${transaction.gatewayTransactionId.value}`);
  console.log(`  Pasarela de origen:  ${transaction.gatewayTransactionId.gateway}`);
  console.log(`  Estado normalizado:  ${transaction.getStatus()}`);
  console.log(`  Estado nativo:       ${transaction.rawStatus}`);
  console.log(`  Monto:               ${transaction.amount.getValue()} ${transaction.currency.getCode()}`);
  console.log(`  Referencia:          ${transaction.orderReference.getValue()}`);
  console.log(`  Pagador:             ${transaction.payer.email}`);
  console.log(`  Aprobada:            ${transaction.isApproved()}`);
  console.log(`  Estado final:        ${transaction.isFinal()}\n`);

  /**
   * Paso 4: consultar el estado del pago. **Con tarjeta este paso no es opcional.**
   *
   * El cobro de arriba volvió `PENDING` y no `APPROVED`, y eso es lo que Wompi hace
   * de verdad: medido contra `sandbox.wompi.co`, `POST /transactions` responde
   * `PENDING` con `finalized_at: null` y la transacción se resuelve unos 600 ms
   * después. Así que el desenlace de un cobro con tarjeta nunca está en la respuesta
   * de la creación: el comercio tiene que consultarlo, exactamente como acá abajo.
   *
   * El id que se pasa es el identificador nativo que Wompi devolvió al crear el pago.
   */
  console.log("Consultando el estado de la transacción...");
  try {
    const consulted = await kitPagos.getPaymentStatus(
      transaction.gatewayTransactionId.value,
    );
    console.log(`  ID consultado:      ${consulted.gatewayTransactionId.value}`);
    console.log(`  Estado consultado:  ${consulted.getStatus()}`);
    console.log(`  Aprobada:           ${consulted.isApproved()}\n`);
  } catch (error) {
    if (error instanceof KitPagosError && error.code === KitPagosErrorCode.RESOURCE_NOT_FOUND) {
      console.log(`  No se encontró la transacción. Código de error: ${error.code}`);
      console.log(`  Detalle: ${error.message}`);
    } else {
      throw error;
    }
  }

  console.log("=== Fin del ejemplo ===");
}

main().catch((error: unknown) => {
  // El único fallo esperable al correr esto es que la API de Simulación no esté
  // levantada. Se traduce a una instrucción concreta en vez de un volcado de pila.
  if (error instanceof KitPagosError && error.code === KitPagosErrorCode.CONNECTION_FAILED) {
    console.error("\nNo se pudo conectar con la API de Simulación.");
    console.error("Levantala en otra terminal y volvé a correr el ejemplo:\n");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  console.error("\nEl ejemplo falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});
