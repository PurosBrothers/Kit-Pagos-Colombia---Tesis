# El SDK

El paquete `kit-pagos-colombia`: una sola interfaz en TypeScript para cobrar, consultar, listar bancos y verificar webhooks en Wompi, Mercado Pago, Kushki y Rapyd.

Esta página es la **referencia** de la superficie pública. Para el recorrido de principio a fin, el [tutorial del primer pago](../tutoriales/primero-pago-simulado.md).

---

## 1. Instalación

```bash
npm install kit-pagos-colombia
# o
yarn add kit-pagos-colombia
# o
pnpm add kit-pagos-colombia
```

Requiere Node 20.19 o superior.

---

## 2. Construir el cliente

```typescript
import { KitPagos, Gateway } from "kit-pagos-colombia";

const sdk = new KitPagos({
  gateway: Gateway.WOMPI,
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: process.env.WOMPI_PUBLIC_KEY!,
      privateKey: process.env.WOMPI_PRIVATE_KEY!,
      integritySecret: process.env.WOMPI_INTEGRITY_SECRET,
      webhookSecret: process.env.WOMPI_EVENTS_SECRET,
    },
  },
  environment: "simulator",
  maxRetries: 3,
  timeoutMs: 30_000,
  webhookToleranceSeconds: 300,
});
```

### Opciones (`SDKOptions`)

| Opción | Tipo | Por omisión | Qué hace |
|---|---|---|---|
| `gateway` | `Gateway` | — | La pasarela activa. Es la que usan `createPayment()`, `getPaymentStatus()` y `getPseBanks()` |
| `credentials` | `Partial<Record<Gateway, Credentials>>` | — | Un juego de credenciales por pasarela. Basta con que estén; solo una tiene que estar activa |
| `environment` | `"simulator" \| "sandbox" \| "production"` | `"simulator"` | Resuelve las URL oficiales de un catálogo cerrado |
| `baseUrl` | `string` o mapa por pasarela | — | Sobrescribe el endpoint. **Tiene precedencia sobre `environment`** |
| `maxRetries` | `number` | `3` | Reintentos de `getPaymentStatus()` y `getPseBanks()` |
| `timeoutMs` | `number` | `30_000` | Límite de **cada** petición HTTP, incluida la espera del cuerpo |
| `webhookToleranceSeconds` | `number` | `300` | Ventana contra la repetición de webhooks. `0` la desactiva |

`timeoutMs` se aplica **por intento**: una consulta reintentada puede tardar hasta `(maxRetries + 1) × timeoutMs`, más las pausas. Debe ser un entero entre 1 y 2 147 483 647; fuera de ese rango el constructor lanza `INVALID_REQUEST`.

### Las credenciales de cada pasarela

| Pasarela | `publicKey` | `privateKey` | Extra |
|---|---|---|---|
| **Wompi** | Llave pública | Llave privada | `integritySecret` (firma los cobros) y `webhookSecret` (verifica los eventos) |
| **Mercado Pago** | Public key | `APP_USR-…` access token | `webhookSecret` |
| **Kushki** | Public merchant id | Private merchant id | `webhookSecret` |
| **Rapyd** | API access key | API secret key | `webhookUrl` (la registrada en su panel) |

> **`webhookSecret` no es la llave de API.** En Wompi, Mercado Pago y Kushki es un valor distinto, que se saca de otra parte del panel. Si se omite, el SDK cae a `privateKey` por compatibilidad y **la verificación de webhooks reales de esas tres va a fallar**, con un error de firma que parece un ataque y es configuración. En Wompi, además, `integritySecret` y `webhookSecret` son dos secretos distintos: el primero firma lo que se envía, el segundo verifica lo que llega.

---

## 3. Las cuatro operaciones

### 3.1 `createPayment(request): Promise<PaymentResult>`

Crea un cobro. El resultado es una **unión discriminada** por `outcome`: el campo `transaction` no existe hasta que se descarta el caso de redirección, así que olvidarla no compila.

```typescript
import { Amount, Currency, OrderReference, Payer, PaymentMethod } from "kit-pagos-colombia";

async function cobrar() {
  const result = await sdk.createPayment({
    amount: new Amount("75000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ORD-2026-0901"),
    payer: new Payer({ email: "cliente@ejemplo.com", fullName: "Jaime Pavlich" }),
    paymentMethod: PaymentMethod.card("tok_test_card_12345", { installments: 1 }),
    returnUrlConfig: undefined,
  });

  if (result.outcome === "REDIRECT_REQUIRED") {
    if (result.redirect) {
      console.log(result.redirect.redirectUrl);
    }
    return;
  }

  console.log(result.transaction.getStatus());
}
```

**La petición (`CreatePaymentRequest`):**

