/**
 * Sondeo temporal: buscar la ruta de consulta de un cobro con tarjeta en Kushki.
 *
 * No es una prueba. Es el instrumento de medición del pendiente que dejaron los puntos 48 y
 * 50: cobra una tarjeta de verdad para tener un `ticketNumber` recién emitido y después le
 * pregunta a una lista de rutas candidatas, imprimiendo qué contesta cada una.
 *
 * Incluye siempre dos rutas de control inventadas. Sin ellas el resultado no se puede leer:
 * la vez anterior las catorce candidatas respondieron `403`, y lo que permitió concluir que
 * eso significaba "no existe" y no "no autorizado" fue que una ruta inventada respondía
 * igual. Si esta vez las de control responden distinto que las candidatas, la conclusión
 * anterior se cae.
 *
 *     cd sdk && npx tsx test/sandbox/probe-kushki-status.ts
 */
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { SANDBOX_BASE_URL, sandboxCredentials, uniqueReference } from "./sandbox-env";
import { tokenizeKushkiCard } from "./tokenize";

const baseUrl = SANDBOX_BASE_URL[Gateway.KUSHKI];

/**
 * Traduce la respuesta a si la ruta existe, usando el discriminador que dejó la medición de
 * PSE del 18 de septiembre (ver `docs/testing-data/kushki.md`).
 *
 * Los dos `403` de AWS API Gateway no significan lo mismo, y ahí está toda la señal: el de
 * la política dice que la ruta **existe** y el autorizador rechazó; el de "Missing
 * Authentication Token" dice que no hay ruta que autorizar. `Forbidden` pelado es el mismo
 * caso que el segundo, y se confirma porque es lo que contesta una ruta inventada.
 */
function interpretar(status: number, body: string): string {
  if (status < 400) return "EXISTE (respondió)";
  if (body.includes("no identity-based policy")) return "EXISTE (rechazó el autorizador)";
  if (body.includes("Missing Authentication Token")) return "no existe";
  if (body.includes('"Forbidden"')) return "no existe";
  return "EXISTE (error de la aplicación)";
}

async function probe(
  path: string,
  header: string,
  valor: string,
  etiqueta: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", [header]: valor },
  });

  const body = await response.text();
  const veredicto = interpretar(response.status, body);

  console.log(
    `${String(response.status).padEnd(4)} ${etiqueta.padEnd(8)} ${veredicto.padEnd(32)} ${path}`,
  );
}

async function main(): Promise<void> {
  const credentials = sandboxCredentials(Gateway.KUSHKI);
  if (!credentials) {
    console.error("Faltan KUSHKI_PUBLIC_MERCHANT_ID y KUSHKI_PRIVATE_MERCHANT_ID en .env");
    process.exit(1);
  }

  const amount = 20000;
  const reference = uniqueReference("PROBE-KUSHKI");

  console.log("Tokenizando y cobrando para tener un ticketNumber fresco...\n");
  const { token } = await tokenizeKushkiCard(credentials, amount);

  const chargeResponse = await fetch(`${baseUrl}/card/v1/charges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Private-Merchant-Id": credentials.privateKey,
    },
    body: JSON.stringify({
      token,
      amount: {
        subtotalIva: 0,
        subtotalIva0: amount,
        ice: 0,
        iva: 0,
        currency: "COP",
      },
      fullResponse: true,
      contactDetails: {
        email: "sondeo@example.com",
        firstName: "Sondeo",
        lastName: "Kushki",
      },
      orderDetails: { billingDetails: { name: "Sondeo Kushki" } },
      metadata: { reference },
    }),
  });

  const charge = (await chargeResponse.json()) as Record<string, unknown>;
  console.log(`Cobro: HTTP ${chargeResponse.status}`);
  console.log(`${JSON.stringify(charge).slice(0, 400)}\n`);

  const details = (charge.details ?? charge) as Record<string, unknown>;
  const ticket = String(charge.ticketNumber ?? details.ticketNumber ?? "");
  const transactionId = String(details.transactionId ?? charge.transactionId ?? "");

  console.log(`ticketNumber: ${ticket || "(no vino)"}`);
  console.log(`transactionId: ${transactionId || "(no vino)"}\n`);

  const candidatas: Array<[string, string]> = [];
  for (const id of [ticket, transactionId].filter(Boolean)) {
    const nombre = id === ticket ? "ticket" : "txId";
    candidatas.push(
      [`/card/v1/charges/${id}`, nombre],
      [`/charges/${id}`, nombre],
      [`/card/v1/transaction/${id}`, nombre],
      [`/card/v1/transactions/${id}`, nombre],
      [`/analytics/v1/transaction/${id}`, nombre],
      [`/transaction/v1/status/${id}`, nombre],
      [`/card/v1/charges/${id}/status`, nombre],
      [`/v1/charges/${id}`, nombre],
      [`/card/v2/charges/${id}`, nombre],
      [`/transfer/v1/status/${id}`, nombre],
    );
  }

  // Controles: rutas que con seguridad no existen. Sin ellas el resultado no se puede leer.
  candidatas.push(
    ["/rutaDeControlQueNoExiste/abc123", "control"],
    [`/card/v1/rutaDeControlQueNoExiste/${ticket || "abc"}`, "control"],
    // Control positivo: una ruta que sabemos que existe, para comprobar que el
    // discriminador distingue de verdad y no está clasificando todo como inexistente.
    ["/transfer/v1/bankList", "control+"],
  );

  // Se prueban las dos llaves porque no está documentado con cuál se consulta, y una ruta
  // que exista pero rechace la llave se delata igual: el autorizador contesta distinto que
  // la ausencia de ruta.
  for (const [header, valor, etiquetaLlave] of [
    ["Private-Merchant-Id", credentials.privateKey, "privada"],
    ["Public-Merchant-Id", credentials.publicKey, "publica"],
  ] as const) {
    console.log(`\n=== Con la llave ${etiquetaLlave} (${header}) ===\n`);
    for (const [path, etiqueta] of candidatas) {
      await probe(path, header, valor, `${etiqueta}`);
    }
  }
}

void main();
