/**
 * Recorrido de los escenarios de la API de Simulación usando solo el SDK (issue #122).
 *
 * El criterio del issue es que un desarrollador pueda provocar cada escenario sin
 * cabeceras de simulación: con los mismos datos que usaría contra el sandbox real
 * (la tarjeta `4111` de Wompi, el titular `OTHE` de Mercado Pago, el documento
 * `100000002` de Kushki) o, donde la pasarela no tiene un dato así, con los montos
 * reservados y las marcas de credencial que define el simulador. Este archivo no
 * escribe ninguna cabecera ni llama a ninguna ruta por su cuenta: todo pasa por
 * `KitPagos` y, para tokenizar, por `KitPagosBrowser` con el ambiente `simulator`.
 *
 * Cada caso imprime una línea con la pasarela, lo esperado, lo obtenido y OK o FAIL.
 * Si algún caso falla, el proceso termina con código 1, para que pueda correr en CI.
 *
 * Duración: las cuatro pasarelas corren en paralelo y sus casos en serie. Lo que
 * cuesta tiempo son los casos de espera (`timeoutMs` de 2 s) y los reintentos (pausas
 * de 1 s y 2 s del `RetryHandler`); el recorrido completo debería tomar unos 15 s.
 *
 * Requisito: la API de Simulación de esta rama, arriba en el puerto 3000:
 *   cd simulator-api && npm run dev
 */
import {
  Amount,
  Currency,
  Environment,
  Gateway,
  KitPagos,
  KitPagosErrorCode,
  OrderReference,
  Payer,
  PaymentMethod,
  ReturnUrlConfig,
  TaxBreakdown,
  type CreatePaymentRequest,
  type SDKOptions,
} from "kit-pagos-colombia";
import { RAPYD_SECRET_KEY, WOMPI_INTEGRITY_SECRET } from "./simulator-secrets";
import { KitPagosBrowser, Gateway as BrowserGateway } from "kit-pagos-colombia/browser";

/** El límite por petición de los casos de espera. Corto para que el recorrido sea rápido. */
const TIMEOUT_MS = 2000;

type GatewayCredentials = { publicKey: string; privateKey: string; integritySecret?: string };

/**
 * Credenciales ficticias que el simulador acepta. Las de los casos de credencial
 * inválida y de lista de bancos se derivan de estas agregando la marca que el
 * simulador reconoce (`invalid`, `sim_flapping`, `sim_server_error`). Los dos
 * secretos que firman son los de la cuenta del simulador (`simulator-secrets.ts`).
 */
const VALID_CREDENTIALS: Record<Gateway, GatewayCredentials> = {
  [Gateway.WOMPI]: {
    publicKey: "pub_test_escenarios",
    privateKey: "prv_test_escenarios",
    integritySecret: WOMPI_INTEGRITY_SECRET,
  },
  [Gateway.MERCADOPAGO]: {
    publicKey: "APP_USR_pub_escenarios",
    privateKey: "APP_USR_prv_escenarios",
  },
  [Gateway.KUSHKI]: {
    publicKey: "kushki_public_escenarios",
    privateKey: "kushki_private_escenarios",
  },
  [Gateway.RAPYD]: {
    publicKey: "rapyd_access_escenarios",
    privateKey: RAPYD_SECRET_KEY,
  },
};

/**
 * Dónde lee cada pasarela la credencial que decide el escenario.
 *
 * Wompi rechaza la llave pública en `GET /merchants/{llave}` y la usa en la lista de
 * bancos; Mercado Pago y Kushki tarjeta miran la privada; Rapyd, su `access_key`, que en
 * el SDK es `publicKey`. Para la lista de bancos, Kushki usa la pública y Mercado Pago la
 * privada.
 */
const CREDENTIAL_FIELD: Record<Gateway, { payment: "publicKey" | "privateKey"; banks: "publicKey" | "privateKey" }> = {
  [Gateway.WOMPI]: { payment: "publicKey", banks: "publicKey" },
  [Gateway.MERCADOPAGO]: { payment: "privateKey", banks: "privateKey" },
  [Gateway.KUSHKI]: { payment: "privateKey", banks: "publicKey" },
  [Gateway.RAPYD]: { payment: "publicKey", banks: "publicKey" },
};

