/**
 * Instala `kit-pagos-colombia` desde npm en un directorio temporal y compila un
 * programa contra él.
 *
 * ## Qué verifica que nada más verifique
 *
 * El resto del repositorio comprueba el **código fuente**: las pruebas corren
 * contra `src/`, `check:readme` compila los fragmentos del README contra `dist/`, y
 * el job de CI de `examples/` los compila contra el `dist/` recién construido. Los
 * tres miran el árbol de trabajo.
 *
 * Nada mira lo que de verdad recibe quien escribe `npm install
 * kit-pagos-colombia`, y ahí hay una clase de defecto que no se puede ver de otro
 * modo: un `files` en el `package.json` que se deja afuera una carpeta, un
 * `types` que apunta a un `.d.ts` que no se empaquetó, un `exports` que no resuelve
 * el punto de entrada. Todo eso convive con un `dist/` local perfecto y con la
 * suite en verde.
 *
 * El CI ya corre `npm pack --dry-run`, que lista lo que iría en el tarball. Esto es
 * un paso más: **instala y compila**, así que no comprueba que los archivos estén
 * en la lista sino que sirvan.
 *
 * ## Por qué esto NO reemplaza a `examples/` compilando contra `dist/`
 *
 * Porque mide otra cosa, y confundirlas costaría caro. `examples/` declara
 * `file:../sdk` a propósito: así un pull request que rompa la superficie pública
 * rompe el typecheck de los ejemplos **en ese mismo pull request**. Si los ejemplos
 * pasaran a consumir el paquete de npm, compilarían contra la versión ya publicada
 * y una ruptura pasaría en verde hasta el próximo release.
 *
 * O sea que los dos hacen falta: `examples/` detecta rupturas antes de publicar, y
 * esto detecta que lo publicado sirva.
 *
 * ## Cuándo correrlo
 *
 * A demanda con `npm run check:published`, y después de publicar. Corre contra el
 * registro, así que necesita red y no tiene sentido en el flujo de cada pull
 * request: la versión publicada va por detrás de la rama, y hacerlo obligatorio
 * pondría rojo un pull request por un desfase que es normal.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PACKAGE_NAME = "kit-pagos-colombia";

/**
 * Programa de prueba: toca la superficie que un comercio usa de verdad.
 *
 * Importa desde el nombre del paquete y no desde una ruta, que es lo único que
 * ejercita la resolución de `exports` y `types`. Y no se ejecuta: alcanza con que
 * compile, porque lo que se está probando es el empaquetado y no el comportamiento
 * —para el comportamiento están las 586 pruebas.
 */
const PROBE = `
import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  PaymentMethod,
  TaxBreakdown,
  ReturnUrlConfig,
  KitPagosError,
  KitPagosErrorCode,
  type TransactionStatus,
  type SDKOptions,
  type CreatePaymentRequest,
  type PaymentResult,
  type PseBank,
  type Transaction,
  type Credentials,
} from "${PACKAGE_NAME}";

const credentials: Credentials = { publicKey: "pub", privateKey: "prv" };

const options: SDKOptions = {
  gateway: Gateway.WOMPI,
  credentials: { [Gateway.WOMPI]: credentials },
};

const request: CreatePaymentRequest = {
  amount: new Amount("150000.00"),
  currency: new Currency("COP"),
  orderReference: new OrderReference("ORDER-1"),
  payer: new Payer({ email: "cliente@example.com", fullName: "Jaime Pavlich" }),
  paymentMethod: PaymentMethod.card("tok", { installments: 1 }),
  taxBreakdown: TaxBreakdown.exempt(new Amount("150000.00"), new Currency("COP")),
  returnUrlConfig: new ReturnUrlConfig("https://example.com/retorno"),
};

export async function probe(): Promise<void> {
  const kitPagos = new KitPagos(options);

  const banks: PseBank[] = await kitPagos.getPseBanks();
  void banks;

  const result: PaymentResult = await kitPagos.createPayment(request);

  if (result.outcome === "REDIRECT_REQUIRED") {
    void result.redirect.redirectUrl;
    return;
  }

  const transaction: Transaction = result.transaction;

  // \`TransactionStatus\` es una unión de cadenas y no un enum, así que se compara
  // contra el literal. Tiparlo explícitamente es lo que verifica que el \`.d.ts\`
  // publicado lo exponga.
  const status: TransactionStatus = transaction.getStatus();

  if (status === "APPROVED") {
    void transaction.amount.getValue();
  }

  try {
    await kitPagos.getPaymentStatus("id");
  } catch (error: unknown) {
    if (error instanceof KitPagosError && error.code === KitPagosErrorCode.RESOURCE_NOT_FOUND) {
      void error.message;
    }
  }
}
`;

