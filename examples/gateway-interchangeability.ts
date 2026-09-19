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
  PaymentMethod,
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
 *
 * Cada URL termina en la **raíz de la pasarela** y no en el recurso del cobro. La primera
 * versión de este ejemplo apuntaba a `.../wompi/transactions` y funcionaba mientras el
 * adaptador tocaba una sola ruta; dejó de funcionar cuando el cobro con tarjeta agregó
 * llamadas fuera del recurso —el token de aceptación de Wompi vive en `merchants/{llave}`—
 * y devolvía un 404 que acusaba al simulador de no tener la ruta. Es la consecuencia
 * concreta del hallazgo 2 del punto 42: `baseUrl` es un escalar y no distingue entre la
 * raíz y el recurso, así que el único valor que no se rompe al crecer el adaptador es la
 * raíz. Los otros ocho ejemplos ya la usaban.
 */
const SIMULATOR_ENDPOINTS: Record<Gateway, string> = {
  [Gateway.WOMPI]: "http://localhost:3000/v1/sim/wompi",
  [Gateway.RAPYD]: "http://localhost:3000/v1/sim/rapyd",
  [Gateway.MERCADOPAGO]: "http://localhost:3000/v1/sim/mercadopago",
  [Gateway.KUSHKI]: "http://localhost:3000/v1/sim/kushki",
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
  /*
   * El método de pago es el mismo para las cuatro, y el token es opaco: cada pasarela lo
   * emite con su propio formato y el SDK no lo interpreta. Acá es de mentira porque quien
   * responde es la API de Simulación; en producción lo genera el frontend del comercio, que
   * es el único lugar donde puede tocar la tarjeta sin meter al servidor dentro del alcance
   * de PCI DSS.
   *
   * Rapyd lo recibe y no lo usa, porque cobra la tarjeta en su propia página. Que eso no
   * obligue a describir el pago dos veces es parte de lo que este ejemplo demuestra.
   */
  paymentMethod: PaymentMethod.card("tok_test_interchange", { installments: 1 }),
};

/**
 * Cobra el mismo pago por una pasarela.
 *
 * Recibe la pasarela y devuelve la transacción normalizada. No hay ni un
 * condicional por pasarela en el cuerpo: lo único que cambia es el valor que
 * entra por parámetro. Si esta función necesitara un `if` por pasarela, el
 * framework habría fallado en lo que promete, y el issue #58 pide reportarlo en
 * vez de esconderlo detrás de la condición.
 *
 * Lo que sí cambia por pasarela, y esta función absorbe sin preguntar cuál es, es
 * **cuántas llamadas hacen falta**: una para Mercado Pago y Kushki, que traen el
 * desenlace en la respuesta; dos para Wompi, que nace pendiente; tres para Rapyd,
 * que además redirige. El comercio escribe el caso de tres y le sirve para las
 * cuatro.
 */
async function charge(gateway: Gateway): Promise<Transaction> {
  const kitPagos = new KitPagos({
    gateway,
    credentials: CREDENTIALS,
    baseUrl: SIMULATOR_ENDPOINTS[gateway],
  });

  const result = await kitPagos.createPayment(payment);

  /*
   * Los dos condicionales del ejemplo, y ninguno es por pasarela: los dos son ramas del
   * contrato, iguales para las cuatro.
   *
   * El primero es la forma del resultado. `createPayment()` devuelve o una transacción o
   * una redirección pendiente, y el compilador no deja leer `result.transaction` hasta que
   * se descarta la redirección. Cuando este ejemplo se escribió se creía que con tarjeta
   * las cuatro resolvían en la respuesta y que esta rama solo se alcanzaba con PSE. Medir
   * el cobro con tarjeta contra los sandboxes reales lo desmintió: Rapyd cobra la tarjeta
   * en su propia página alojada, así que redirige también con tarjeta (punto 50 del
   * `architecture-log.md`).
   *
   * El segundo es si el estado ya es definitivo. Wompi crea la transacción en `PENDING` y
   * la resuelve después, mientras Mercado Pago y Kushki traen el desenlace en el cuerpo del
   * `POST`. Consultar cuando falta el desenlace es lo que hace que las cuatro terminen
   * comparables, y es la misma línea para todas.
   */
  if (result.outcome === "REDIRECT_REQUIRED") {
    /*
     * Hace de pagador. En producción esto no es código del comercio: es la persona abriendo
     * la página de la pasarela y poniendo su tarjeta. Contra la API de Simulación alcanza
     * con visitar la URL, que es a propósito el destino real de `redirect_url`, para que el
     * ejemplo recorra el flujo en el orden verdadero —crear, redirigir, consultar— en vez
     * de saltarse el paso del medio.
     */
    await fetch(result.redirect.redirectUrl);

    return kitPagos.getPaymentStatus(
      result.redirect.gatewayTransactionId.value,
    );
  }

  if (result.transaction.isFinal()) {
    return result.transaction;
  }

  return kitPagos.getPaymentStatus(
    result.transaction.gatewayTransactionId.value,
  );
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