interface SdkSettings {
  /** Marca que se agrega a la credencial que esa operación revisa. */
  marker?: { field: "publicKey" | "privateKey"; value: string };
  maxRetries?: number;
}

/** Un SDK apuntado al simulador por su ambiente, sin `baseUrl`. */
function sdkFor(gateway: Gateway, settings: SdkSettings = {}): KitPagos {
  const credentials = { ...VALID_CREDENTIALS[gateway] };
  if (settings.marker) {
    credentials[settings.marker.field] = `${credentials[settings.marker.field]}_${settings.marker.value}`;
  }
  const options: SDKOptions = {
    gateway,
    credentials: { [gateway]: credentials },
    environment: Environment.SIMULATOR,
    timeoutMs: TIMEOUT_MS,
    maxRetries: settings.maxRetries ?? 0,
  };
  return new KitPagos(options);
}

let referenceCounter = 0;

function nextReference(gateway: Gateway): OrderReference {
  referenceCounter++;
  return new OrderReference(`ESC-${gateway}-${Date.now()}-${referenceCounter}`);
}

/** El nombre del titular que no está en la tabla de Mercado Pago: deja decidir al monto. */
const NEUTRAL_HOLDER = "Prueba Kit";

/**
 * Tokeniza una tarjeta contra el simulador, como lo haría el navegador del pagador.
 *
 * Es el único camino por el que el simulador ve la tarjeta: el número `4111` de Wompi y
 * el titular de Mercado Pago se leen al tokenizar, y el cobro los reconoce por el token.
 */
async function tokenize(gateway: Gateway, card: { number: string; holder: string }): Promise<string> {
  const browserGateway = gateway === Gateway.WOMPI ? BrowserGateway.WOMPI : BrowserGateway.MERCADOPAGO;
  const result = await KitPagosBrowser.tokenizeCard({
    gateway: browserGateway,
    publicKey: VALID_CREDENTIALS[gateway].publicKey,
    environment: "simulator",
    card: {
      number: card.number,
      cvc: "123",
      expMonth: "11",
      expYear: "30",
      cardHolder: card.holder,
      docType: "CC",
      docNumber: "1099888777",
    },
  });
  return result.token;
}

/** Tarjetas de prueba registradas en `docs/testing-data/`: aprobada en Wompi, Visa en Mercado Pago. */
const WOMPI_APPROVED_CARD = "4242424242424242";
const WOMPI_DECLINED_CARD = "4111111111111111";
const MERCADOPAGO_CARD = "4013540682746260";

/**
 * Un cobro con tarjeta del monto pedido.
 *
 * Wompi y Mercado Pago cobran un token emitido por el simulador. Kushki tokeniza con
 * Kushki.js en el navegador, fuera del SDK, así que el simulador no ve la tarjeta y el
 * token es opaco. Rapyd cobra en su página alojada, sin token.
 */
async function cardRequest(
  gateway: Gateway,
  amountPesos: string,
  card: { number?: string; holder?: string } = {},
): Promise<CreatePaymentRequest> {
  const amount = new Amount(amountPesos);
  const currency = new Currency("COP");
  const base = {
    amount,
    currency,
    orderReference: nextReference(gateway),
    payer: new Payer({ email: "escenarios@example.com", fullName: "Prueba Kit Pagos" }),
  };

  switch (gateway) {
    case Gateway.WOMPI:
    case Gateway.MERCADOPAGO: {
      const number =
        card.number ?? (gateway === Gateway.WOMPI ? WOMPI_APPROVED_CARD : MERCADOPAGO_CARD);
      const token = await tokenize(gateway, { number, holder: card.holder ?? NEUTRAL_HOLDER });
      return { ...base, paymentMethod: PaymentMethod.card(token, { installments: 1 }) };
    }
    case Gateway.KUSHKI:
      return {
        ...base,
        // Kushki exige el desglose; con el IVA incluido, base e IVA suman el monto exacto.
        taxBreakdown: TaxBreakdown.fromTaxIncluded(amount, "0.19", currency),
        paymentMethod: PaymentMethod.card("kushki-token-escenarios", { installments: 1 }),
      };
    default:
      return { ...base, paymentMethod: PaymentMethod.card() };
  }
}

