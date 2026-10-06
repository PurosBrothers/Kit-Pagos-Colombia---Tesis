/**
 * Pago con PSE en Kushki contra la API de Simulación.
 *
 * ## Nivel de evidencia de este ejemplo
 *
 * Este ejemplo corre contra el simulador, pero **el flujo que ejecuta está medido
 * contra la API UAT real de Kushki** (18 de septiembre de 2026): lista de bancos,
 * token, inicio y consulta de estado, con las credenciales de API del comercio de
 * prueba. Se escribió primero contra la documentación y después se midió, y medirlo
 * encontró cuatro defectos que el simulador no podía mostrar, porque el simulador
 * reproducía lo que el código esperaba. Están en el punto 48 del `architecture-log.md`.
 *
 * Lo único que **no** está medido es el desenlace: llevar una transferencia hasta
 * `APPROVED` o `DECLINED` exige que una persona autorice en el portal del banco. Acá
 * el simulador la aprueba para que el ejemplo muestre el ciclo completo.
 *
 * ## Qué demuestra
 *
 * Tres cosas que Kushki hace distinto de las otras tres pasarelas:
 *
 * 1. **PSE no se llama PSE**: el mecanismo es Transfer In, y la lista de bancos en
 *    Colombia **no es opcional**, porque el `bankId` tiene que salir de ahí.
 * 2. **La URL de retorno del comercio viaja antes del cobro**, al pedir el token, y
 *    no junto con el pago. Es el único caso de las cuatro. Por eso el camino de
 *    tarjeta de Kushki no tiene dónde poner una URL de retorno: no es un olvido del
 *    adaptador, es que ese flujo es síncrono y no redirige a nadie.
 * 3. **El destino de la redirección no es predecible desde el código.** Kushki tiene
 *    PSE 1.0, donde la URL lleva al portal de PSE y el pagador todavía tiene que
 *    pulsar "Ir al banco", y PSE Avanza 2.0, donde lleva directo al banco. Depende de
 *    la configuración del comercio, así que este ejemplo no afirma a dónde llega.
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

/** Raíz de la API de Kushki en el simulador, no el endpoint de cobros. */
const SIMULATOR_KUSHKI_URL = "http://localhost:3000/v1/sim/kushki";

const options: SDKOptions = {
  gateway: Gateway.KUSHKI,
  credentials: {
    [Gateway.KUSHKI]: {
      // Las dos credenciales de Kushki no son intercambiables y cada paso usa una:
      // la pública para la lista de bancos y el token, la privada para iniciar el
      // cobro y consultar el estado.
      publicKey: "public-merchant-id-ejemplo-no-real",
      privateKey: "private-merchant-id-ejemplo-no-real",
    },
  },
  baseUrl: SIMULATOR_KUSHKI_URL,
};

async function main(): Promise<void> {
  const kitPagos = new KitPagos(options);

  console.log("=== Kit Pagos Colombia — PSE en Kushki (Transfer In) ===\n");

  /**
   * En Kushki este paso es obligatorio, no una comodidad: su referencia dice que el
   * endpoint de bancos *"is required only for Transfer In payment method in
   * Colombia"*. Sin él no hay `bankId` con el que pedir el token.
   */
  const banks = await kitPagos.getPseBanks();
  const banco = banks[0];

  if (!banco) {
    console.error("Kushki no devolvió ningún banco habilitado para transferencias.");
    process.exit(1);
  }

  console.log(`Bancos disponibles: ${banks.length}`);
  console.log(`Elegido:            ${banco.name}  (bankId ${banco.code})`);
  // La lista nativa de Kushki encabeza con `{ code: "0", name: "A continuación
  // seleccione su banco" }`, el relleno de un `<select>` viajando dentro de los datos.
  // El SDK lo descarta, así que acá tomar el primer elemento es seguro.
  console.log("                    (el SDK ya descartó el elemento de relleno con el que");
  console.log("                     Kushki encabeza su lista, que no es un banco)\n");

  const request = {
    amount: new Amount("150000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-PSE-KUSHKI-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      // El enum de la API de Kushki incluye tipos de documento de otros países
      // (`RUT`, `CURP`, `RFC`...). El SDK solo acepta los cinco colombianos: que la
      // API los liste no los hace válidos para una transacción de Colombia.
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: banco.code }),
    // Obligatoria en PSE, y opcional en tarjeta. Acá está la diferencia de Kushki:
    // esta URL viaja en el paso del token, antes de que exista el cobro.
    returnUrlConfig: new ReturnUrlConfig(
      "https://comercio-de-prueba.example.com/retorno",
    ),
  };

  console.log("Solicitud de pago:");
  console.log(`  Monto:        ${request.amount.getValue()} ${request.currency.getCode()}`);
  console.log("  Ojo:          Kushki no recibe un total, recibe el monto desglosado");
  console.log("                en base gravable, IVA, exento e impuesto al consumo.");
  console.log(`  Referencia:   ${request.orderReference.getValue()}`);
  console.log(`  Documento:    ${request.payer.documentType} ${request.payer.documentNumber}`);
  console.log(`  Método:       ${request.paymentMethod.type} vía bankId ${banco.code}\n`);

  console.log("Lo que pasa por debajo, y que este código no muestra:");
  console.log("  1. POST /transfer/v1/tokens  — token, con el banco y la URL de retorno");
  console.log("  2. POST /transfer/v1/init    — inicia, y devuelve la redirección");
  console.log("     El monto se repite en los dos pasos: Kushki rechaza el inicio si");
  console.log("     solo le llega el token, aunque ya lo tenga guardado.\n");

  const result = await kitPagos.createPayment(request);

  if (result.outcome !== "REDIRECT_REQUIRED") {
    console.error("Se esperaba una redirección pendiente y llegó una transacción.");
    process.exit(1);
  }

  console.log("Redirección pendiente:");
  console.log(`  URL:             ${result.redirect.redirectUrl}`);
  console.log(
    "                   (portal de PSE o banco directo, según si el comercio tiene\n" +
      "                    PSE 1.0 o PSE Avanza 2.0. El SDK no lo decide ni lo sabe.)",
  );
  // El identificador de la transacción **es el token** del primer paso: Kushki
  // consulta el estado por token, no por un id nuevo. El comercio lo usa en
  // `getPaymentStatus()` sin necesitar saber que es un token.
  console.log(`  ID en pasarela:  ${result.redirect.gatewayTransactionId.value}`);
  console.log(`  Estado nativo:   ${result.redirect.rawStatus}\n`);

  console.log("Consultando el estado después de la redirección...");
  console.log(
    "  Kushki no publica cómo distinguir un token de transferencia de un ticket de\n" +
      "  tarjeta, y consulta cada uno en una ruta distinta. Así que el SDK prueba una y\n" +
      "  pasa a la otra si le responden que no conocen el identificador, en vez de\n" +
      "  adivinar por la forma y equivocarse. La de transferencia va primero porque es la\n" +
      "  única que sabe contestar que no conoce un identificador: medido, la de tarjeta\n" +
      "  responde 403 para cualquiera, incluso para uno inventado.\n",
  );

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
