/**
 * La lista de bancos de PSE, pedida a las cuatro pasarelas con la misma llamada.
 *
 * ## Qué demuestra este ejemplo
 *
 * En PSE el pagador **siempre** elige su banco antes de que exista el pago. Hasta
 * que este ejemplo existió, el comercio no tenía forma de obtener esa lista desde el
 * SDK: los dos ejemplos de PSE que había traían el código escrito a mano (`"1"` en
 * Wompi, `"1051"` en Mercado Pago), y para armar el selector de verdad había que
 * hablarle directo a la pasarela, perdiendo justo lo que el SDK promete.
 *
 * Lo que se ve acá es que el mismo `getPseBanks()` funciona en las cuatro **aunque
 * ninguna publique la lista igual**:
 *
 * | Pasarela     | Dónde está la lista                                        |
 * | ------------ | ---------------------------------------------------------- |
 * | Wompi        | `GET /v1/pse/financial_institutions`, endpoint dedicado     |
 * | Mercado Pago | anidada en `financial_institutions` de su catálogo de métodos |
 * | Rapyd        | no tiene lista: son 47 métodos `co_pse_*` dentro del catálogo del país |
 * | Kushki       | `GET /transfer/v1/bankList`, y en Colombia es obligatoria    |
 *
 * ## Dos clases de código
 *
 * El `code` de cada banco es el de su pasarela y no se parece entre ellas: Bancolombia
 * es `"1007"` en Mercado Pago y `"co_pse_bancolombia_bank"` en Rapyd. El `achCode` es
 * el código de compensación de ACH Colombia, que es el mismo en las cuatro, y
 * `PseBankCode.BANCOLOMBIA` sirve en cualquiera porque el SDK lo traduce para Rapyd
 * (punto 68 del `architecture-log.md`). Lo que no se traduce son los bancos ficticios
 * de los sandboxes, como el `"1"` de Wompi, y el ejemplo termina mostrando ese rechazo.
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
  PseBankCode,
  KitPagosError,
  KitPagosErrorCode,
  type CreatePaymentRequest,
  type SDKOptions,
  type PseBank,
} from "kit-pagos-colombia";

/**
 * Las cuatro pasarelas, cada una apuntada a la raíz de su API en el simulador.
 *
 * Las credenciales son de relleno: el simulador no las valida. Van igual porque
 * viajan por el mismo camino que unas reales, y en Kushki además importa cuál se usa
 * en cada paso —la pública para la lista de bancos, la privada para cobrar—, así que
 * omitirlas escondería una diferencia que sí existe.
 */
const GATEWAYS: readonly { gateway: Gateway; baseUrl: string; nota: string }[] = [
  {
    gateway: Gateway.WOMPI,
    baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/wompi",
    nota: "endpoint dedicado; en sandbox los bancos son de prueba",
  },
  {
    gateway: Gateway.MERCADOPAGO,
    baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/mercadopago",
    nota: "anidados en el catálogo de métodos de pago",
  },
  {
    gateway: Gateway.RAPYD,
    baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/rapyd",
    nota: "no hay lista: son métodos de pago separados, uno por banco",
  },
  {
    gateway: Gateway.KUSHKI,
    baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/kushki",
    nota: "obligatorio en Colombia para Transfer In",
  },
];

function buildOptions(gateway: Gateway, baseUrl: string): SDKOptions {
  return {
    gateway,
    credentials: {
      [gateway]: {
        publicKey: "pub_test_ejemplo_no_real",
        privateKey: "prv_test_ejemplo_no_real",
      },
    },
    baseUrl,
  };
}

/** Un PSE con los datos del pagador que Rapyd exige. */
function pseRequest(paymentMethod: PaymentMethod): CreatePaymentRequest {
  return {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-PSE-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      fullName: "Jaime Pavlich Mariscal",
      phone: "3001234567",
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod,
  };
}