| Campo | Obligatorio | Notas |
|---|---|---|
| `amount` | Sí | `new Amount("75000")`. Decimales exactos, nunca `number` |
| `currency` | Sí | `new Currency("COP")` |
| `orderReference` | Sí | `new OrderReference("ORD-1")`, máximo 100 caracteres |
| `payer` | Sí | `new Payer({ email })`; el email es el único campo obligatorio |
| `paymentMethod` | No | Si se omite, las cuatro pasarelas asumen tarjeta |
| `returnUrlConfig` | No | A dónde vuelve el pagador tras PSE o 3DS |
| `taxBreakdown` | No | Desglose de impuestos; **solo Kushki lo exige**, y sin él cobra el monto completo como exento |

La operación **no se reintenta nunca**, ni ante timeout: que la respuesta no llegue no prueba que la pasarela no creara el cobro, y repetirlo podría cobrar dos veces. Antes de reintentar, consulte el estado o espere el webhook.

### 3.2 `getPaymentStatus(id): Promise<Transaction>`

Consulta el estado. Se reintenta sola ante fallos transitorios (`CONNECTION_FAILED`, `GATEWAY_TIMEOUT`, `GATEWAY_SERVER_ERROR`, `RATE_LIMIT_EXCEEDED`, `RESOURCE_LOCKED`), hasta `maxRetries` veces con retroceso exponencial.

```typescript
async function estado(transactionId: string) {
  const transaction = await sdk.getPaymentStatus(transactionId);

  if (transaction.isApproved()) {
    console.log("aprobado");
  } else if (transaction.getStatus() === "DECLINED") {
    console.log(transaction.rejectionReason?.rejectionCategory);
    console.log(transaction.rejectionReason?.rejectionCode);
  }
}
```

`rejectionReason` solo existe cuando el estado es `DECLINED`. `rejectionCode` es el código nativo de la pasarela (`status_detail` en Mercado Pago, `failure_code` en Rapyd, `responseCode` en Kushki); Wompi no envía uno, así que ahí queda vacío.

### 3.3 `getPseBanks(): Promise<PseBank[]>`

Lista los bancos PSE de la pasarela activa. Se reintenta igual que la consulta de estado.

```typescript
async function bancos() {
  const banks = await sdk.getPseBanks();
  for (const bank of banks) {
    console.log(bank.code, bank.name, bank.achCode);
  }
}
```

**Los `code` solo valen en la pasarela que los dio**: cambiar de pasarela obliga a volver a pedir la lista. `achCode` es el código de compensación de ACH Colombia, que sí sirve en las cuatro —el SDK lo traduce para Rapyd—, y aparece solo cuando el banco está en ese catálogo.

### 3.4 `validateWebhook(rawBody, headers, options?)`

Verifica la firma de una notificación y devuelve el evento normalizado. Compara en tiempo constante y comprueba la ventana contra repeticiones.

```typescript
import { KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";

app.post("/webhook", (req, res) => {
  try {
    const event = sdk.validateWebhook(req.rawBody, req.headers);
    console.log(event.eventType, event.gatewayTransactionId, event.newStatus);
    res.status(200).send("OK");
  } catch (error) {
    if (error instanceof KitPagosError && error.code === KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID) {
      console.error("firma inválida o repetición");
    }
    res.status(400).send("falló");
  }
});
```

El cuerpo tiene que llegar **byte a byte**: reserializar el JSON rompe las firmas de Kushki y Rapyd aunque se vea idéntico.

**`WebhookEvent`:** `eventType`, `gatewayTransactionId`, `newStatus`, `gateway`, y dos opcionales que solo vienen cuando la firma cubre el campo del que salen: `rawStatus` y `orderReference`. **Mercado Pago siempre reporta `PENDING`**: su firma no cubre el cuerpo, así que el SDK no confía en ningún estado que venga en él; consulte con `getPaymentStatus()`.

**Webhooks de una pasarela que no es la activa:** durante una migración se cobra por la nueva y siguen llegando webhooks de la vieja. Basta con que esté en `credentials` y se indique la emisora en `{ gateway }`.

---

## 4. Los tipos del dominio

