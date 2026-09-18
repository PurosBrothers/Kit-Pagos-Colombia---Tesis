/**
 * Demostración ejecutable de la intercambiabilidad de las cuatro pasarelas
 * (issue #58, cierre de la Iteración 2).
 *
 * Es el argumento central de la tesis convertido en código que se ejecuta y que
 * falla si el argumento deja de ser cierto. Los otros cuatro ejemplos de esta
 * carpeta muestran cada pasarela por separado; este muestra lo que ninguno de
 * ellos puede mostrar solo: que el mismo pago, descrito una sola vez, produce el
 * mismo resultado normalizado por las cuatro.
 *
 * Como los demás ejemplos, importa el SDK por su nombre público y no por rutas
 * relativas a `sdk/src`, porque lo que se demuestra es que la superficie
 * publicada alcanza para integrar un pago completo.
 *
 * La verificación del final no es visual. Compara por código y termina con
 * código de salida distinto de cero si las cuatro pasarelas no coinciden, así
 * que sirve como prueba de regresión ejecutable: si alguien rompe el mapeo de
 * estados de un adaptador, esto se pone rojo.
 *
 * Requisito para ejecutarlo: la API de Simulación arriba en el puerto 3000.
 *
 *     cd simulator-api && npm run dev
 *     cd examples && npm run simulate:interchangeability
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
  type CreatePaymentRequest,
  type Transaction,
} from "kit-pagos-colombia";

/** Las cuatro pasarelas que el framework unifica, en orden de implementación. */
const GATEWAYS = [
  Gateway.WOMPI,
  Gateway.RAPYD,
  Gateway.MERCADOPAGO,
  Gateway.KUSHKI,
] as const;

/**
 * Endpoints de la API de Simulación, uno por pasarela.
 *
 * Esta tabla **no existe en producción**. `baseUrl` es un override cuya única
 * razón de ser es apuntar el SDK al simulador sin tocar código (RF-09); si se
 * omite, cada adaptador usa la URL real de su pasarela. En un despliegue real
 * este objeto desaparece y lo único que cambia entre pasarela y pasarela es el
 * valor de `gateway`.
 *
 * Es una tabla de datos indexada por pasarela, no una cadena de condicionales:
 * agregar una quinta pasarela es agregar una fila, no una rama.
 */
const SIMULATOR_ENDPOINTS: Record<Gateway, string> = {
  [Gateway.WOMPI]: "http://localhost:3000/v1/sim/wompi/transactions",
  [Gateway.RAPYD]: "http://localhost:3000/v1/sim/rapyd/payments",
  [Gateway.MERCADOPAGO]: "http://localhost:3000/v1/sim/mercadopago/payments",
  [Gateway.KUSHKI]: "http://localhost:3000/v1/sim/kushki/charges",
};

/**
 * Credenciales de las cuatro pasarelas, declaradas una sola vez.
 *
 * `SDKOptions.credentials` es un mapa por pasarela, así que el comercio registra
 * todas las que tenga y el SDK usa las de la activa. Son ficticias porque los
 * mocks no autentican, pero recorren el mismo camino que las reales: cada
 * adaptador las lee de aquí y arma su propio esquema de autenticación, que es
 * distinto en las cuatro (Bearer en Wompi y Mercado Pago, firma HMAC en Rapyd,
 * header `Private-Merchant-Id` en Kushki). Ese detalle no aparece en este
 * archivo, y es justamente el punto.
 */
const CREDENTIALS: SDKOptions["credentials"] = {
  [Gateway.WOMPI]: {
    publicKey: "pub_test_ejemplo_no_real",
    privateKey: "prv_test_ejemplo_no_real",
  },
  [Gateway.RAPYD]: {
    publicKey: "rapyd_access_key_ejemplo_no_real",
    privateKey: "rapyd_secret_key_ejemplo_no_real",
  },
  [Gateway.MERCADOPAGO]: {
    publicKey: "APP_USR_public_ejemplo_no_real",
    privateKey: "APP_USR_access_token_ejemplo_no_real",
  },
  [Gateway.KUSHKI]: {
    publicKey: "kushki_public_merchant_id_no_real",
    privateKey: "kushki_private_merchant_id_no_real",
  },
};

/** Lo que este ejemplo necesita recordar de cada cobro para comparar al final. */
interface GatewayOutcome {
  gateway: Gateway;
  transaction: Transaction;
}

