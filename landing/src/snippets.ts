/**
 * Fragmentos de código TypeScript mostrados en la página de presentación.
 *
 * Todos los bloques son compilables contra el SDK de Kit Pagos Colombia
 * (kit-pagos-colombia y kit-pagos-colombia/browser) y están auditados por
 * scripts/check-snippets.ts en cada compilación.
 */

// Fragmento compacto y esencial para demostración interactiva
export const SNIPPET_UNIFIED_PAYMENT = `import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  PaymentMethod,
} from "kit-pagos-colombia";

// 1. Instanciar pasarela activa (lo único que cambia para alternar)
const kitPagos = new KitPagos({
  gateway: Gateway.WOMPI, // <- Lo único que cambia para alternar
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_demo",
      privateKey: "prv_test_demo",
      integritySecret: "test_integrity_secret",
    },
  },
});

// 2. Cobro unificado: idéntico para cualquier pasarela
const resultado = await kitPagos.createPayment({
  amount: new Amount("150000.00"),
  currency: new Currency("COP"),
  orderReference: new OrderReference("ORDER-1042"),
  payer: new Payer({
    email: "cliente@example.com",
    fullName: "Jaime Pavlich",
  }),
  paymentMethod: PaymentMethod.card("tok_test_card_12345"),
});`;

// Fragmento completo con las 4 pasarelas configuradas simultáneamente
export const SNIPPET_UNIFIED_FULL = `import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  PaymentMethod,
} from "kit-pagos-colombia";

const credentials = {
  [Gateway.WOMPI]: {
    publicKey: "pub_test_demo",
    privateKey: "prv_test_demo",
    integritySecret: "test_integrity_secret",
  },
  [Gateway.MERCADOPAGO]: {
    publicKey: "TEST-public-key",
    privateKey: "TEST-access-token",
  },
  [Gateway.KUSHKI]: {
    publicKey: "public_merchant_id",
    privateKey: "private_merchant_id",
  },
  [Gateway.RAPYD]: {
    publicKey: "rapyd_access_key",
    privateKey: "rapyd_secret_key",
  },
};

const kitPagos = new KitPagos({
  gateway: Gateway.WOMPI, // <- Lo único que cambia para alternar de pasarela
  credentials,
});

const resultado = await kitPagos.createPayment({
  amount: new Amount("150000.00"),
  currency: new Currency("COP"),
  orderReference: new OrderReference("ORDER-1042"),
  payer: new Payer({
    email: "cliente@example.com",
    fullName: "Jaime Pavlich",
  }),
  paymentMethod: PaymentMethod.card("tok_test_card_12345"),
});`;

export const SNIPPET_GATEWAY_CREDS: Record<string, string> = {
  WOMPI: `    [Gateway.WOMPI]: {
      publicKey: "pub_test_demo",
      privateKey: "prv_test_demo",
      integritySecret: "test_integrity_secret",
    },`,
  MERCADOPAGO: `    [Gateway.MERCADOPAGO]: {
      publicKey: "TEST-public-key",
      privateKey: "TEST-access-token",
    },`,
  KUSHKI: `    [Gateway.KUSHKI]: {
      publicKey: "public_merchant_id",
      privateKey: "private_merchant_id",
    },`,
  RAPYD: `    [Gateway.RAPYD]: {
      publicKey: "rapyd_access_key",
      privateKey: "rapyd_secret_key",
    },`,
};

export const SNIPPET_BROWSER_TOKENIZE = `import { KitPagosBrowser, Gateway } from "kit-pagos-colombia/browser";

const browser = new KitPagosBrowser();

// Tokenización directa en navegador: el número de tarjeta jamás toca tu backend (PCI DSS)
const { token } = await browser.tokenizeCard({
  gateway: Gateway.WOMPI,
  publicKey: "pub_test_demo",
  card: {
    number: "4242424242424242",
    cvc: "123",
    expMonth: "12",
    expYear: "28",
    cardHolder: "Jaime Pavlich",
  },
});`;

