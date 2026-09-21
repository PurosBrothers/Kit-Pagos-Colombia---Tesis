/**
 * Demo interactiva por terminal del flujo completo del SDK (issue #89).
 *
 * ## Qué muestra que los otros diez ejemplos no
 *
 * Los otros diez son scripts con valores fijos: cada uno cobra un monto escrito a
 * mano contra una pasarela decidida de antemano. Muestran **que** el SDK funciona.
 * Este muestra **qué está haciendo**, y lo muestra con datos reales.
 *
 * La afirmación central de la tesis es que el SDK normaliza cuatro pasarelas
 * heterogéneas detrás de un mismo puerto. Hasta acá esa afirmación se podía
 * verificar leyendo los adaptadores o creyéndole a la documentación. Este programa
 * la vuelve observable: quien elige Wompi ve salir `amount_in_cents: 15000000`, y
 * quien elige Mercado Pago ve salir `transaction_amount` en unidades decimales,
 * para el mismo monto de dominio.
 *
 * ## La decisión de diseño que hace que esto sirva
 *
 * **Nada de lo que se imprime está escrito a mano.** Las peticiones salen de un
 * espía sobre `globalThis.fetch`, así que son literalmente los bytes que el
 * adaptador envió y los que la pasarela respondió. Si el adaptador cambia lo que
 * manda, esta salida cambia sola.
 *
 * Esa es la diferencia entre un artefacto de demostración y un texto que describe
 * el código: un texto se desincroniza a la primera refactorización y entonces
 * miente con mucha seguridad. Por eso el programa tampoco tiene conocimiento de
 * pasarelas propio: no hay ni un `switch` sobre `Gateway` con detalles de ninguna
 * API, porque eso duplicaría en `examples/` lo que vive en
 * `sdk/src/infrastructure/adapters/`.
 *
 * El espía funciona porque los cuatro adaptadores llaman al `fetch` global sin
 * importarlo, así que envolverlo los intercepta a los cuatro por igual. Es
 * agnóstico de pasarela por construcción, que es exactamente lo que el issue pide.
 *
 * ## Sin dependencias nuevas
 *
 * `readline/promises` del núcleo de Node alcanza para leer opciones por consola.
 * Parte de lo que este ejemplo demuestra es que consumir el SDK no exige nada
 * especial, y meter una librería de prompts justo acá lo debilitaría.
 *
 * ## Cómo correrlo
 *
 *     cd simulator-api && npm run dev
 *     cd examples && npm run demo
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
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
  type CreatePaymentRequest,
  type PayerAttributes,
  type PaymentMethodType,
  type PseBank,
  type Transaction,
} from "kit-pagos-colombia";

// ---------------------------------------------------------------------------
// El espía de red
// ---------------------------------------------------------------------------

/** Una llamada HTTP tal como salió y tal como volvió. */
interface HttpExchange {
  method: string;
  url: string;
  requestBody: string | null;
  status: number;
  responseBody: string;
}

const exchanges: HttpExchange[] = [];

/**
 * Envuelve el `fetch` global para quedarse con lo que viajó.
 *
 * Clona la respuesta antes de leerla porque el cuerpo de una `Response` se
 * consume una sola vez: leerlo acá sin clonar le dejaría al adaptador un cuerpo
 * vacío, y el ejemplo rompería lo que vino a observar.
 */
function installNetworkSpy(): void {
  const originalFetch = globalThis.fetch;

  /*
   * Los parámetros se derivan de `typeof fetch` en vez de escribirse como
   * `RequestInfo | URL`: ese tipo viene de las librerías DOM, que este paquete no
   * carga, y fijarlo a mano ataría la demo a la versión de los tipos de Node.
   */
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const response = await originalFetch(...args);
    const body = init?.body;

    exchanges.push({
      method: init?.method ?? "GET",
      url: typeof input === "string" ? input : String(input),
      requestBody: typeof body === "string" ? body : null,
      status: response.status,
      responseBody: await response.clone().text(),
    });

    return response;
  };
}