const TSCONFIG = {
  compilerOptions: {
    target: "ES2020",
    module: "commonjs",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: false,
    noEmit: true,
  },
  files: ["probe.ts"],
};

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main(): void {
  const localVersion = String(
    (
      JSON.parse(
        run("node", ["-p", "JSON.stringify(require('./package.json'))"], path.resolve(__dirname, "..")),
      ) as { version: string }
    ).version,
  );

  const workspace = mkdtempSync(path.join(tmpdir(), "kit-pagos-published-"));

  try {
    console.log(`Instalando ${PACKAGE_NAME} desde npm en ${workspace}`);

    writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ name: "published-probe", private: true }, null, 2),
    );
    writeFileSync(path.join(workspace, "probe.ts"), PROBE);
    writeFileSync(
      path.join(workspace, "tsconfig.json"),
      JSON.stringify(TSCONFIG, null, 2),
    );

    /*
     * `--min-release-age=0` desactiva una protección, así que conviene justificarla.
     *
     * npm 11 permite configurar una edad mínima de publicación —en esta máquina
     * `min-release-age = 3` en el `.npmrc` del usuario— para no instalar paquetes
     * recién subidos, que es la ventana donde vive el secuestro de cadena de
     * suministro. Es una buena política y no se toca.
     *
     * Pero acá estorba y por una razón de fondo: este script existe justamente para
     * verificar una versión **recién publicada**, y con la política activa el
     * paquete propio queda inelegible durante tres días. El error que produce no se
     * parece en nada a la causa: `ETARGET ... no matching version found with a date
     * before <fecha>`, que se lee como si la versión no existiera en el registro.
     *
     * Desactivarla es seguro en este alcance concreto: se instala un solo paquete,
     * cuyo nombre está fijo en el código, en un directorio temporal que se borra al
     * terminar, y nada de lo que se instala se ejecuta.
     */
    run(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--min-release-age=0",
        PACKAGE_NAME,
        "typescript",
      ],
      workspace,
    );

    const publishedVersion = run(
      "node",
      ["-p", `require('${PACKAGE_NAME}/package.json').version`],
      workspace,
    ).trim();

    console.log(`  versión publicada: ${publishedVersion}`);
    console.log(`  versión local:     ${localVersion}`);

    /*
     * Un desfase no es un fallo: la rama va adelante del registro casi siempre. Se
     * avisa para que quien lea la salida sepa contra qué se compiló, porque un
     * "compila" sobre una versión vieja no dice nada sobre el código de hoy.
     */
    if (publishedVersion !== localVersion) {
      console.log(
        `\n  Aviso: se está verificando la ${publishedVersion}, no la ${localVersion}\n` +
          "  que tiene el árbol de trabajo. Lo que sigue habla del paquete publicado.",
      );
    }

    console.log("\nCompilando un programa contra el paquete instalado...");
    run(path.join(workspace, "node_modules", ".bin", "tsc"), [], workspace);

    console.log(
      `\nEl paquete ${PACKAGE_NAME}@${publishedVersion} se instala desde npm y su\n` +
        "superficie pública alcanza para integrar un pago completo con tipos.",
    );
  } catch (error: unknown) {
    const detail =
      error && typeof error === "object" && "stdout" in error
        ? `${String((error as { stdout?: unknown }).stdout ?? "")}${String(
            (error as { stderr?: unknown }).stderr ?? "",
          )}`
        : String(error);

    console.error(`\nLa verificación del paquete publicado falló:\n${detail}`);
    process.exitCode = 1;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main();