/** Ancho fijo de cada columna de la tabla comparativa. */
const TABLE_COLUMNS = [
  { title: "Pasarela", width: 13 },
  { title: "Estado normalizado", width: 19 },
  { title: "Estado nativo", width: 14 },
  { title: "Monto", width: 14 },
  { title: "ID en la pasarela", width: 38 },
] as const;

/**
 * El pago, descrito una sola vez.
 *
 * Este es el bloque que el issue #58 exige que exista una única vez: si hubiera
 * que describir el pago distinto para cada pasarela, no habría intercambiabilidad
 * que demostrar. Se construye con objetos de dominio que validan en su propio
 * constructor, así que un monto con tres decimales o un pagador sin correo falla
 * aquí, antes de que exista una petición de red.
 *
 * El monto va como cadena y no como número porque es el único tipo que conserva
 * la escala: `"150000.00"` sigue leyéndose así, mientras que `150000.00` en
 * JavaScript es indistinguible de `150000`. Esa diferencia importa porque Rapyd
 * calcula la firma sobre el cuerpo serializado.
 *
 * No se pasa `taxBreakdown`. Kushki es la única que exige el monto descompuesto
 * por impuesto, y su adaptador trata el total como exento cuando el comercio no
 * lo provee. Ese es el comportamiento que se quiere demostrar: la exigencia de
 * una pasarela no se filtra al código del comercio.
 */
const payment: CreatePaymentRequest = {
  amount: new Amount("150000.00"),
  currency: new Currency("COP"),
  orderReference: new OrderReference(`ORDER-INTERCHANGE-${Date.now()}`),
  payer: new Payer({
    email: "jaime.pavlich@example.com",
    fullName: "Jaime Pavlich",
  }),
};

/**
 * Cobra el mismo pago por una pasarela.
 *
 * Recibe la pasarela y devuelve la transacción normalizada. No hay ni un
 * condicional por pasarela en el cuerpo: lo único que cambia es el valor que
 * entra por parámetro. Si esta función necesitara un `if` por pasarela, el
 * framework habría fallado en lo que promete, y el issue #58 pide reportarlo en
 * vez de esconderlo detrás de la condición.
 */
async function charge(gateway: Gateway): Promise<Transaction> {
  const kitPagos = new KitPagos({
    gateway,
    credentials: CREDENTIALS,
    baseUrl: SIMULATOR_ENDPOINTS[gateway],
  });

  const result = await kitPagos.createPayment(payment);

  /*
   * El único condicional del ejemplo, y no es por pasarela: es el contrato.
   * `createPayment()` devuelve o una transacción o una redirección pendiente
   * (issue #64), y el compilador no deja leer `result.transaction` hasta que se
   * descarta la redirección. Con tarjeta las cuatro resuelven en la respuesta,
   * así que esta rama no se alcanza hoy; se vuelve alcanzable con PSE.
   */
  if (result.outcome === "REDIRECT_REQUIRED") {
    throw new Error(
      `${gateway} pidió redirigir a ${result.redirect.redirectUrl}. ` +
        "Con tarjeta no debería: revisar el adaptador.",
    );
  }

  return result.transaction;
}

/** Imprime la tabla comparativa, que es donde se ve el argumento. */
function printTable(outcomes: readonly GatewayOutcome[]): void {
  const header = TABLE_COLUMNS.map((column) =>
    column.title.padEnd(column.width),
  ).join(" ");

  console.log(header);
  console.log("─".repeat(header.length));

  for (const { gateway, transaction } of outcomes) {
    const cells = [
      gateway,
      transaction.getStatus(),
      transaction.rawStatus,
      `${transaction.amount.getValue()} ${transaction.currency.getCode()}`,
      transaction.gatewayTransactionId.value,
    ];

    console.log(
      cells
        .map((cell, index) => cell.padEnd(TABLE_COLUMNS[index].width))
        .join(" "),
    );
  }
}