/**
 * Un PSE con los datos del pagador que piden Kushki y Rapyd, contra el banco pedido o, si no
 * se pide ninguno, el primero de la lista.
 */
async function pseRequest(
  sdk: KitPagos,
  gateway: Gateway,
  amountPesos: string,
  documentNumber: string,
  bankCode?: string,
): Promise<CreatePaymentRequest> {
  const banks = await sdk.getPseBanks();
  const bank = bankCode === undefined ? banks[0] : banks.find((candidate) => candidate.code === bankCode);
  if (!bank) {
    throw new Error(`La lista de bancos de PSE no trae el banco ${bankCode ?? "pedido"}.`);
  }
  return {
    amount: new Amount(amountPesos),
    currency: new Currency("COP"),
    orderReference: nextReference(gateway),
    payer: new Payer({
      email: "escenarios@example.com",
      fullName: "Prueba Kit Pagos",
      phone: "3001234567",
      documentType: "CC",
      documentNumber,
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: bank.code }),
    returnUrlConfig: new ReturnUrlConfig("https://comercio-de-prueba.example.com/retorno"),
  };
}

/** Un PSE de Mercado Pago, que exige además nombre, apellido, indicativo, dirección e IP. */
async function mercadoPagoPseRequest(sdk: KitPagos, amountPesos: string): Promise<CreatePaymentRequest> {
  const base = await pseRequest(sdk, Gateway.MERCADOPAGO, amountPesos, "1099888777");
  return {
    ...base,
    payer: new Payer({
      email: "escenarios@example.com",
      firstName: "Prueba",
      lastName: "Kit Pagos",
      phone: "3001234567",
      phoneAreaCode: "57",
      documentType: "CC",
      documentNumber: "1099888777",
      address: {
        streetName: "Carrera 7",
        streetNumber: "40-62",
        city: "Bogota",
        zipCode: "110231",
        neighborhood: "Chapinero",
      },
    }),
    ipAddress: "200.100.50.25",
  };
}

/** Lo que devolvió la creación: el estado de la transacción, o que hay que redirigir. */
async function createOutcome(sdk: KitPagos, request: CreatePaymentRequest): Promise<string> {
  const result = await sdk.createPayment(request);
  return result.outcome === "REDIRECT_REQUIRED" ? "REDIRECT_REQUIRED" : result.transaction.getStatus();
}

/** El identificador que el comercio guarda para consultar después. */
async function createAndGetId(sdk: KitPagos, request: CreatePaymentRequest): Promise<{ id: string; created: string }> {
  const result = await sdk.createPayment(request);
  if (result.outcome === "REDIRECT_REQUIRED") {
    return { id: result.redirect.gatewayTransactionId.value, created: "REDIRECT_REQUIRED" };
  }
  return { id: result.transaction.gatewayTransactionId.value, created: result.transaction.getStatus() };
}

/**
 * El estado en que termina el pago: el de la creación si ya es final, o el de una consulta.
 *
 * Wompi crea toda tarjeta `PENDING` y la resuelve al consultar, igual que su sandbox; un
 * PSE redirige y se resuelve al consultar. Con una sola consulta alcanza en el simulador.
 */
async function settledStatus(sdk: KitPagos, request: CreatePaymentRequest): Promise<string> {
  const result = await sdk.createPayment(request);
  if (result.outcome === "TRANSACTION" && result.transaction.isFinal()) {
    return result.transaction.getStatus();
  }
  const id =
    result.outcome === "REDIRECT_REQUIRED"
      ? result.redirect.gatewayTransactionId.value
      : result.transaction.gatewayTransactionId.value;
  return (await sdk.getPaymentStatus(id)).getStatus();
}

/** El estado de la creación y el de la consulta, para los casos que cambian entre los dos. */
async function statusTrail(sdk: KitPagos, request: CreatePaymentRequest): Promise<string> {
  const { id, created } = await createAndGetId(sdk, request);
  const queried = (await sdk.getPaymentStatus(id)).getStatus();
  return `${created} -> ${queried}`;
}

