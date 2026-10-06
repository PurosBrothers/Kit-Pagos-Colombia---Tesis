import * as fs from "fs";
import * as path from "path";
import { buildApp } from "../../src/app";
import { CredentialResolver, loadServerEnv } from "../../src/auth/CredentialResolver";
import { KitPagosProvider } from "../../src/services/KitPagosProvider";

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

async function tokenizeWompi(publicKey: string): Promise<string> {
  const { status, json } = await postJson(
    "https://sandbox.wompi.co/v1/tokens/cards",
    { Authorization: `Bearer ${publicKey}` },
    {
      number: "4242424242424242",
      cvc: "123",
      exp_month: "11",
      exp_year: "30",
      card_holder: "Prueba Sandbox",
    },
  );
  const data = json.data as { id?: string } | undefined;
  if (!data?.id) {
    throw new Error(`Error tokenizando Wompi (HTTP ${status}): ${JSON.stringify(json)}`);
  }
  return data.id;
}

async function tokenizeMercadoPago(publicKey: string): Promise<string> {
  const { status, json } = await postJson(
    `https://api.mercadopago.com/v1/card_tokens?public_key=${publicKey}`,
    {},
    {
      card_number: "4013540682746260",
      expiration_month: 11,
      expiration_year: 2030,
      security_code: "123",
      cardholder: {
        name: "APRO",
        identification: { type: "CC", number: "19119119100" },
      },
    },
  );
  if (!json.id) {
    throw new Error(`Error tokenizando Mercado Pago (HTTP ${status}): ${JSON.stringify(json)}`);
  }
  return json.id as string;
}

async function tokenizeKushki(publicMerchantId: string, amount: number): Promise<string> {
  const { status, json } = await postJson(
    "https://api-uat.kushkipagos.com/card/v1/tokens",
    { "Public-Merchant-Id": publicMerchantId },
    {
      card: {
        name: "Prueba Sandbox",
        number: "4242424242424242",
        cvv: "123",
        expiryMonth: "11",
        expiryYear: "30",
      },
      totalAmount: amount,
      currency: "COP",
    },
  );
  if (!json.token) {
    throw new Error(`Error tokenizando Kushki (HTTP ${status}): ${JSON.stringify(json)}`);
  }
  return json.token as string;
}