async function main(): Promise<void> {
  console.log("=== Kit Pagos Colombia — bancos de PSE en las cuatro pasarelas ===\n");

  const porPasarela = new Map<Gateway, PseBank[]>();

  for (const { gateway, baseUrl, nota } of GATEWAYS) {
    const kitPagos = new KitPagos(buildOptions(gateway, baseUrl));

    // Exactamente la misma llamada para las cuatro. Lo único que cambió entre una
    // iteración y la siguiente es la configuración.
    const banks = await kitPagos.getPseBanks();
    porPasarela.set(gateway, banks);

    console.log(`${gateway}  (${banks.length} banco(s) — ${nota})`);
    for (const bank of banks) {
      const achCode = bank.achCode ? `achCode ${bank.achCode}` : "sin achCode";
      console.log(`    ${bank.code.padEnd(30)} ${achCode.padEnd(13)} ${bank.name}`);
    }
    console.log();
  }

  /**
   * El cierre del círculo: el código que salió de la lista entra en
   * `PaymentMethod.pse()` sin transformarlo. Si hiciera falta convertirlo, la lista
   * no habría resuelto el problema que vino a resolver.
   */
  console.log("Los códigos entran directo en PaymentMethod.pse(), sin transformar:\n");
  for (const [gateway, banks] of porPasarela) {
    const primero = banks[0];
    if (!primero) {
      continue;
    }
    const method = PaymentMethod.pse({ bankCode: primero.code });
    console.log(
      `  ${gateway.padEnd(13)} PaymentMethod.pse({ bankCode: "${primero.code}" })` +
        `  ->  ${method.type}, ¿exige documento? ${method.requiresPayerDocument()}`,
    );
  }

  /**
   * El mismo banco sin pedir la lista: `PseBankCode.BANCOLOMBIA` en Rapyd, que es la
   * única pasarela donde el SDK tiene que traducirlo.
   */
  console.log("\nEl mismo banco sin conocer el código de Rapyd:\n");
  const kitPagosRapyd = new KitPagos(
    buildOptions(Gateway.RAPYD, "https://kit-pagos-colombia.onrender.com/v1/sim/rapyd"),
  );
  const bancolombia = await kitPagosRapyd.createPayment(
    pseRequest(PaymentMethod.pse({ bankCode: PseBankCode.BANCOLOMBIA })),
  );
  console.log(
    `  PaymentMethod.pse({ bankCode: PseBankCode.BANCOLOMBIA })  ->  "${PseBankCode.BANCOLOMBIA}"` +
      `  ->  ${bancolombia.outcome}`,
  );

  /**
   * Y el caso que no se traduce: un banco ficticio de un sandbox, que solo existe en
   * la pasarela que lo dio.
   */
  console.log("\nY lo que sí hay que volver a pedir al cambiar de pasarela:\n");
  const wompi = porPasarela.get(Gateway.WOMPI)?.[0];
  const rapyd = porPasarela.get(Gateway.RAPYD)?.[0];
  console.log(`  El primer banco de Wompi es "${wompi?.code}" (${wompi?.name})`);
  console.log(`  El primero de Rapyd es     "${rapyd?.code}" (${rapyd?.name})`);
  console.log(
    "  El de Wompi es un banco de prueba sin achCode, así que no sirve en Rapyd. El\n" +
      "  SDK lo detecta y lo dice, en vez de dejar que la pasarela responda un error propio:",
  );

  try {
    // El código de Wompi, mandado a Rapyd.
    await kitPagosRapyd.createPayment(
      pseRequest(PaymentMethod.pse({ bankCode: wompi?.code ?? "1" })),
    );
    console.error("\n  Se esperaba un rechazo y el pago pasó.");
    process.exit(1);
  } catch (error) {
    if (error instanceof KitPagosError) {
      console.log(`\n    ${error.code}: ${error.message}\n`);
    } else {
      throw error;
    }
  }

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

  console.error("\nEl ejemplo falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});