| Tipo | Cómo se construye | Para qué |
|---|---|---|
| `Amount` | `new Amount("75000")` | Monto con decimales exactos (`big.js`). Tiene `multiply()` y `divide()`, que piden un `RoundingMode` |
| `Currency` | `new Currency("COP")` | Divisa ISO 4217; calcula las unidades menores |
| `OrderReference` | `new OrderReference("ORD-1")` | Referencia del pedido, hasta 100 caracteres |
| `Payer` | `new Payer({ email, ... })` | `email` obligatorio; `fullName` o `firstName`/`lastName`, `documentType`, `documentNumber`, `phone`, `phoneAreaCode`, `address` |
| `PaymentMethod` | `PaymentMethod.card(token, { installments })` y `PaymentMethod.pse({ bankCode, payerKind })` | Con qué se paga |
| `ReturnUrlConfig` | `new ReturnUrlConfig(url)` o `(null, { success, failure, pending })` | A dónde vuelve el pagador |
| `TaxBreakdown` | `TaxBreakdown.fromTaxIncluded(amount, rate, currency)` o `.fromComponents({...})` | Desglose de impuestos para Kushki |
| `PseBankCode` | `PseBankCode.BANCOLOMBIA` | Código de banco ACH, válido en las cuatro |
| `Transaction` | La devuelve el SDK | `getStatus()`, `isApproved()`, `isPending()`, `isFinal()`, `rawStatus`, `rejectionReason`, `amount`, `currency`, `orderReference`, `payer`, `gatewayTransactionId` |

**Cada pasarela pide sus datos y el SDK no los inventa.** Mercado Pago exige para PSE nombre y apellido separados, teléfono con indicativo, dirección e IP del pagador. Si falta un dato, el SDK falla **antes de salir a la red**, con `INVALID_REQUEST` y la lista de lo que falta.

---

## 5. El módulo de navegador

`kit-pagos-colombia/browser` es un punto de entrada aparte, sin dependencias de Node.js, para tokenizar la tarjeta **en el navegador**. El número nunca llega a su servidor.

```typescript
import { KitPagosBrowser, Gateway } from "kit-pagos-colombia/browser";

async function tokenizar() {
  const result = await KitPagosBrowser.tokenizeCard({
    gateway: Gateway.WOMPI,
    publicKey: "pub_test_1234567890",
    environment: "sandbox",
    card: {
      number: "4242424242424242",
      cvc: "123",
      expMonth: "12",
      expYear: "2030",
      cardHolder: "Juan Pérez",
      docType: "CC",
      docNumber: "19119119100",
    },
  });
  console.log(result.token);
}
```

- **Tokeniza con Wompi, Mercado Pago y Kushki.** Rapyd no: cobra la tarjeta en su página alojada, y `tokenizeCard()` la rechaza con `UNSUPPORTED_OPERATION` sin abrir conexiones.
- **Kushki exige `amount`** y ata el token a ese monto: cobrarlo por otro devuelve `400 K220`.
- **No protege la página.** El formulario es del comercio, y un script malicioso en esa página podría leer el número antes de tokenizar: el comercio queda en SAQ A-EP, y lo que lo limita es una cabecera `Content-Security-Policy` que manda su servidor.

---

## 6. Los trece errores

Todos los fallos técnicos llegan como `KitPagosError`, con un `code` de `KitPagosErrorCode` y sin credenciales en el mensaje: el SDK borra las llaves, los `Bearer` y los secretos antes de lanzarlo.

| Código | Cuándo |
|---|---|
| `INVALID_CREDENTIALS` | Fallo de autenticación (HTTP 401/403) |
| `CONNECTION_FAILED` | No se pudo conectar con la pasarela |
| `GATEWAY_TIMEOUT` | La pasarela no respondió dentro de `timeoutMs`, o respondió 408 |
| `RATE_LIMIT_EXCEEDED` | Límite de peticiones (HTTP 429) |
| `INVALID_REQUEST` | Parámetros malformados o rechazados por validación (400/409/422) |
| `RESOURCE_NOT_FOUND` | Transacción u orden inexistente (404) |
| `RESOURCE_LOCKED` | La pasarela procesa otra petición con la misma llave (423) |
| `GATEWAY_SERVER_ERROR` | Error interno de la pasarela (5xx) |
| `MALFORMED_RESPONSE` | Respuesta o webhook que no se puede interpretar |
| `WEBHOOK_SIGNATURE_INVALID` | Firma inválida o timestamp caducado |
| `UNSUPPORTED_OPERATION` | La pasarela no soporta esa operación |
| `MAX_RETRIES_EXCEEDED` | Un fallo transitorio persistió; el último error viaja en `cause` |
| `UNKNOWN_ERROR` | Error no tipificado |

**Un error transitorio con `maxRetries: 0`** llega con su propio código, no como `MAX_RETRIES_EXCEEDED`.

---

## 7. Los límites

- **Los tokens de tarjeta no son portables** entre pasarelas.
- **La redirección no desaparece**: con PSE redirigen las cuatro, y con tarjeta Rapyd cobra en su página alojada y Wompi y Kushki pueden pedir 3DS.
- **Solo tarjeta y PSE.** Sin efectivo, Nequi, Daviplata, suscripciones ni reembolsos.
- **El SDK no protege la página de pago ni decide el monto.**
- **No se reinventa `createPayment()`**, por la razón de la sección 3.1.

Los límites completos están en [`README.md`](../README.md#4-los-límites-del-producto).
