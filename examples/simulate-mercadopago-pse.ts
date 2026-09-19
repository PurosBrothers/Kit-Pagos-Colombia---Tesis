/**
 * Pago con PSE por Mercado Pago contra la API de Simulación (issue #64).
 *
 * Está escrito desde la posición de un desarrollador externo: importa el SDK por
 * su nombre público, como si lo hubiera instalado con `npm install`.
 *
 * ## Qué muestra este ejemplo que el de Wompi no
 *
 * Que **la misma abstracción no implica el mismo esfuerzo**. El código de
 * comercio es el de siempre —objetos de valor del dominio, `createPayment()`,
 * `PaymentResult`— y sin embargo Mercado Pago exige bastante más dato que Wompi
 * para el mismo método de pago:
 *
 * | Dato | Wompi | Mercado Pago |
 * |---|---|---|
 * | documento del pagador | obligatorio | obligatorio |
 * | nombre y apellido separados | no lo pide | obligatorios |
 * | teléfono con indicativo | no lo pide | obligatorio |
 * | dirección completa | no la pide | obligatoria |
 * | IP del pagador | no la pide | obligatoria |
 * | URL de retorno | **opcional** | **obligatoria** |
 *
 * Todo eso está medido contra la API real, no leído de la documentación: cada
 * campo se quitó por separado y se registró la respuesta. El detalle está en
 * `sdk/src/infrastructure/adapters/mercadopago-pse.ts`.
 *
 * La conclusión honesta para la tesis es que la abstracción unifica **la forma de
 * pedir el pago y la de leer el resultado**, no la cantidad de datos que hay que
 * reunir antes. Un comercio que cambia de Wompi a Mercado Pago no reescribe su
 * integración, pero sí tiene que empezar a recolectar la dirección del pagador.
 *
 * ## Por qué corre contra el simulador
 *
 * Porque la Orders API real **no se puede ejercitar con credenciales de prueba**:
 * un token `TEST-` recibe `401` con el mensaje "Test credentials are not
 * supported". Y con credenciales de producción, completar el pago exige que una
 * persona entre al banco y transfiera.
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

/** Raíz de la API de Mercado Pago en el simulador, no el endpoint de pagos. */
const SIMULATOR_MERCADOPAGO_URL = "http://localhost:3000/v1/sim/mercadopago";


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

  console.log("=== Kit Pagos Colombia — PSE con Mercado Pago ===\n");

  /**
   * El banco sale de la pasarela, no del código del comercio.
   *
   * Antes acá había un `"1051"` escrito a mano, y era una deuda visible: en PSE el
   * pagador elige de una lista viva, y un código fijo muestra bancos que ya no están o
   * esconde los que sí. `getPseBanks()` la trae, y el `code` entra en
   * `PaymentMethod.pse()` sin transformarlo.
   */
  const banks = await kitPagos.getPseBanks();
  const banco = banks[0];

  if (!banco) {
    console.error("La pasarela no devolvió ningún banco habilitado para PSE.");
    process.exit(1);
  }

  console.log(`Bancos disponibles: ${banks.length}`);
  console.log(`Elegido:            ${banco.name}  (${banco.code})\n`);

  const request = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-MP-PSE-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      // Nombre y apellido por separado, no `fullName`: partir un nombre no es
      // una operación segura y en Colombia lo habitual son dos apellidos.
      firstName: "Jaime",
      lastName: "Pavlich Mariscal",
      documentType: "CC",
      documentNumber: "1099888777",
      phone: "3001234567",
      phoneAreaCode: "57",
      address: {
        streetName: "Carrera 7",
        streetNumber: "40-62",
        city: "Bogota",
        zipCode: "110231",
        neighborhood: "Chapinero",
      },
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: banco.code }),
    // Obligatoria en Mercado Pago, a diferencia de Wompi: sin ella la Orders API
    // responde 400 por `config` faltante.
    returnUrlConfig: new ReturnUrlConfig("https://comercio-de-prueba.example.com/retorno"),
    // La IP viaja en la solicitud y no en `Payer` porque es un dato de la
    // petición concreta, no de la persona.
    ipAddress: "200.100.50.25",
  };

  console.log("Solicitud de pago:");
  console.log(`  Monto:        ${request.amount.getValue()} ${request.currency.getCode()}`);
  console.log(`  En pesos:     150000 (Mercado Pago rechaza decimales en total_amount)`);
  console.log(`  Referencia:   ${request.orderReference.getValue()}`);
  console.log(`  Pagador:      ${request.payer.firstName} ${request.payer.lastName} <${request.payer.email}>`);
  console.log(`  Documento:    ${request.payer.documentType} ${request.payer.documentNumber}`);
  console.log(`  Teléfono:     +${request.payer.phoneAreaCode} ${request.payer.phone}`);
  console.log(`  Ciudad:       ${request.payer.address?.city}`);
  console.log(`  Método:       ${request.paymentMethod.type} contra el banco "${banco.code}" (${banco.name})\n`);

  const result = await kitPagos.createPayment(request);

  // Con PSE esta es la única rama que se alcanza, y el compilador no deja
  // leer `result.transaction` sin haberla descartado antes.
  if (result.outcome !== "REDIRECT_REQUIRED") {
    console.error("Se esperaba una redirección pendiente y llegó una transacción.");
    process.exit(1);
  }

  console.log("Redirección pendiente:");
  console.log(`  URL del banco:   ${result.redirect.redirectUrl}`);
  console.log(`  ID en pasarela:  ${result.redirect.gatewayTransactionId.value}`);
  console.log(`  Estado nativo:   ${result.redirect.rawStatus}\n`);

  // Diferencia medible con Wompi: allá la URL no viene en la creación y hay que
  // consultar hasta que aparezca; acá llega de una, en una sola llamada.
  console.log("La URL llegó en la respuesta de creación: Mercado Pago no necesita sondeo.");
  console.log("El identificador empieza con ORD porque es una orden, no un pago con tarjeta:");
  console.log("el SDK usa eso para saber a qué endpoint consultarle el estado.\n");

  console.log("Consultando el estado después de la redirección...");
  const transaction = await kitPagos.getPaymentStatus(
    result.redirect.gatewayTransactionId.value,
  );

  console.log(`  Estado normalizado:  ${transaction.getStatus()}`);
  console.log(`  Estado nativo:       ${transaction.rawStatus}`);
  console.log(`  ¿Aprobado?           ${transaction.isApproved()}`);
  console.log(`  Monto:               ${transaction.amount.getValue()} ${transaction.currency.getCode()}`);
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

  // Los datos que Mercado Pago exige y el dominio deja opcionales se verifican
  // localmente: el error nombra todos los que faltan de una vez, en lugar de
  // llegar como un HTTP 400 que los va revelando de a uno.
  if (error instanceof KitPagosError && error.code === KitPagosErrorCode.INVALID_REQUEST) {
    console.error(`\nLa solicitud es inválida: ${error.message}\n`);
    process.exit(1);
  }

  console.error("\nEl ejemplo falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});