async function main() {
  const env = loadServerEnv();
  const credentialResolver = new CredentialResolver(env);
  const app = buildApp({
    logger: false,
    credentialResolver,
    kitPagosProvider: new KitPagosProvider(credentialResolver, env),
  });

  const timestamp = new Date().toISOString();
  console.log(`=== EJECUCIÓN POST /v1/api/payments (x-kit-pagos-environment: sandbox) ===`);
  console.log(`Fecha: ${timestamp}`);

  const results: Record<string, unknown> = {};

  // 1. Wompi
  try {
    const wompiPub = env.WOMPI_PUBLIC_KEY;
    if (!wompiPub) throw new Error("Falta WOMPI_PUBLIC_KEY en .env");
    const token = await tokenizeWompi(wompiPub);
    const orderRef = `SBX-WOMPI-${Date.now()}`;
    const payload = {
      gateway: "wompi",
      amount: "15000.00",
      currency: "COP",
      orderReference: orderRef,
      payer: { email: "usuario@ejemplo.com", fullName: "Usuario Prueba" },
      paymentMethod: { type: "CARD", token, installments: 1 },
    };
    const res = await app.inject({
      method: "POST",
      url: "/v1/api/payments",
      headers: { "x-kit-pagos-environment": "sandbox" },
      payload,
    });
    results.wompi = {
      statusCode: res.statusCode,
      warningHeader: res.headers["x-kit-pagos-warning"],
      body: res.json(),
    };
    console.log(`✔ Wompi: HTTP ${res.statusCode}, outcome: ${res.json().outcome}`);
  } catch (err) {
    console.error(`✘ Wompi error:`, (err as Error).message);
    results.wompi = { error: (err as Error).message };
  }

  // 2. Mercado Pago
  try {
    const mpPub = env.MERCADOPAGO_PUBLIC_KEY;
    if (!mpPub) throw new Error("Falta MERCADOPAGO_PUBLIC_KEY en .env");
    const token = await tokenizeMercadoPago(mpPub);
    const orderRef = `SBX-MP-${Date.now()}`;
    const payload = {
      gateway: "mercadopago",
      amount: "10000.00",
      currency: "COP",
      orderReference: orderRef,
      payer: {
        email: "test_user_123@testuser.com",
        fullName: "APRO",
        documentType: "CC",
        documentNumber: "19119119100",
      },
      paymentMethod: { type: "CARD", token, installments: 1 },
    };
    const res = await app.inject({
      method: "POST",
      url: "/v1/api/payments",
      headers: { "x-kit-pagos-environment": "sandbox" },
      payload,
    });
    results.mercadopago = {
      statusCode: res.statusCode,
      warningHeader: res.headers["x-kit-pagos-warning"],
      body: res.json(),
    };
    console.log(`✔ Mercado Pago: HTTP ${res.statusCode}, outcome: ${res.json().outcome}`);
  } catch (err) {
    console.error(`✘ Mercado Pago error:`, (err as Error).message);
    results.mercadopago = { error: (err as Error).message };
  }

  // 3. Kushki
  try {
    const kushkiPub = env.KUSHKI_PUBLIC_MERCHANT_ID;
    if (!kushkiPub) throw new Error("Falta KUSHKI_PUBLIC_MERCHANT_ID en .env");
    const token = await tokenizeKushki(kushkiPub, 10000);
    const orderRef = `SBX-KUSHKI-${Date.now()}`;
    const payload = {
      gateway: "kushki",
      amount: "10000.00",
      currency: "COP",
      orderReference: orderRef,
      payer: {
        email: "usuario@ejemplo.com",
        fullName: "Usuario Prueba",
      },
      paymentMethod: { type: "CARD", token },
    };
    const res = await app.inject({
      method: "POST",
      url: "/v1/api/payments",
      headers: { "x-kit-pagos-environment": "sandbox" },
      payload,
    });
    results.kushki = {
      statusCode: res.statusCode,
      warningHeader: res.headers["x-kit-pagos-warning"],
      body: res.json(),
    };
    console.log(`✔ Kushki: HTTP ${res.statusCode}, outcome: ${res.json().outcome}`);
  } catch (err) {
    console.error(`✘ Kushki error:`, (err as Error).message);
    results.kushki = { error: (err as Error).message };
  }

  // 4. Rapyd
  try {
    const orderRef = `SBX-RAPYD-${Date.now()}`;
    const payload = {
      gateway: "rapyd",
      amount: "20000.00",
      currency: "COP",
      orderReference: orderRef,
      payer: {
        email: "usuario@ejemplo.com",
        documentType: "CC",
        documentNumber: "1098765432",
      },
      paymentMethod: { type: "CARD" },
    };
    const res = await app.inject({
      method: "POST",
      url: "/v1/api/payments",
      headers: { "x-kit-pagos-environment": "sandbox" },
      payload,
    });
    results.rapyd = {
      statusCode: res.statusCode,
      warningHeader: res.headers["x-kit-pagos-warning"],
      body: res.json(),
    };
    console.log(`✔ Rapyd: HTTP ${res.statusCode}, outcome: ${res.json().outcome}`);
  } catch (err) {
    console.error(`✘ Rapyd error:`, (err as Error).message);
    results.rapyd = { error: (err as Error).message };
  }

  await app.close();

  const outputPath = path.resolve(__dirname, "../../../docs/testing-data/sandbox-payments-execution-issue-123.json");
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ timestamp, results }, null, 2),
    "utf8",
  );
  console.log(`Resultados guardados en ${outputPath}`);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