/**
 * Verifica por código lo que la tabla muestra a la vista.
 *
 * Devuelve la lista de discrepancias. Compara contra la primera pasarela, que
 * sirve de referencia arbitraria: lo que importa es que las cuatro coincidan
 * entre sí, no cuál es la correcta.
 *
 * El monto se compara con `equals()` y no con `===` sobre la cadena, porque
 * `"150000"` y `"150000.00"` son el mismo monto escrito distinto, y las cuatro
 * pasarelas devuelven la escala a su manera. Comparar cadenas aquí produciría un
 * fallo que no es un fallo.
 *
 * La referencia de la orden entra en la comparación porque es la que usa el
 * comercio para conciliar: una pasarela que devuelve otra referencia rompe la
 * conciliación aunque el estado y el monto coincidan. Es exactamente el defecto
 * que tenía Kushki (punto 41 del `architecture-log.md`), y por eso queda fijado
 * también acá y no solo en una prueba unitaria.
 */
function findMismatches(outcomes: readonly GatewayOutcome[]): string[] {
  const mismatches: string[] = [];
  const [baseline, ...rest] = outcomes;

  for (const { gateway, transaction } of rest) {
    if (transaction.getStatus() !== baseline.transaction.getStatus()) {
      mismatches.push(
        `${gateway} normalizó el estado como ${transaction.getStatus()} ` +
          `y ${baseline.gateway} como ${baseline.transaction.getStatus()}.`,
      );
    }

    if (!transaction.amount.equals(baseline.transaction.amount)) {
      mismatches.push(
        `${gateway} devolvió un monto de ${transaction.amount.getValue()} ` +
          `y ${baseline.gateway} de ${baseline.transaction.amount.getValue()}.`,
      );
    }

    if (
      transaction.orderReference.getValue() !==
      baseline.transaction.orderReference.getValue()
    ) {
      mismatches.push(
        `${gateway} devolvió la referencia ` +
          `"${transaction.orderReference.getValue()}" en vez de ` +
          `"${baseline.transaction.orderReference.getValue()}", así que el ` +
          "comercio no puede conciliar este cobro contra su propio pedido.",
      );
    }
  }

  return mismatches;
}

async function main(): Promise<void> {
  console.log(
    "=== Kit Pagos Colombia — intercambiabilidad de las cuatro pasarelas ===\n",
  );
  console.log("El mismo pago, descrito una sola vez:");
  console.log(
    `  Monto:      ${payment.amount.getValue()} ${payment.currency.getCode()}`,
  );
  console.log(`  Referencia: ${payment.orderReference.getValue()}`);
  console.log(`  Pagador:    ${payment.payer.email}\n`);

  const outcomes: GatewayOutcome[] = [];

  for (const gateway of GATEWAYS) {
    console.log(`Cobrando por ${gateway}...`);
    outcomes.push({ gateway, transaction: await charge(gateway) });
  }

  console.log("\n=== Lo que devolvió cada pasarela ===\n");
  printTable(outcomes);

  console.log(
    "\nLa columna del estado nativo es la que cambia: APPROVED, CLO, approved\n" +
      "y APPROVAL son la misma cosa dicha de cuatro formas. La del estado\n" +
      "normalizado es la que el comercio programa contra, y es una sola.\n",
  );

  const mismatches = findMismatches(outcomes);

  if (mismatches.length > 0) {
    console.error("=== La intercambiabilidad está rota ===\n");
    for (const mismatch of mismatches) {
      console.error(`  - ${mismatch}`);
    }
    console.error(
      "\nUna diferencia acá no es un detalle del ejemplo: significa que el\n" +
        "comercio tendría que escribir código distinto según la pasarela, que es\n" +
        "justo lo que el framework existe para evitar.\n",
    );
    process.exit(1);
  }

  console.log("=== Verificación ===\n");
  console.log(
    `  Las ${outcomes.length} pasarelas coinciden en estado normalizado, monto y referencia.`,
  );
  console.log("  El código del comercio fue idéntico para las cuatro.\n");
}

main().catch((error: unknown) => {
  /*
   * El fallo esperado al ejecutar esto es que la API de Simulación no esté
   * arriba. Se traduce a una instrucción concreta en vez de un stack trace,
   * porque es el error que va a ver quien corra el ejemplo por primera vez.
   */
  if (
    error instanceof KitPagosError &&
    error.code === KitPagosErrorCode.CONNECTION_FAILED
  ) {
    console.error("\nNo se pudo conectar con la API de Simulación.");
    console.error("Iníciala en otra terminal y vuelve a ejecutar el ejemplo:\n");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  console.error("\nEl ejemplo falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});