/** Crea bien y consulta: las fallas de la consulta son las que el SDK reintenta. */
async function queryAfterCreate(sdk: KitPagos, request: CreatePaymentRequest): Promise<string> {
  const { id } = await createAndGetId(sdk, request);
  return (await sdk.getPaymentStatus(id)).getStatus();
}

const BANK_LIST = "LISTA_DE_BANCOS";

async function bankList(sdk: KitPagos): Promise<string> {
  const banks = await sdk.getPseBanks();
  return banks.length > 0 ? BANK_LIST : "LISTA_VACIA";
}

interface Observed {
  label: string;
  detail?: string;
}

const ERROR_CODES: ReadonlySet<string> = new Set(Object.values(KitPagosErrorCode));

/**
 * El código de un error del SDK, reconocido por su forma.
 *
 * No alcanza con `instanceof KitPagosError`: `kit-pagos-colombia/browser` es un bundle
 * aparte con su propia copia de la clase, así que un error de la tokenización no es
 * instancia de la que exporta `kit-pagos-colombia`, aunque traiga el mismo `code`.
 */
function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && ERROR_CODES.has(code) ? code : undefined;
}

/** Lo obtenido como texto comparable: el estado, o el código del error del SDK. */
async function observe(run: () => Promise<string>): Promise<Observed> {
  try {
    return { label: await run() };
  } catch (error) {
    const code = errorCodeOf(error);
    if (code !== undefined) {
      const cause = errorCodeOf((error as { cause?: unknown }).cause);
      return { label: code, detail: cause ? `causa ${cause}` : undefined };
    }
    const err = error as { name?: string; message?: string };
    return { label: "ERROR_NO_TIPADO", detail: `${err.name ?? "Error"}: ${err.message ?? String(error)}` };
  }
}

interface ScenarioCase {
  name: string;
  /** La fila de la convención de #122 en la que se apoya. */
  rule: string;
  expected: string;
  run: () => Promise<string>;
}

/** Los casos técnicos de creación: iguales en las cuatro pasarelas, por monto reservado. */
function technicalCases(gateway: Gateway): ScenarioCase[] {
  const byAmount = (name: string, amount: string, expected: string, settings: SdkSettings = {}): ScenarioCase => ({
    name,
    rule: `monto ${amount}`,
    expected,
    run: async () => createOutcome(sdkFor(gateway, settings), await cardRequest(gateway, amount)),
  });

  return [
    byAmount("límite de peticiones", "10429", KitPagosErrorCode.RATE_LIMIT_EXCEEDED),
    byAmount("error del servidor", "10500", KitPagosErrorCode.GATEWAY_SERVER_ERROR),
    byAmount("página HTML de un proxy (502)", "10006", KitPagosErrorCode.GATEWAY_SERVER_ERROR),
    byAmount("200 con JSON inválido", "10004", KitPagosErrorCode.MALFORMED_RESPONSE),
    byAmount("socket cortado", "10001", KitPagosErrorCode.CONNECTION_FAILED),
    byAmount(`sin respuesta dentro de ${TIMEOUT_MS} ms`, "10003", KitPagosErrorCode.GATEWAY_TIMEOUT),
    {
      name: "credencial con marca `invalid`",
      rule: "marca en la credencial",
      expected: KitPagosErrorCode.INVALID_CREDENTIALS,
      run: async () =>
        createOutcome(
          sdkFor(gateway, { marker: { field: CREDENTIAL_FIELD[gateway].payment, value: "invalid" } }),
          await cardRequest(gateway, "10000"),
        ),
    },
  ];
}

