/**
 * Sondeo temporal: qué contesta `/card-async/v1/status/{id}` de Kushki, y con qué
 * identificador.
 *
 * El sondeo anterior (`probe-kushki-status.ts`) concluyó que Kushki no publica consulta de
 * tarjeta, y estaba mal: nunca probó el espacio `card-async`. Cuando se probó, esa ruta
 * respondió como la de PSE que sí existe —`400` de la aplicación con la llave privada, `401`
 * del autorizador con la pública— así que la ruta está publicada. Lo que falta medir es si
 * sirve para un cobro creado por `/card/v1/charges`, que es el flujo síncrono de Colombia.
 *
 *     cd sdk && npx tsx test/sandbox/probe-kushki-card-async.ts
 */
import { Gateway } from "../../src/domain/value-objects/Gateway";
import { SANDBOX_BASE_URL, sandboxCredentials, uniqueReference } from "./sandbox-env";
import { tokenizeKushkiCard } from "./tokenize";

const baseUrl = SANDBOX_BASE_URL[Gateway.KUSHKI];

async function mostrar(path: string, header: string, valor: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", [header]: valor },
  });
  const body = await response.text();
  console.log(`\n--- GET ${path}`);
  console.log(`    ${header}`);
  console.log(`    HTTP ${response.status}`);
  console.log(`    ${body.slice(0, 500)}`);
}

async function main(): Promise<void> {
  const credentials = sandboxCredentials(Gateway.KUSHKI);
  if (!credentials) {
    console.error("Faltan las credenciales de Kushki en .env");
    process.exit(1);
  }

  const amount = 20000;
  const { token } = await tokenizeKushkiCard(credentials, amount);

  const chargeResponse = await fetch(`${baseUrl}/card/v1/charges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Private-Merchant-Id": credentials.privateKey,
    },
    body: JSON.stringify({
      token,
      amount: { subtotalIva: 0, subtotalIva0: amount, ice: 0, iva: 0, currency: "COP" },
      fullResponse: true,
      contactDetails: { email: "sondeo@example.com", firstName: "Sondeo", lastName: "Kushki" },
      orderDetails: { billingDetails: { name: "Sondeo Kushki" } },
      metadata: { reference: uniqueReference("PROBE-ASYNC") },
    }),
  });

  const charge = (await chargeResponse.json()) as Record<string, unknown>;
  const details = (charge.details ?? charge) as Record<string, unknown>;
  const ticket = String(charge.ticketNumber ?? details.ticketNumber ?? "");
  const transactionId = String(details.transactionId ?? charge.transactionId ?? "");
  const transactionReference = String(
    details.transactionReference ?? charge.transactionReference ?? "",
  );

  console.log(`Cobro HTTP ${chargeResponse.status}`);
  console.log(`ticketNumber:         ${ticket}`);
  console.log(`transactionId:        ${transactionId}`);
  console.log(`transactionReference: ${transactionReference}`);

  for (const id of [ticket, transactionId, transactionReference].filter(Boolean)) {
    await mostrar(`/card-async/v1/status/${id}`, "Private-Merchant-Id", credentials.privateKey);
  }

  // Sin identificador, para ver si el 400 se queja del parámetro o del recurso.
  await mostrar("/card-async/v1/status", "Private-Merchant-Id", credentials.privateKey);

  // La de PSE, como referencia de cómo se ve un 400 de esta familia de rutas.
  await mostrar(`/transfer/v1/status/${ticket}`, "Private-Merchant-Id", credentials.privateKey);
}

void main();