/** Devuelve lo capturado desde la última vez y limpia el registro. */
function drainExchanges(): HttpExchange[] {
  return exchanges.splice(0, exchanges.length);
}

/** Reindenta un JSON para que se pueda leer; si no es JSON, lo devuelve crudo. */
function formatJson(raw: string | null): string {
  if (!raw) {
    return "(sin cuerpo)";
  }

  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Imprime las llamadas que hizo la operación anterior.
 *
 * El número de llamadas es en sí mismo parte de lo que hay que ver: una para
 * Mercado Pago y Kushki, dos para Wompi, que pide un token de aceptación antes de
 * cobrar, y dos más una redirección para Rapyd. El comercio escribió una sola
 * llamada al SDK en los cuatro casos.
 */
function printExchanges(title: string): void {
  const captured = drainExchanges();

  console.log(`\n--- ${title}: ${captured.length} llamada(s) HTTP real(es) ---`);

  captured.forEach((exchange, index) => {
    console.log(`\n[${index + 1}] ${exchange.method} ${exchange.url}`);
    console.log(`    respondió ${exchange.status}`);

    if (exchange.requestBody) {
      console.log("\n  Lo que el adaptador envió:");
      console.log(indent(formatJson(exchange.requestBody)));
    }

    console.log("\n  Lo que la pasarela respondió:");
    console.log(indent(formatJson(exchange.responseBody)));
  });
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Las preguntas
// ---------------------------------------------------------------------------

/**
 * La consola, creada solo si de verdad se va a preguntar algo.
 *
 * Es perezosa porque `createInterface` abre `stdin`, y abrirlo en el modo no
 * interactivo tenía una consecuencia concreta: cuando la tubería se agotaba en
 * medio de una petición HTTP, el evento de cierre disparaba un rechazo que nadie
 * estaba esperando y tumbaba el proceso justo después de cobrar.
 */
let openTerminal: ReturnType<typeof createInterface> | undefined;

function terminal(): ReturnType<typeof createInterface> {
  openTerminal ??= createInterface({ input: stdin, output: stdout });
  return openTerminal;
}

/**
 * Respuestas dadas por argumentos, que se consumen antes de preguntar nada.
 *
 * `npm run demo` recorre el flujo preguntando, que es el caso de uso del issue.
 * `npm run demo -- wompi pse` recorre el mismo flujo sin preguntar, tomando estos
 * valores en el orden en que se habrían tecleado y el valor por omisión para todo
 * lo que no se informe.
 *
 * No es un andamio para las pruebas: es lo que hace que la demo se pueda
 * **ejecutar** en CI y no solo compilar, y lo que permite mostrar un camino
 * concreto en una sustentación sin tipear en vivo. Una demo interactiva que nadie
 * puede correr de forma reproducible es una demo que se rompe sin que nadie se
 * entere.
 */
const scriptedAnswers = process.argv.slice(2);

/**
 * Con argumentos la demo no pregunta **nada**, ni siquiera lo que no se informó.
 *
 * Los dos modos están separados a propósito. Un modo híbrido —usar los argumentos
 * y después seguir preguntando— es el que parece más flexible y el que falla peor:
 * al agotarse los argumentos se queda esperando una entrada que en una tubería o
 * en CI no va a llegar nunca.
 */
const nonInteractive = scriptedAnswers.length > 0;

/** Pregunta libre, con valor por omisión cuando el usuario solo presiona Enter. */
async function ask(question: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";

  if (nonInteractive) {
    const scripted = scriptedAnswers.shift() ?? "";
    const answer = scripted.trim() || fallback || "";
    console.log(`${question}${suffix}: ${answer}`);
    return answer;
  }

  /*
   * `rl.question()` **nunca resuelve** si la entrada se cierra —Ctrl+D, o una
   * tubería que se agota—: la promesa queda colgada, el bucle de eventos se queda
   * sin trabajo y Node termina con código 0 sin haber hecho nada. La demo moría en
   * silencio y parecía haber funcionado, que es la peor forma de fallar de un
   * artefacto de demostración.
   *
   * El detector vive por pregunta y se desconecta al salir, para que un cierre que
   * ocurra entre dos preguntas no deje una promesa rechazada sin dueño.
   */
  const input = terminal();
  const closed = Symbol("closed");
  let onClose = (): void => {};

  const closedFirst = new Promise<typeof closed>((resolve) => {
    onClose = () => resolve(closed);
    input.once("close", onClose);
  });

  try {
    const answer = await Promise.race([
      input.question(`${question}${suffix}: `),
      closedFirst,
    ]);

    if (answer === closed) {
      throw new Error("La entrada se cerró antes de terminar el recorrido.");
    }

    return answer.trim() || fallback || "";
  } finally {
    input.off("close", onClose);
  }
}

/** Pregunta de opción múltiple sobre una lista, devolviendo el elemento elegido. */
async function choose<T>(
  question: string,
  options: readonly T[],
  label: (option: T) => string,
): Promise<T> {
  console.log(`\n${question}`);
  options.forEach((option, index) => {
    console.log(`  ${index + 1}) ${label(option)}`);
  });

  for (;;) {
    const raw = await ask("  Elegí un número o escribí parte del nombre", "1");

    const byIndex = options[Number(raw) - 1];
    if (byIndex !== undefined) {
      return byIndex;
    }

    /*
     * Aceptar el nombre además del número no es azúcar: es lo que hace legible la
     * forma no interactiva. `npm run demo -- wompi pse` se entiende sin contar
     * posiciones en una lista, y `-- 1 2` no.
     */
    const needle = raw.toLowerCase();
    const byLabel = options.find((option) =>
      label(option).toLowerCase().includes(needle),
    );

    if (needle && byLabel !== undefined) {
      return byLabel;
    }

    console.log(`  "${raw}" no está en la lista.`);
  }
}

// ---------------------------------------------------------------------------
// Configuración de las cuatro pasarelas contra el simulador
// ---------------------------------------------------------------------------

const GATEWAYS = [
  Gateway.WOMPI,
  Gateway.MERCADOPAGO,
  Gateway.KUSHKI,
  Gateway.RAPYD,
] as const;

/**
 * Endpoints del simulador, uno por pasarela.
 *
 * Esta tabla no existe en producción: `baseUrl` es un override cuya razón de ser
 * es apuntar el SDK al simulador sin tocar código (RF-09). En un despliegue real
 * desaparece y lo único que cambia es el valor de `gateway`, porque cada adaptador
 * conoce la URL de su pasarela. Es una tabla de datos, no una cadena de
 * condicionales: una quinta pasarela es una fila más.
 */
const SIMULATOR_ENDPOINTS: Record<Gateway, string> = {
  [Gateway.WOMPI]: "http://localhost:3000/v1/sim/wompi",
  [Gateway.MERCADOPAGO]: "http://localhost:3000/v1/sim/mercadopago",
  [Gateway.KUSHKI]: "http://localhost:3000/v1/sim/kushki",
  [Gateway.RAPYD]: "http://localhost:3000/v1/sim/rapyd",
};

/**
 * Credenciales ficticias de las cuatro, declaradas juntas.
 *
 * Que Wompi necesite un tercer valor y las otras tres no es parte de lo que la
 * demo deja ver: **las credenciales sí cambian entre pasarelas, y el código del
 * pago no.** Lo que el SDK unifica es el cobro, no la cuenta que hay que abrir.
 */
const CREDENTIALS: SDKOptions["credentials"] = {
  [Gateway.WOMPI]: {
    publicKey: "pub_test_demo_no_real",
    privateKey: "prv_test_demo_no_real",
    integritySecret: "test_integrity_demo_no_real",
  },
  [Gateway.MERCADOPAGO]: {
    publicKey: "APP_USR_public_demo_no_real",
    privateKey: "APP_USR_access_token_demo_no_real",
  },
  [Gateway.KUSHKI]: {
    publicKey: "kushki_public_merchant_id_no_real",
    privateKey: "kushki_private_merchant_id_no_real",
  },
  [Gateway.RAPYD]: {
    publicKey: "rapyd_access_key_demo_no_real",
    privateKey: "rapyd_secret_key_demo_no_real",
  },
};

// ---------------------------------------------------------------------------
// Los datos extra, preguntados solo cuando el SDK dice que faltan
// ---------------------------------------------------------------------------

/**
 * Cómo conseguir cada dato que un adaptador puede exigir, indexado por el nombre
 * del campo **del dominio**.
 *
 * Acá está la parte que evita el `switch (gateway)`. Los tres adaptadores que
 * validan PSE localmente acumulan todo lo que falta en un único `INVALID_REQUEST`
 * y lo nombran con los campos del contrato: `payer.firstName`, `payer.address`,
 * `ipAddress`, `returnUrlConfig`. La demo lee esos nombres del error y pregunta
 * justo eso, así que **aprende del SDK qué exige cada pasarela en vez de saberlo**.
 *
 * La consecuencia es que esta tabla está indexada por campo del dominio y no por
 * pasarela. Una quinta pasarela que exija los mismos datos no agrega ninguna
 * entrada, y una que exija un dato nuevo lo agrega una sola vez para todas.
 *
 * Y de paso la demo muestra algo que de otro modo no se ve: el SDK valida **antes**
 * de tocar la red, y nombra todos los faltantes de una vez en lugar de revelarlos
 * de a uno a punta de HTTP 400.
 */
const EXTRA_FIELD_PROMPTS: Record<
  string,
  (draft: PaymentDraft) => Promise<void>
> = {
  "payer.firstName": async (draft) => {
    draft.payer.firstName = await ask("  Nombre del pagador", "Jaime");
  },
  "payer.lastName": async (draft) => {
    draft.payer.lastName = await ask(
      "  Apellidos del pagador",
      "Pavlich Mariscal",
    );
  },
  "payer.fullName": async (draft) => {
    draft.payer.fullName = await ask(
      "  Nombre completo del pagador",
      "Jaime Pavlich Mariscal",
    );
  },
  "payer.phone": async (draft) => {
    draft.payer.phone = await ask("  Celular del pagador", "3001234567");
  },
  "payer.phoneAreaCode": async (draft) => {
    draft.payer.phoneAreaCode = await ask("  Indicativo del país", "57");
  },
  "payer.documentType": async (draft) => {
    draft.payer.documentType = await ask("  Tipo de documento", "CC");
  },
  "payer.documentNumber": async (draft) => {
    draft.payer.documentNumber = await ask("  Número de documento", "1099888777");
  },
  "payer.address": async (draft) => {
    console.log("  Dirección del pagador:");
    draft.payer.address = {
      streetName: await ask("    Calle o carrera", "Carrera 7"),
      streetNumber: await ask("    Número", "40-62"),
      city: await ask("    Ciudad", "Bogota"),
      zipCode: await ask("    Código postal", "110231"),
      neighborhood: await ask("    Barrio", "Chapinero"),
    };
  },
  ipAddress: async (draft) => {
    draft.ipAddress = await ask("  IP del pagador", "200.100.50.25");
  },
  returnUrlConfig: async (draft) => {
    draft.returnUrl = await ask(
      "  URL de retorno del comercio",
      "https://comercio-de-prueba.example.com/retorno",
    );
  },
};

/**
 * Traduce el mensaje del SDK a la lista de campos que hay que preguntar.
 *
 * Busca cada campo del catálogo dentro del mensaje, en vez de partir el mensaje y
 * quedarse con los pedazos. Es al revés de lo que parece natural, y a propósito:
 * los adaptadores no formatean igual la lista —unos separan con comas, otros
 * agrupan con "y" (`payer.phone y payer.phoneAreaCode`)— así que un separador
 * fijo se rompería con el primero que cambie de estilo. Buscar por contención no
 * depende del formato.
 *
 * El otro efecto es que un campo que el SDK nombre y que no esté en el catálogo
 * simplemente no se pregunta, y el SDK vuelve a reclamarlo. Preferible pedir de
 * menos y que el ciclo se repita, que abortar la demo porque apareció un dato
 * nuevo que nadie agregó acá todavía.
 *
 * El costo de buscar por contención es que un nombre que sea prefijo de otro
 * arrastra al más largo. Hoy no pasa: `payer.phone` es prefijo de
 * `payer.phoneAreaCode`, pero Mercado Pago los nombra siempre juntos y Rapyd
 * nombra solo el primero, así que ningún adaptador pide el indicativo sin el
 * número. Si alguno lo hiciera, la demo preguntaría un dato de más —molesto, no
 * incorrecto— y ahí valdría la pena comparar por límites de palabra.
 */
function missingFieldsFrom(message: string): string[] {
  return Object.keys(EXTRA_FIELD_PROMPTS).filter((field) =>
    message.includes(field),
  );
}

// ---------------------------------------------------------------------------
// El pago que se va armando
// ---------------------------------------------------------------------------

/**
 * Los datos que el usuario fue dando, todavía mutables.
 *
 * Existe como objeto aparte porque `CreatePaymentRequest` se arma con objetos de
 * valor que validan en su constructor, y acá hace falta poder completar campos de
 * a poco, entre una pregunta y la siguiente.
 */
interface PaymentDraft {
  gateway: Gateway;
  methodType: PaymentMethodType;
  amount: string;
  currency: string;
  reference: string;
  payer: PayerAttributes;
  bank?: PseBank;
  ipAddress?: string;
  returnUrl?: string;
}

/**
 * Arma el método de pago del borrador.
 *
 * Está aparte porque hacen falta dos veces: para preguntarle si exige documento
 * del pagador, antes de armar la solicitud, y para armarla. Tenerlo en un solo
 * lugar evita que las dos construcciones se separen.
 *
 * El token de tarjeta es de mentira porque quien responde es el simulador. En
 * producción lo emite el frontend contra la pasarela, que es el único lugar donde
 * se puede tocar la tarjeta sin meter al servidor del comercio dentro del alcance
 * de PCI DSS. Por eso la demo no lo pregunta: un token inventado por el usuario no
 * enseñaría nada, y pedir el número de tarjeta enseñaría lo contrario de lo
 * correcto.
 *
 * Si el método es PSE sin banco, `PaymentMethod.pse()` lanza. No se verifica acá a
 * propósito: el objeto de valor existe justamente para hacer imposible ese estado,
 * y repetir la verificación afuera crearía una segunda fuente de verdad.
 */
function toPaymentMethod(draft: PaymentDraft): PaymentMethod {
  if (draft.methodType === "PSE") {
    return PaymentMethod.pse({ bankCode: draft.bank?.code ?? "" });
  }

  return PaymentMethod.card("tok_demo_no_real", { installments: 1 });
}

/** Arma la solicitud del SDK a partir del borrador. */
function toRequest(draft: PaymentDraft): CreatePaymentRequest {
  const request: CreatePaymentRequest = {
    amount: new Amount(draft.amount),
    currency: new Currency(draft.currency),
    orderReference: new OrderReference(draft.reference),
    payer: new Payer(draft.payer),
    paymentMethod: toPaymentMethod(draft),
  };

  if (draft.ipAddress) {
    request.ipAddress = draft.ipAddress;
  }

  if (draft.returnUrl) {
    request.returnUrlConfig = new ReturnUrlConfig(draft.returnUrl);
  }

  return request;
}

// ---------------------------------------------------------------------------
// El recorrido
// ---------------------------------------------------------------------------

async function collectDraft(): Promise<{
  draft: PaymentDraft;
  kitPagos: KitPagos;
}> {
  const gateway = await choose(
    "¿Por qué pasarela querés cobrar?",
    GATEWAYS,
    (option) => option,
  );

  const kitPagos = new KitPagos({
    gateway,
    credentials: CREDENTIALS,
    baseUrl: SIMULATOR_ENDPOINTS[gateway],
  });

  const methodType = await choose<PaymentMethodType>(
    "¿Con qué método de pago?",
    ["CARD", "PSE"],
    (option) => (option === "CARD" ? "Tarjeta" : "PSE (débito bancario)"),
  );

  console.log("");
  const amount = await ask("Monto a cobrar", "150000.00");
  const currency = await ask("Moneda (ISO 4217)", "COP");
  const email = await ask("Correo del pagador", "jaime.pavlich@example.com");

  const draft: PaymentDraft = {
    gateway,
    methodType,
    amount,
    currency,
    reference: `ORDER-DEMO-${Date.now()}`,
    payer: { email, fullName: "Jaime Pavlich Mariscal" },
  };

  if (methodType === "PSE") {
    /*
     * La lista de bancos sale de la pasarela, no del código. Es el mismo método
     * para las cuatro —`getPseBanks()`— y devuelve códigos que no se parecen entre
     * sí: `1` en Wompi, `1007` en Mercado Pago, `co_pse_bancolombia_bank` en
     * Rapyd. Es el único dato del contrato que no se puede reutilizar al cambiar
     * de pasarela, y verlo en la propia demo es más elocuente que leerlo.
     */
    console.log("\nPidiéndole a la pasarela su lista de bancos de PSE...");
    const banks = await kitPagos.getPseBanks();
    printExchanges("Consulta de bancos");

    draft.bank = await choose(
      `La pasarela devolvió ${banks.length} banco(s). ¿Con cuál pagás?`,
      banks.slice(0, 10),
      (bank) => `${bank.name}  (código ${bank.code})`,
    );
  }

  /*
   * El documento no se pregunta por pasarela: se pregunta cuando el propio objeto
   * de valor del método dice que hace falta. Es requisito de la red PSE, no de un
   * proveedor, y el SDK lo expone como una pregunta al método justamente para que
   * quien integra no tenga que saber cuál de las cuatro lo exige.
   */
  if (toPaymentMethod(draft).requiresPayerDocument()) {
    console.log(
      "\nEl método elegido exige documento del pagador " +
        "(paymentMethod.requiresPayerDocument() lo declara):",
    );

    for (const field of ["payer.documentType", "payer.documentNumber"]) {
      await EXTRA_FIELD_PROMPTS[field]!(draft);
    }
  }

  return { draft, kitPagos };
}

/** Lo que la demo imprime antes de cobrar: dominio a la izquierda, nada nativo. */
function printDomainSummary(draft: PaymentDraft): void {
  const request = toRequest(draft);

  console.log("\n=== Lo que el comercio describió, en términos del dominio ===\n");
  console.log(`  Pasarela:   ${draft.gateway}`);
  console.log(`  Método:     ${draft.methodType}`);
  console.log(
    `  Monto:      ${request.amount.getValue()} ${request.currency.getCode()}`,
  );
  console.log(`  Referencia: ${request.orderReference.getValue()}`);
  console.log(`  Pagador:    ${request.payer.email}`);

  if (draft.bank) {
    console.log(`  Banco:      ${draft.bank.name} (${draft.bank.code})`);
  }

  /*
   * El monto en unidades mínimas se imprime desde el objeto de valor, no desde la
   * petición capturada, para que se vea que la conversión es una operación del
   * dominio y no algo que el comercio escriba. Wompi la recibe así y Mercado Pago
   * no, y ninguna de las dos cosas aparece en el código de arriba.
   */
  console.log(
    `\n  El mismo monto en unidades mínimas: ` +
      `${request.amount.toMinorUnits(request.currency)}`,
  );
  console.log(
    "  Cuál de las dos escalas viaja lo decide el adaptador. Se ve abajo,\n" +
      "  en la petición real, y no en ninguna línea de este archivo.",
  );
}

/**
 * Cobra, preguntando lo que falte si el SDK lo reclama.
 *
 * El bucle no es una concesión a una interfaz incómoda: es la demostración de que
 * la validación es local. Cada vuelta corresponde a un `INVALID_REQUEST` que el
 * SDK produjo **sin tocar la red**, y se nota porque el bloque de llamadas HTTP
 * que se imprime después está vacío hasta que la solicitud queda completa.
 */
async function createPaymentAskingForMissingData(
  kitPagos: KitPagos,
  draft: PaymentDraft,
) {
  for (;;) {
    try {
      return await kitPagos.createPayment(toRequest(draft));
    } catch (error: unknown) {
      if (
        !(error instanceof KitPagosError) ||
        error.code !== KitPagosErrorCode.INVALID_REQUEST
      ) {
        throw error;
      }

      const missing = missingFieldsFrom(error.message);

      if (missing.length === 0) {
        throw error;
      }

      console.log(
        `\n${draft.gateway} exige datos que todavía no diste, y el SDK lo` +
          " detectó sin gastar una llamada de red:",
      );
      console.log(`  ${error.message}\n`);

      for (const field of missing) {
        await EXTRA_FIELD_PROMPTS[field]!(draft);
      }
    }
  }
}

/** Imprime la transacción normalizada, que es el otro extremo del recorrido. */
function printNormalizedTransaction(transaction: Transaction): void {
  console.log("\n=== La Transaction que produjo el ResponseNormalizer ===\n");
  console.log(`  Estado normalizado:  ${transaction.getStatus()}`);
  console.log(`  Estado nativo:       ${transaction.rawStatus}`);
  console.log(
    `  Monto:               ${transaction.amount.getValue()} ` +
      `${transaction.currency.getCode()}`,
  );
  console.log(`  Referencia:          ${transaction.orderReference.getValue()}`);
  console.log(`  ID en la pasarela:   ${transaction.gatewayTransactionId.value}`);
  console.log(`  ¿Aprobada?           ${transaction.isApproved()}`);
  console.log(`  ¿Estado definitivo?  ${transaction.isFinal()}`);
  console.log(
    "\n  Comparalo con la respuesta cruda de arriba: el estado nativo es el que\n" +
      "  cambia entre pasarelas, y el normalizado es el que el comercio programa.",
  );
}

async function main(): Promise<void> {
  installNetworkSpy();

  console.log("=== Kit Pagos Colombia — demo interactiva ===\n");
  console.log(
    "Recorre un pago completo e imprime, en cada paso, la petición que\n" +
      "realmente salió y la respuesta que realmente llegó. Nada de lo que vas a\n" +
      "ver está escrito a mano en el ejemplo.\n",
  );

  const { draft, kitPagos } = await collectDraft();

  printDomainSummary(draft);

  const confirmed = await ask("\n¿Cobramos? (s/n)", "s");
  if (!confirmed.toLowerCase().startsWith("s")) {
    console.log("\nCancelado. No se envió ninguna petición de cobro.");
    return;
  }

  console.log("\nCobrando...");
  const result = await createPaymentAskingForMissingData(kitPagos, draft);
  printExchanges("Creación del pago");

  /*
   * La ramificación sobre `PaymentResult` es obligatoria, no opcional: el
   * compilador no deja leer `result.transaction` hasta que se descarta la
   * redirección. Es el mejor lugar del repositorio para mostrar por qué existe la
   * unión discriminada del issue #64, porque acá la obligación se ve en pantalla.
   */
  if (result.outcome === "REDIRECT_REQUIRED") {
    console.log("\n=== El resultado es una redirección pendiente ===\n");
    console.log(`  URL a la que hay que mandar al pagador:`);
    console.log(`    ${result.redirect.redirectUrl}`);
    console.log(`  ID en la pasarela:  ${result.redirect.gatewayTransactionId.value}`);
    console.log(`  Estado nativo:      ${result.redirect.rawStatus}`);
    console.log(
      "\n  El compilador obligó a distinguir esta rama antes de poder leer una\n" +
        "  transacción. Un pago que redirige no tiene desenlace todavía, y el\n" +
        "  tipo de retorno lo hace imposible de ignorar.",
    );

    /*
     * Hace de pagador. En producción esto no es código del comercio: es la persona
     * entrando al portal de su banco. Contra el simulador alcanza con visitar la
     * URL, y hacerlo mantiene el orden verdadero de los eventos —crear, redirigir,
     * consultar— en lugar de saltarse el paso del medio.
     *
     * El fallo se tolera porque **no todas las URL son visitables desde acá**, y eso
     * no es un defecto de la demo: Kushki devuelve una del dominio
     * `sandbox-pse.kushkipagos.com`, que es lo que devuelve de verdad, así que el
     * destino queda fuera del simulador. Tratarlo como error haría que la demo se
     * cayera justo en el punto donde está mostrando algo correcto.
     */
    console.log("\nVisitando la URL, que es lo que haría el pagador...");
    try {
      await fetch(result.redirect.redirectUrl);
      console.log("  Visitada.");
    } catch {
      console.log(
        "  No se pudo visitar desde acá: la URL apunta a un dominio de la\n" +
          "  pasarela y no al simulador. En un pago real la abre el pagador en su\n" +
          "  navegador, así que esto no es un fallo del cobro.",
      );
    }
    drainExchanges();

    console.log("Consultando el estado después de la redirección...");
    const transaction = await kitPagos.getPaymentStatus(
      result.redirect.gatewayTransactionId.value,
    );
    printExchanges("Consulta de estado");
    printNormalizedTransaction(transaction);
    return;
  }

  console.log("\n=== El resultado es una transacción ===\n");
  printNormalizedTransaction(result.transaction);

  if (result.transaction.isFinal()) {
    console.log(
      "\nEl estado ya es definitivo, así que no hace falta consultar.",
    );
    return;
  }

  /*
   * Con tarjeta esto no es un caso raro: Wompi crea la transacción en `PENDING` y
   * la resuelve unos cientos de milisegundos después, medido contra su sandbox
   * real (punto 50 del `architecture-log.md`). Un comercio que tomara el estado de
   * la creación como final dejaría pagos aprobados sin registrar.
   */
  console.log(
    "\nEl estado no es definitivo todavía, así que hay que consultarlo.\n" +
      "Con tarjeta esto es lo normal y no la excepción.",
  );
  const transaction = await kitPagos.getPaymentStatus(
    result.transaction.gatewayTransactionId.value,
  );
  printExchanges("Consulta de estado");
  printNormalizedTransaction(transaction);
}

main()
  .catch((error: unknown) => {
    if (
      error instanceof KitPagosError &&
      error.code === KitPagosErrorCode.CONNECTION_FAILED
    ) {
      console.error("\nNo se pudo conectar con la API de Simulación.");
      console.error("Levantala en otra terminal y volvé a correr la demo:\n");
      console.error("  cd simulator-api && npm run dev\n");
      process.exitCode = 1;
      return;
    }

    if (error instanceof KitPagosError) {
      /*
       * Cualquier otro error del SDK llega con código de un catálogo cerrado, así
       * que se puede imprimir como dato y no como traza. Es el diseño de errores
       * del SDK visto desde afuera: el comercio compara códigos, no textos.
       */
      console.error(`\nEl SDK falló con el código ${error.code}:`);
      console.error(`  ${error.message}\n`);
      process.exitCode = 1;
      return;
    }

    console.error("\nLa demo falló de forma inesperada:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    openTerminal?.close();
  });
