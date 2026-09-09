/**
 * Ejemplo end-to-end de un pago simulado con Wompi (issue #31).
 *
 * Este archivo esta escrito desde la perspectiva de un desarrollador externo:
 * vive fuera del paquete del SDK y lo importa por su nombre publico, igual que
 * si lo hubiera instalado con `npm install kit-pagos-colombia`. No usa rutas
 * relativas hacia `sdk/src` a proposito, porque el objetivo no es probar el
 * codigo interno sino demostrar que la superficie publica del paquete alcanza
 * para integrar un pago completo.
 *
 * Requisito para correrlo: la API de Simulacion tiene que estar arriba en el
 * puerto 3000. Ver el README de esta carpeta.
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

/** Endpoint del mock de Wompi que expone la API de Simulacion. Esto al igual que las keys, debería ir en 
 * un archivo de configuración externo como un .env.*/
const SIMULATOR_WOMPI_URL = "http://localhost:3000/v1/sim/wompi/transactions";

/**
 * Paso 1: configurar el SDK.
 *
 * Es lo unico que un comercio necesita decidir: con cual pasarela trabaja y con
 * que credenciales. `baseUrl` apunta al simulador; en produccion se omite y
 * cada Adapter usa el endpoint real de su pasarela. Las credenciales de este
 * ejemplo son ficticias porque el mock no autentica, pero viajan por el mismo
 * camino que las reales.
 */
const options: SDKOptions = {
  gateway: Gateway.WOMPI,
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_ejemplo_no_real",
      privateKey: "prv_test_ejemplo_no_real",
    },
  },
  baseUrl: SIMULATOR_WOMPI_URL,
};

async function main(): Promise<void> {
  const kitPagos = new KitPagos(options);

  console.log("=== Kit Pagos Colombia — ejemplo de pago simulado con Wompi ===\n");
  console.log(`Pasarela activa: ${Gateway.WOMPI}`);
  console.log(`Endpoint: ${SIMULATOR_WOMPI_URL}\n`);

  /**
   * Paso 2: describir el pago con el vocabulario del dominio.
   *
   * No se escriben campos nativos de Wompi como `amount_in_cents`. Se usan
   * objetos de valor que validan en su propio constructor: un monto con mas de
   * dos decimales, una divisa que no sea ISO 4217 o un pagador sin correo
   * fallan aca mismo, antes de que exista cualquier peticion de red.
   *
   * El monto se escribe como texto y no como numero. Es el unico tipo que
   * conserva la escala: `new Amount("150000.00")` sigue valiendo "150000.00" al
   * leerlo, mientras `150000.00` en JavaScript es indistinguible de `150000`.
   * Esa diferencia importa porque Rapyd calcula la firma de la peticion sobre el
   * cuerpo serializado, donde "19.90" y "19.9" no son lo mismo.
   */
  const request = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      fullName: "Jaime Pavlich",
    }),
  };

  console.log("Solicitud de pago:");
  console.log(`  Monto:      ${request.amount.getValue()} ${request.currency.getCode()}`);
  // Lo que el Adapter le va a mandar a Wompi. Se imprime para dejar ver que la
  // traduccion a centavos ocurre en la infraestructura y no la escribe el comercio.
  console.log(`  En centavos: ${request.amount.toMinorUnits(request.currency)} (lo que recibe Wompi)`);
  console.log(`  Referencia: ${request.orderReference.getValue()}`);
  console.log(`  Pagador:    ${request.payer.email}\n`);

  /**
   * Paso 3: crear el pago.
   *
   * Una sola llamada. Por dentro el SDK resuelve la pasarela activa, obtiene
   * sus credenciales, construye el Adapter de Wompi, traduce los objetos de
   * valor al formato nativo, hace la peticion HTTP y normaliza la respuesta.
   * Nada de eso se filtra hacia aca.
   */
  const transaction = await kitPagos.createPayment(request);

  console.log("Transaccion recibida:");
  console.log(`  ID en la pasarela:  ${transaction.gatewayTransactionId.value}`);
  console.log(`  Pasarela de origen: ${transaction.gatewayTransactionId.gateway}`);
  console.log(`  Estado normalizado: ${transaction.getStatus()}`);
  console.log(`  Estado nativo:      ${transaction.rawStatus}`);
  console.log(`  Monto:              ${transaction.amount.getValue()} ${transaction.currency.getCode()}`);
  console.log(`  Referencia:         ${transaction.orderReference.getValue()}`);
  console.log(`  Pagador:            ${transaction.payer.email}`);
  console.log(`  Aprobada:           ${transaction.isApproved()}`);
  console.log(`  Estado final:       ${transaction.isFinal()}\n`);

  /**
   * Paso 4: consultar el estado del pago.
   *
   * Esta parte todavia no funciona, y se deja en el ejemplo justamente por eso:
   * la API de Simulacion solo implementa creacion de pagos, asi que el SDK
   * responde con un error tipado en vez de un fallo silencioso o un texto
   * suelto. Es la demostracion de como un comercio distingue por codigo que
   * fue lo que paso.
   */
  /* console.log("Consultando el estado de la transaccion...");
  try {
    const consulted = await kitPagos.getPaymentStatus(
      transaction.gatewayTransactionId.value,
    );
    console.log(`  Estado consultado: ${consulted.getStatus()}\n`);
  } catch (error) {
    if (error instanceof KitPagosError && error.code === KitPagosErrorCode.UNSUPPORTED_OPERATION) {
      console.log(`  No disponible todavia. Codigo de error: ${error.code}`);
      console.log(`  Detalle: ${error.message}`);
    } else {
      throw error;
    }
  } */

  console.log("=== Fin del ejemplo ===");
}

main().catch((error: unknown) => {
  // El unico fallo esperable al correr esto es que la API de Simulacion no este
  // arriba. Se traduce a una instruccion concreta en vez de una traza cruda.
  if (error instanceof KitPagosError && error.code === KitPagosErrorCode.CONNECTION_FAILED) {
    console.error("\nNo se pudo conectar con la API de Simulacion.");
    console.error("Arrancala en otra terminal y vuelve a correr el ejemplo:\n");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  console.error("\nEl ejemplo fallo de forma inesperada:");
  console.error(error);
  process.exit(1);
});
