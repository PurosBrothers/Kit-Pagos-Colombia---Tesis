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
 * ## Lo que el ejemplo no esconde
 *
 * Que los códigos **no son intercambiables**. El `"1"` de Wompi no significa nada en
 * Rapyd, cuyo código es `"co_pse_bancolombia_bank"`. El SDK no los traduce a un
 * catálogo propio, y la razón es que no hace falta: el código solo se usa para volver
 * a entrar al SDK, en `PaymentMethod.pse({ bankCode })`. El comercio nunca lo
 * interpreta, lo pasa. Lo que sí tiene que recordar es volver a pedir la lista si
 * cambia de pasarela, y por eso el ejemplo imprime los códigos de las cuatro juntos:
 * verlos al lado es lo que hace evidente que no se parecen.
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
  KitPagosError,
  KitPagosErrorCode,
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
    baseUrl: "http://localhost:3000/v1/sim/wompi",
    nota: "endpoint dedicado; en sandbox los bancos son de prueba",
  },
  {
    gateway: Gateway.MERCADOPAGO,
    baseUrl: "http://localhost:3000/v1/sim/mercadopago",
    nota: "anidados en el catálogo de métodos de pago",
  },
  {
    gateway: Gateway.RAPYD,
    baseUrl: "http://localhost:3000/v1/sim/rapyd",
    nota: "no hay lista: son métodos de pago separados, uno por banco",
  },
  {
    gateway: Gateway.KUSHKI,
    baseUrl: "http://localhost:3000/v1/sim/kushki",
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
      console.log(`    ${bank.code.padEnd(30)} ${bank.name}`);
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
   * Y la advertencia que importa: los códigos son de la pasarela que los dio. Un
   * comercio que cambia de pasarela sin volver a pedir la lista le manda a la nueva
   * un código que no entiende.
   */
  console.log("\nY por qué hay que volver a pedirla al cambiar de pasarela:\n");
  const wompi = porPasarela.get(Gateway.WOMPI)?.[0];
  const rapyd = porPasarela.get(Gateway.RAPYD)?.[0];
  console.log(`  El primer banco de Wompi es "${wompi?.code}" (${wompi?.name})`);
  console.log(`  El primero de Rapyd es     "${rapyd?.code}" (${rapyd?.name})`);
  console.log(
    "  Son la misma clase de dato y ninguno sirve en la otra pasarela. El SDK lo\n" +
      "  detecta y lo dice, en vez de dejar que la pasarela responda un error propio:",
  );

  const kitPagosRapyd = new KitPagos(
    buildOptions(Gateway.RAPYD, "http://localhost:3000/v1/sim/rapyd"),
  );

  try {
    await kitPagosRapyd.createPayment({
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
      // El código de Wompi, mandado a Rapyd.
      paymentMethod: PaymentMethod.pse({ bankCode: wompi?.code ?? "1" }),
    });
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