export const SNIPPET_WEBHOOK_VERIFY = `import { KitPagos, Gateway } from "kit-pagos-colombia";

const kitPagos = new KitPagos({
  gateway: Gateway.WOMPI,
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_demo",
      privateKey: "prv_test_demo",
      integritySecret: "test_integrity_secret",
    },
  },
});

// Verificación de firma y frescura normalizada
const evento = kitPagos.validateWebhook(
  '{"event":"transaction.updated"}',
  { "x-event-checksum": "sha256_hash_aqui" }
);

console.log(evento.eventType, evento.newStatus); // APPROVED | DECLINED | ERROR`;

export const SNIPPET_PSE_PAYMENT = `import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  PaymentMethod,
  PseBankCode,
} from "kit-pagos-colombia";

const kitPagos = new KitPagos({
  gateway: Gateway.WOMPI,
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_demo",
      privateKey: "prv_test_demo",
      integritySecret: "test_integrity_secret",
    },
  },
});

const transaccionPse = await kitPagos.createPayment({
  amount: new Amount("150000.00"),
  currency: new Currency("COP"),
  orderReference: new OrderReference("ORDER-PSE-104"),
  payer: new Payer({
    email: "cliente@example.com",
    fullName: "Jaime Pavlich",
    documentType: "CC",
    documentNumber: "1020304050",
    phone: "3001234567",
  }),
  paymentMethod: PaymentMethod.pse({
    bankCode: PseBankCode.BANCOLOMBIA,
    payerKind: "NATURAL",
  }),
});`;

export const SNIPPET_DISPARITY_WOMPI = `// 1. Obtener acceptance_token obligatorio previo
const presign = await fetch("https://sandbox.wompi.co/v1/merchants/pub_test_x");
const { presigned_acceptance } = (await presign.json()).data;
const token = presigned_acceptance.acceptance_token;

// 2. Calcular firma de integridad SHA-256 en centavos
const raw = "ORD-1" + "15000000" + "COP" + "integrity_secret";
const signature = sha256(raw);

// 3. Petición POST a Wompi
const res = await fetch("https://sandbox.wompi.co/v1/transactions", {
  method: "POST",
  headers: { Authorization: "Bearer pub_test_x" },
  body: JSON.stringify({
    amount_in_cents: 15000000, // <- Centavos obligatorios
    currency: "COP",
    signature,
    acceptance_token: token,
    payment_method: { type: "CARD", token: "tok_test_card" },
    reference: "ORD-1",
  }),
});`;

export const SNIPPET_DISPARITY_MERCADOPAGO = `// Cobro directo en Mercado Pago (sin acceptance_token)
// Exige cabecera X-Idempotency-Key y monto en pesos
const idempotencyKey = crypto.randomUUID();

const res = await fetch("https://api.mercadopago.com/v1/payments", {
  method: "POST",
  headers: {
    Authorization: "Bearer APP_USR-xxx",
    "X-Idempotency-Key": idempotencyKey, // <- Cabecera obligatoria
  },
  body: JSON.stringify({
    transaction_amount: 150000, // <- Pesos directos (no centavos)
    token: "tok_test_card",
    installments: 1, // <- Obligatorio como entero
    payer: { email: "cliente@example.com" },
    external_reference: "ORD-1",
  }),
});`;

export const SNIPPET_REST_CURL = `curl -X POST https://kit-pagos-colombia.onrender.com/v1/api/payments \\
  -H "Content-Type: application/json" \\
  -H "x-kit-pagos-environment: sandbox" \\
  -d '{
    "gateway": "wompi",
    "amount": "150000.00",
    "currency": "COP",
    "orderReference": "ORD-CURL-001",
    "payer": {
      "email": "dev@javeriana.edu.co",
      "fullName": "Joshua Prieto"
    },
    "paymentMethod": {
      "type": "CARD",
      "token": "tok_test_card_12345"
    }
  }'`;