/** Las fallas en la consulta posterior y en la lista de bancos, que sí se reintentan. */
function retriedCases(gateway: Gateway, recoveredStatus: string): ScenarioCase[] {
  const banks = (value: string, maxRetries: number) =>
    sdkFor(gateway, { marker: { field: CREDENTIAL_FIELD[gateway].banks, value }, maxRetries });

  return [
    {
      name: "consulta que falla dos veces (2 reintentos)",
      rule: "consulta 10602",
      expected: recoveredStatus,
      run: async () => queryAfterCreate(sdkFor(gateway, { maxRetries: 2 }), await cardRequest(gateway, "10602")),
    },
    {
      name: "consulta que responde 500 siempre (1 reintento)",
      rule: "consulta 10600",
      expected: KitPagosErrorCode.MAX_RETRIES_EXCEEDED,
      run: async () => queryAfterCreate(sdkFor(gateway, { maxRetries: 1 }), await cardRequest(gateway, "10600")),
    },
    {
      name: `consulta sin respuesta en ${TIMEOUT_MS} ms (sin reintentos)`,
      rule: "consulta 10604",
      expected: KitPagosErrorCode.GATEWAY_TIMEOUT,
      run: async () => queryAfterCreate(sdkFor(gateway), await cardRequest(gateway, "10604")),
    },
    {
      name: "bancos PSE que fallan dos veces (2 reintentos)",
      rule: "marca sim_flapping",
      expected: BANK_LIST,
      run: () => bankList(banks("sim_flapping", 2)),
    },
    {
      name: "bancos PSE con 500 siempre (1 reintento)",
      rule: "marca sim_server_error",
      expected: KitPagosErrorCode.MAX_RETRIES_EXCEEDED,
      run: () => bankList(banks("sim_server_error", 1)),
    },
  ];
}

/** Los desenlaces de negocio, que dependen de los datos de prueba de cada pasarela. */
function businessCases(gateway: Gateway): ScenarioCase[] {
  const sdk = () => sdkFor(gateway);

  switch (gateway) {
    case Gateway.WOMPI:
      return [
        {
          name: "tarjeta 4242, aprobada al consultar",
          rule: "sin dato ni monto: APPROVED",
          expected: "APPROVED",
          run: async () => settledStatus(sdk(), await cardRequest(gateway, "10000")),
        },
        {
          name: "tarjeta 4111, pendiente y declinada al consultar",
          rule: "dato de prueba: Wompi 4111",
          expected: "PENDING -> DECLINED",
          run: async () => statusTrail(sdk(), await cardRequest(gateway, "10000", { number: WOMPI_DECLINED_CARD })),
        },
        {
          name: "rechazo por monto",
          rule: "monto 10100",
          expected: "DECLINED",
          run: async () => settledStatus(sdk(), await cardRequest(gateway, "10100")),
        },
        {
          // La URL llega en la misma consulta que el rechazo, como en el sandbox: el SDK
          // devuelve la transacción y no una redirección a un pago ya resuelto.
          name: "PSE banco 2, declinado sin redirección",
          rule: "dato de prueba: Wompi banco 2",
          expected: "DECLINED",
          run: async () => {
            const kitPagos = sdk();
            return createOutcome(kitPagos, await pseRequest(kitPagos, gateway, "150000", "1099888777", "2"));
          },
        },
      ];
    case Gateway.MERCADOPAGO:
      return [
        {
          name: "titular APRO",
          rule: "dato de prueba: titular APRO",
          expected: "APPROVED",
          run: async () => settledStatus(sdk(), await cardRequest(gateway, "10000", { holder: "APRO" })),
        },
        {
          name: "titular OTHE",
          rule: "dato de prueba: titular OTHE",
          expected: "DECLINED",
          run: async () => settledStatus(sdk(), await cardRequest(gateway, "10000", { holder: "OTHE" })),
        },
        {
          name: "rechazo por monto",
          rule: "monto 10100",
          expected: "DECLINED",
          run: async () => settledStatus(sdk(), await cardRequest(gateway, "10100")),
        },
        {
          // La orden se crea con el pago fallido y la creación responde 402: el SDK lo
          // devuelve como un pago DECLINED, sin redirección.
          name: "PSE: rechazo por monto",
          rule: "monto 10100",
          expected: "DECLINED",
          run: async () => {
            const kitPagos = sdk();
            return createOutcome(kitPagos, await mercadoPagoPseRequest(kitPagos, "10100"));
          },
        },
      ];
    case Gateway.KUSHKI:
      return [
        {
          name: "tarjeta aprobada",
          rule: "sin dato ni monto: APPROVED",
          expected: "APPROVED",
          run: async () => settledStatus(sdk(), await cardRequest(gateway, "10000")),
        },
        {
          name: "PSE con documento 100000002",
          rule: "dato de prueba: Kushki PSE 100000002",
          expected: "DECLINED",
          run: async () => {
            const kitPagos = sdk();
            return settledStatus(kitPagos, await pseRequest(kitPagos, gateway, "150000", "100000002"));
          },
        },
        {
          name: "rechazo por monto",
          rule: "monto 10100",
          expected: "DECLINED",
          run: async () => settledStatus(sdk(), await cardRequest(gateway, "10100")),
        },
      ];
    default:
      return [
        {
          // Rapyd cobra la tarjeta en su página: el SDK solo puede llegar a la redirección.
          name: "tarjeta: redirige a la página de pago",
          rule: "sin dato ni monto: APPROVED",
          expected: "REDIRECT_REQUIRED",
          run: async () => createOutcome(sdk(), await cardRequest(gateway, "10000")),
        },
        {
          // Con tarjeta, el rechazo se aplica al visitar la página, fuera del SDK; PSE lo
          // devuelve en la creación.
          name: "PSE: rechazo por monto",
          rule: "monto 10100",
          expected: "DECLINED",
          run: async () => {
            const kitPagos = sdk();
            return settledStatus(kitPagos, await pseRequest(kitPagos, gateway, "10100", "1099888777"));
          },
        },
      ];
  }
}

/**
 * El estado con que responde la consulta que se recupera. Rapyd tarjeta es un checkout
 * que nadie pagó, y se normaliza `PENDING`; las otras tres cobran en la creación.
 */
const RECOVERED_STATUS: Record<Gateway, string> = {
  [Gateway.WOMPI]: "APPROVED",
  [Gateway.MERCADOPAGO]: "APPROVED",
  [Gateway.KUSHKI]: "APPROVED",
  [Gateway.RAPYD]: "PENDING",
};

const GATEWAYS: readonly Gateway[] = [Gateway.WOMPI, Gateway.MERCADOPAGO, Gateway.KUSHKI, Gateway.RAPYD];

interface CaseResult {
  gateway: Gateway;
  scenario: ScenarioCase;
  observed: Observed;
}

/** Los casos de una pasarela en serie, para que las pausas de reintento no se pisen. */
async function runGateway(gateway: Gateway): Promise<CaseResult[]> {
  const cases = [...businessCases(gateway), ...technicalCases(gateway), ...retriedCases(gateway, RECOVERED_STATUS[gateway])];
  const results: CaseResult[] = [];
  for (const scenario of cases) {
    results.push({ gateway, scenario, observed: await observe(scenario.run) });
  }
  return results;
}

/**
 * Comprueba que el simulador contesta antes de empezar.
 *
 * Sin esto, con el simulador apagado el caso del socket cortado (`CONNECTION_FAILED`) y
 * el de la lista de bancos que falla siempre (`MAX_RETRIES_EXCEEDED`) saldrían OK por
 * casualidad. Se pregunta por la lista de bancos de Wompi porque no crea nada.
 */
async function simulatorIsUp(): Promise<boolean> {
  const observed = await observe(() => bankList(sdkFor(Gateway.WOMPI)));
  return observed.label === BANK_LIST;
}

async function main(): Promise<void> {
  console.log("=== Kit Pagos Colombia — escenarios del simulador por el SDK (issue #122) ===\n");

  if (!(await simulatorIsUp())) {
    console.error("La API de Simulación no respondió en http://localhost:3000. Iníciala en otra terminal:");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  const started = Date.now();
  const results = (await Promise.all(GATEWAYS.map(runGateway))).flat();

  for (const { gateway, scenario, observed } of results) {
    const ok = observed.label === scenario.expected;
    const detail = observed.detail ? `  (${observed.detail})` : "";
    console.log(
      `${ok ? "OK  " : "FAIL"} ${gateway.padEnd(11)} ${scenario.name.padEnd(52)} ` +
        `esperado ${scenario.expected.padEnd(22)} obtenido ${observed.label}${detail}`,
    );
  }

  const failed = results.filter(({ scenario, observed }) => observed.label !== scenario.expected);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${results.length - failed.length} de ${results.length} casos OK en ${seconds} s.`);

  // `exit` y no `exitCode`: los casos de espera dejan sockets que no hace falta esperar.
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error("\nEl recorrido falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});
