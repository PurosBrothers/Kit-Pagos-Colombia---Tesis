# Kit Pagos Colombia

[![npm version](https://img.shields.io/npm/v/kit-pagos-colombia.svg?color=blue)](https://www.npmjs.com/package/kit-pagos-colombia)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

**Kit Pagos Colombia** es un SDK unificado en TypeScript para la integración de pasarelas de pago en Colombia (**Wompi**, **Mercado Pago**, **Kushki** y **Rapyd**).

Diseñado bajo los principios de **Arquitectura Hexagonal (Ports & Adapters)** y **Domain-Driven Design (DDD)**, permite a comercios y desarrolladores desacoplar por completo su lógica de negocio de los detalles propietarios de cada pasarela, habilitando la intercambiabilidad de pasarelas mediante configuración pura, sin modificar el código de la aplicación.

---

## Características Principales

- **Intercambiabilidad real sin *vendor lock-in*:** Permite cambiar de proveedor de pagos (ej. de Wompi a Mercado Pago o Kushki) modificando únicamente el archivo de configuración.
- **Tipado estricto de extremo a extremo:** Contratos, entidades, objetos de valor y enumeraciones en TypeScript con declaraciones `.d.ts` completas.
- **Aritmética financiera exacta:** Manejo de montos mediante el objeto de valor `Amount` (con respaldo de `big.js`), previniendo errores de redondeo de punto flotante IEEE 754 y calculando unidades menores según ISO 4217 (`COP`).
- **Verificación criptográfica de Webhooks:** Validación de firmas nativas (HMAC-SHA256, SHA-256) con comparación en tiempo constante (`crypto.timingSafeEqual`) y **protección contra ataques de repetición (*anti-replay attacks*)** con ventana de tolerancia temporal configurable.
- **Gestión de fallos y resiliencia:** Política de reintentos automáticos con retroceso exponencial (*exponential backoff*) y fluctuación (*jitter*) ante fallos de red transitorios, aislando errores permanentes de negocio.
- **Seguridad y privacidad por diseño (RF-08):** Sanitización automática de llaves privadas, tokens `Bearer` y secretos en mensajes de error y registros para evitar filtraciones en logs de producción.
- **Tokenización segura en navegador (`kit-pagos-colombia/browser`):** Módulo frontend liviano (unos 14 KB sin minificar, 3,6 KB con gzip) sin dependencias de Node.js para tokenizar tarjetas directamente contra la pasarela respetando PCI DSS.

---

## Pasarelas Soportadas

| Pasarela | Tarjeta de Crédito / Débito | PSE (Transferencia Bancaria) | Webhooks con Anti-Replay | Consulta de Estado |
|---|:---:|:---:|:---:|:---:|
| **Wompi** | ✅ | ✅ | ✅ | ✅ |
| **Mercado Pago** | ✅ | ✅ | ✅ | ✅ |
| **Kushki** | ✅ | ✅ | ✅ | Solo PSE |
| **Rapyd** | ✅ | ✅ | ✅ | ✅ |

> **Kushki y la consulta de tarjeta.** La única consulta de tarjeta que Kushki publica es la
> de su flujo **asíncrono** (`/card-async`, preautorización y captura), y un cobro del flujo
> síncrono no queda registrado ahí: responde `CAS004 "No existe la transacción"`. El SDK la
> intenta y, cuando contesta eso, lanza `UNSUPPORTED_OPERATION` explicándolo, en vez de
> acusar a sus credenciales. No se queda sin el dato: el estado ya viene resuelto en la
> respuesta de `createPayment()`, y los cambios posteriores llegan por webhook.

---

## Instalación

Instale el paquete en su proyecto con su gestor de paquetes preferido:

```bash
npm install kit-pagos-colombia
```

```bash
yarn add kit-pagos-colombia
```

```bash
pnpm add kit-pagos-colombia
```

---

## Guía Rápida de Uso

### 1. Inicializar el SDK

Configure las credenciales de sus pasarelas e indique cuál es la pasarela activa:

```typescript
import { KitPagos, Gateway } from "kit-pagos-colombia";

const sdk = new KitPagos({
  gateway: Gateway.WOMPI, // Pasarela activa seleccionada
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: process.env.WOMPI_PUBLIC_KEY!,
      privateKey: process.env.WOMPI_PRIVATE_KEY!,
      integritySecret: process.env.WOMPI_INTEGRITY_SECRET, // Firma los cobros que crea
      webhookSecret: process.env.WOMPI_EVENTS_SECRET,      // Verifica los webhooks que recibe
    },
    [Gateway.MERCADOPAGO]: {
      publicKey: process.env.MP_PUBLIC_KEY!,
      privateKey: process.env.MP_ACCESS_TOKEN!,
      webhookSecret: process.env.MP_WEBHOOK_SECRET,
    },
    [Gateway.KUSHKI]: {
      publicKey: process.env.KUSHKI_PUBLIC_ID!,
      privateKey: process.env.KUSHKI_PRIVATE_ID!,
      webhookSecret: process.env.KUSHKI_WEBHOOK_SECRET,
    },
    [Gateway.RAPYD]: {
      publicKey: process.env.RAPYD_API_ACCESS_KEY!,
      privateKey: process.env.RAPYD_API_SECRET_KEY!,
      // Rapyd es la única que firma sus webhooks con la misma llave de la API,
      // así que aquí `webhookSecret` no hace falta.
    },
  },
  maxRetries: 3,                 // Reintentos automáticos ante fallos transitorios
  timeoutMs: 30_000,             // Límite de cada petición a la pasarela (por defecto 30 s)
  webhookToleranceSeconds: 300,  // Tolerancia de 5 minutos contra ataques de replay
  environment: "sandbox",        // "simulator" (por defecto), "sandbox" o "production"
});
```

> **Límite de tiempo por petición (`timeoutMs`).** Cada petición HTTP que el SDK hace a la
> pasarela se corta a los `timeoutMs` milisegundos (30 000 por omisión), incluida la espera del
> cuerpo de la respuesta, y la operación falla con `GATEWAY_TIMEOUT`. Sin este límite, una
> pasarela que acepta la conexión y no responde dejaría la petición abierta indefinidamente.
> El valor debe ser un entero entre 1 y 2 147 483 647; fuera de ese rango, el constructor de
> `KitPagos` lanza `INVALID_REQUEST`. El límite es **por intento**: una consulta que se
> reintenta puede tardar hasta `(maxRetries + 1) × timeoutMs`, más las pausas entre intentos.

> **Entornos y Resolución Automática de URLs (`environment`).** Puede especificar el entorno destino mediante la opción `environment: "simulator" | "sandbox" | "production"`. El SDK resuelve automáticamente la URL oficial de cada pasarela desde un catálogo cerrado integrado. Por defecto el ambiente es `simulator` y apunta al simulador local (`http://localhost:3000/v1/sim/{gateway}`); para usar el simulador desplegado en Render, indíquelo con `baseUrl` (ver «Simulador Integrado y en la Nube» más abajo). Si necesita apuntar a una URL específica o mock propio, el parámetro `baseUrl` sigue disponible como anulación explícita.

> **`webhookSecret` no es la llave de API.** En Wompi, Mercado Pago y Kushki el secreto que
> firma los webhooks es un valor distinto, que se saca de otra parte del panel. Si lo omite,
> el SDK cae a `privateKey` por compatibilidad y **la verificación de webhooks reales de esas
> tres va a fallar**, con un error de firma inválida que parece un ataque y es configuración.
> En Wompi, además, `integritySecret` y `webhookSecret` son dos secretos distintos: el primero
> firma lo que envía, el segundo verifica lo que le llega.

---

### 2. Crear una Transacción con Tarjeta

```typescript
import { Amount, Currency, OrderReference, Payer, PaymentMethod } from "kit-pagos-colombia";

async function cobrarConTarjeta() {
  const result = await sdk.createPayment({
    amount: new Amount("75000"), // $75.000 COP
    currency: new Currency("COP"),
    orderReference: new OrderReference("ORD-2026-0901"),
    payer: new Payer({
      email: "cliente@ejemplo.com",
      fullName: "Jaime Pavlich",
    }),
    // El token lo emite la tokenización de la pasarela desde el navegador, y el SDK lo
    // trata como cadena opaca: el número de la tarjeta nunca llega a su servidor, que es
    // lo que lo mantiene fuera del alcance de PCI DSS.
    paymentMethod: PaymentMethod.card("tok_test_card_12345", { installments: 1 }),
  });

  // El resultado es una unión discriminada por `outcome`: el campo `transaction` no
  // existe hasta que se descarta el caso de redirección, así que olvidarla no compila.
  if (result.outcome === "REDIRECT_REQUIRED") {
    // Si la pasarela requiere autenticación 3D Secure / OTP o es Hosted Checkout (Rapyd):
    console.log(`Redirigir a verificación/3DS: ${result.redirect.redirectUrl}`);
    return;
  }

  const tx = result.transaction;
  console.log(`Estado: ${tx.getStatus()}`); // APPROVED, DECLINED, PENDING...
  console.log(`ID Pasarela: ${tx.gatewayTransactionId.value}`);
}
```

> Con tarjeta también puede recibir `REDIRECT_REQUIRED`: Rapyd cobra en su página alojada, y
> cualquiera de las cuatro puede pedir autenticación 3DS. Trate siempre las dos ramas.

#### 2.1 Tokenización en el Navegador (`kit-pagos-colombia/browser`)

Para cumplir con **PCI DSS**, los datos sensibles de la tarjeta (número PAN, CVC, fecha de expiración) **nunca deben entrar al backend del comercio ni al SDK de servidor**.

El paquete exporta un punto de entrada independiente y liviano para el frontend (`kit-pagos-colombia/browser`, unos 14 KB sin minificar y 3,6 KB con gzip, sin módulos de Node.js):

```typescript
import { KitPagosBrowser, Gateway } from "kit-pagos-colombia/browser";

async function tokenizarTarjetaEnNavegador() {
  // Un mismo formulario captura los datos de la tarjeta y el documento de identidad:
  const datosFormulario = {
    number: "4242424242424242",
    cvc: "123",
    expMonth: "12",
    expYear: "2030",
    cardHolder: "Juan Pérez",
    docType: "CC",            // El SDK lo exige en Mercado Pago; opcional en Wompi
    docNumber: "19119119100",  // El SDK lo exige en Mercado Pago; opcional en Wompi
  };

  // 1. Tokenización contra Wompi:
  const wompiResult = await KitPagosBrowser.tokenizeCard({
    gateway: Gateway.WOMPI,
    publicKey: "pub_prod_1234567890", // O pub_test_... para sandbox
    environment: "sandbox",          // "sandbox" | "production" | "simulator"
    card: datosFormulario,
    timeoutMs: 15_000,               // Opcional: límite de la petición (por defecto 30 s)
  });

  // 2. Tokenización contra Mercado Pago (exactamente con los mismos datos de entrada):
  const mpResult = await KitPagosBrowser.tokenizeCard({
    gateway: Gateway.MERCADOPAGO,
    publicKey: "APP_USR-public-key",
    environment: "sandbox",
    card: datosFormulario,
  });

  // El token resultante se envía a SU backend para llamar a PaymentMethod.card()
  console.log(`Token Wompi: ${wompiResult.token}`);
  console.log(`Token Mercado Pago: ${mpResult.token}`);
}
```

> **Límite de tiempo de la tokenización (`timeoutMs`).** La petición a la pasarela se corta a
> los `timeoutMs` milisegundos (30 000 por omisión), incluida la lectura de la respuesta, y en
> ese caso `tokenizeCard()` lanza `KitPagosError` con `GATEWAY_TIMEOUT`. Acepta un entero entre
> 1 y 2 147 483 647, igual que `timeoutMs` del SDK de servidor; cualquier otro valor lanza
> `INVALID_REQUEST` antes de enviar la tarjeta. Usa `AbortSignal.timeout`, que el navegador del
> pagador tiene que soportar.

> **PCI DSS:** Al usar `KitPagosBrowser`, el número de tarjeta viaja exclusivamente entre el navegador del pagador y los servidores de la pasarela. Su backend solo recibe y almacena el token opaco `tok_...`. El SDK rechaza activamente pasarelas que no soportan tokenización inline en frontend (como Kushki y Rapyd) con `KitPagosError(UNSUPPORTED_OPERATION)` sin abrir conexiones.

> **Compatibilidad de `kit-pagos-colombia/browser` fuera del navegador.** TypeScript resuelve
> sus tipos con `moduleResolution` `bundler`, `node16` y `node10`. El archivo es un módulo ES
> y el paquete no declara `"type"`, porque la raíz `kit-pagos-colombia` es CommonJS. Medido el
> 6 de octubre de 2026 con el paquete instalado desde su tarball: en Node 20.19.0, 20.20.2 y
> 22.22.3 se carga tanto con `import` como con `require`; en Node 20.18.0 fallan los dos con
> `SyntaxError`. Quien lo use desde Node (por ejemplo, en renderizado del lado del servidor)
> necesita Node 20.19 o superior, y por eso `package.json` declara `"engines": { "node":
> ">=20.19.0" }`: con una versión anterior, npm solo lo advierte al instalar, salvo que quien
> instala active `engine-strict`
> ([documentación de npm](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#engines)).
> Cargado desde una ruta fuera de `node_modules`, como un
> enlace `file:`, `import` emite la advertencia `MODULE_TYPELESS_PACKAGE_JSON`; instalado en
> `node_modules`, no.

---

### 3. Crear una Transacción con PSE (Redirección Bancaria)

```typescript
import {
  Amount,
  Currency,
  OrderReference,
  Payer,
  PaymentMethod,
  ReturnUrlConfig,
} from "kit-pagos-colombia";

async function pagarConPSE() {
  const result = await sdk.createPayment({
    amount: new Amount("150000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ORD-PSE-8841"),
    payer: new Payer({
      email: "comprador@banco.com",
      fullName: "Jaime Pavlich",
      // PSE exige el documento del pagador en las cuatro pasarelas. Si falta, el SDK
      // corta antes de la llamada de red en vez de traducirle un HTTP 400.
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({
      bankCode: "1022",       // Código del banco, tal como lo dio getPseBanks()
      payerKind: "NATURAL",   // "NATURAL" o "LEGAL". Por defecto: "NATURAL"
    }),
    returnUrlConfig: new ReturnUrlConfig("https://mitienda.com/checkout/resultado"),
  });

  if (result.outcome === "REDIRECT_REQUIRED") {
    // Redirija al pagador a la URL de su banco
    console.log(`Redirigir a: ${result.redirect.redirectUrl}`);
    // Guarde este identificador: es con lo que se consulta el pago si el pagador no vuelve.
    console.log(`ID Pasarela: ${result.redirect.gatewayTransactionId.value}`);
  }
}
```

> Los `bankCode` salen de `sdk.getPseBanks()` y **solo valen en la pasarela que los dio**:
> cambiar de pasarela obliga a volver a pedir la lista. Es la consecuencia de que cada una
> identifique los bancos a su manera; lo que el SDK garantiza es que usted no tenga que saber cómo.

> Un PSE también puede volver como `TRANSACTION`, y por eso conviene tratar las dos ramas. Pasa
> cuando el pago ya tiene desenlace al crearlo: en el sandbox de Wompi la URL del banco llega en
> la misma consulta que `APPROVED`, `DECLINED` o `ERROR`, y Mercado Pago responde `402` cuando la
> orden se crea con el pago fallido. En los dos casos `createPayment()` devuelve la transacción
> normalizada (en Mercado Pago, `DECLINED` con el identificador de la orden) en vez de una
> redirección hacia un pago que ya terminó.

---

### 4. Consultar Estado de una Transacción

```typescript
async function verificarEstado(transactionId: string) {
  const transaction = await sdk.getPaymentStatus(transactionId);

  if (transaction.isApproved()) {
    console.log("¡Pago aprobado exitosamente!");
  } else if (transaction.getStatus() === "DECLINED") {
    // El código nativo de la pasarela, más la categoría ya normalizada por el SDK.
    console.log(`Rechazo: ${transaction.rejectionReason?.rejectionCategory}`);
    console.log(`Código de la pasarela: ${transaction.rejectionReason?.rejectionCode}`);
  }
}
```

`rejectionReason` solo existe cuando el estado es `DECLINED`. `rejectionCode` es el código nativo tal como lo envía la pasarela: el `status_detail` en Mercado Pago, el `failure_code` en Rapyd y el `responseCode` en Kushki. Wompi no envía un código de rechazo, así que en Wompi `rejectionReason` queda vacío. `rejectionCategory` es una categoría normalizada solo cuando hay una fuente para la correspondencia; en los demás casos es `UNKNOWN`, y conviene decidir con el código nativo.

`getPaymentStatus()` y `getPseBanks()` se reintentan solos ante fallos transitorios
(`CONNECTION_FAILED`, `GATEWAY_TIMEOUT`, `GATEWAY_SERVER_ERROR`, `RATE_LIMIT_EXCEEDED`), hasta
`maxRetries` veces (3 por omisión) con retroceso exponencial. Si el fallo persiste en todos los
intentos, la operación termina en `MAX_RETRIES_EXCEEDED`, con el último error en `cause`:

```typescript
async function consultarConDiagnostico(transactionId: string) {
  try {
    return await sdk.getPaymentStatus(transactionId);
  } catch (error) {
    if (error instanceof KitPagosError && error.code === KitPagosErrorCode.MAX_RETRIES_EXCEEDED) {
      // El último intento fallido, con su propio código (por ejemplo, GATEWAY_TIMEOUT).
      const ultimo = error.cause instanceof KitPagosError ? error.cause.code : undefined;
      console.error(`La pasarela no respondió tras varios intentos. Último error: ${ultimo}`);
    }
    throw error;
  }
}
```

Un error que no es transitorio, como `RESOURCE_NOT_FOUND` o `INVALID_CREDENTIALS`, no se
reintenta y llega con su propio código en el primer intento. Con `maxRetries: 0` no hay
reintentos, y el error transitorio llega también con su propio código, no como
`MAX_RETRIES_EXCEEDED`.

---

### 5. Validar y Conciliar Webhooks

El SDK verifica la firma criptográfica en tiempo constante y comprueba que la notificación no haya excedido la ventana de tolerancia temporal (protección anti-replay):

```typescript
import { KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";

app.post("/webhook", (req, res) => {
  const rawBody = req.rawBody; // String exacto sin re-serializar
  const headers = req.headers as Record<string, string>;

  try {
    const event = sdk.validateWebhook(rawBody, headers);

    console.log(`Evento: ${event.eventType}`);
    console.log(`Transacción: ${event.gatewayTransactionId}`);
    console.log(`Nuevo Estado: ${event.newStatus}`);

    res.status(200).send("OK");
  } catch (error) {
    if (error instanceof KitPagosError) {
      if (error.code === KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID) {
        console.error("Firma inválida o posible ataque de repetición (replay)");
      } else if (error.code === KitPagosErrorCode.MALFORMED_RESPONSE) {
        console.error("Cuerpo o cabeceras del webhook malformadas");
      }
    }
    res.status(400).send("Webhook verification failed");
  }
});
```

**Mercado Pago siempre reporta `PENDING`.** `validateWebhook()` de Mercado Pago devuelve siempre
`newStatus: "PENDING"`: la firma no cubre el cuerpo de la notificación, así que el SDK no confía en
ningún estado que venga en él. Consulte el estado real con
`getPaymentStatus(event.gatewayTransactionId)`.

**Webhooks de una pasarela que no es la activa.** Durante una migración usted cobra por la pasarela
nueva y sigue recibiendo webhooks de la vieja por semanas: pagos ya iniciados, conciliaciones,
reembolsos. Indique la pasarela emisora y no necesitará un segundo `KitPagos`; basta con que
esté en `credentials`, no hace falta que esté activa:

```typescript
const PASARELAS = {
  wompi: Gateway.WOMPI,
  mercadopago: Gateway.MERCADOPAGO,
} as const;

app.post("/webhooks/:pasarela", (req, res) => {
  const event = sdk.validateWebhook(req.rawBody, req.headers as Record<string, string>, {
    gateway: PASARELAS[req.params.pasarela as keyof typeof PASARELAS],
  });
  res.status(200).send("OK");
});
```

> Si su servidor tiene el reloj desfasado, la protección anti-replay va a rechazar webhooks
> legítimos con `WEBHOOK_SIGNATURE_INVALID`. Puede ampliar la ventana con `toleranceSeconds`,
> o desactivarla con `0`, pero lo correcto es sincronizar el reloj.

---

### 6. Manejo Unificado de Errores

Todos los fallos técnicos se transforman en instancias de `KitPagosError` con códigos homogéneos:

```typescript
import { CreatePaymentRequest, KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";

async function cobrarConDiagnostico(request: CreatePaymentRequest) {
  try {
    await sdk.createPayment(request);
  } catch (error) {
    if (error instanceof KitPagosError) {
      switch (error.code) {
        case KitPagosErrorCode.CONNECTION_FAILED:
          console.error("Error de conectividad de red con la pasarela.");
          break;
        case KitPagosErrorCode.GATEWAY_TIMEOUT:
          console.error("La pasarela tardó demasiado en responder.");
          break;
        case KitPagosErrorCode.INVALID_CREDENTIALS:
          console.error("Credenciales expiradas o no válidas.");
          break;
        case KitPagosErrorCode.RATE_LIMIT_EXCEEDED:
          console.error("Límite de peticiones excedido (HTTP 429).");
          break;
        default:
          console.error(`Error técnico (${error.code}): ${error.message}`);
      }
    }
  }
}
```

> **`createPayment()` no se reintenta**, ni siquiera ante `GATEWAY_TIMEOUT`. Que la respuesta
> no haya llegado a tiempo no prueba que la pasarela no haya creado el cobro, y repetirlo podría
> cobrar dos veces. Antes de volver a cobrar, confirme el estado con `getPaymentStatus()` o
> espere el webhook.

---

## Catálogo de Códigos de Error (`KitPagosErrorCode`)

- `INVALID_CREDENTIALS`: Fallo de autenticación HTTP 401/403.
- `CONNECTION_FAILED`: Imposibilidad de conectar con el servidor de la pasarela.
- `GATEWAY_TIMEOUT`: La pasarela no respondió dentro de `timeoutMs`, o respondió HTTP 408.
- `RATE_LIMIT_EXCEEDED`: Límite de tasa de solicitudes superado (HTTP 429).
- `INVALID_REQUEST`: Parámetros de cobro malformados o rechazados por validación (HTTP 400/409/422).
- `RESOURCE_NOT_FOUND`: Transacción u orden no encontrada (HTTP 404).
- `GATEWAY_SERVER_ERROR`: Error interno en los servidores de la pasarela (HTTP 5xx).
- `MALFORMED_RESPONSE`: Respuesta o webhook no interpretable como JSON válido.
- `WEBHOOK_SIGNATURE_INVALID`: Firma digital de webhook inválida o timestamp caducado.
- `UNSUPPORTED_OPERATION`: Método o flujo no soportado por la pasarela seleccionada (por ejemplo, consultar un cobro con tarjeta en Kushki).
- `MAX_RETRIES_EXCEEDED`: Un fallo transitorio persistió en todos los intentos de `getPaymentStatus()` o `getPseBanks()`. El último error viaja en `cause`.
- `UNKNOWN_ERROR`: Error genérico no tipificado.

---

## 🚀 Despliegue a Producción y Consideraciones Reales

Si va a utilizar este SDK en un entorno de producción para procesar pagos reales con dinero de verdad, tenga en cuenta las siguientes consideraciones de arquitectura y normativa financiera:

### 1. Resolución de Entornos y URLs Oficiales

El SDK incluye un catálogo cerrado de URLs para los tres ambientes soportados, evitando tener que configurar manualmente las direcciones de cada proveedor:

| Pasarela | Sandbox (`environment: "sandbox"`) | Producción (`environment: "production"`) |
|---|---|---|
| **Wompi** | `https://sandbox.wompi.co/v1` | `https://production.wompi.co/v1` |
| **Mercado Pago** | `https://api.mercadopago.com/v1` | `https://api.mercadopago.com/v1` |
| **Kushki** | `https://api-uat.kushkipagos.com` | `https://api.kushkipagos.com` |
| **Rapyd** | `https://sandboxapi.rapyd.net/v1` | `https://api.rapyd.net/v1` |

**Simulador Integrado y en la Nube (`environment: "simulator"`):**
Por defecto apunta al simulador local (`http://localhost:3000/v1/sim/{gateway}`), para que ninguna petición salga de la máquina sin pedirlo. Para usar el simulador desplegado en Render (o consultar su documentación interactiva OpenAPI 3.0 en [`/docs`](https://kit-pagos-colombia.onrender.com/docs), detallada en [`simulator-api/README.md`](../simulator-api/README.md)), se indica con `baseUrl`:
```typescript
const sdkSimulador = new KitPagos({
  gateway: Gateway.WOMPI,
  baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/wompi",
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_demo",
      privateKey: "prv_test_demo",
    },
  },
});
```

**Para procesar pagos reales en producción o pruebas en sandbox**, basta con configurar `environment`:

```typescript
import { KitPagos, Gateway } from "kit-pagos-colombia";

const sdkMultiPasarela = new KitPagos({
  gateway: Gateway.WOMPI,
  environment: "production",
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: process.env.WOMPI_PUBLIC_KEY!,
      privateKey: process.env.WOMPI_PRIVATE_KEY!,
    },
    [Gateway.MERCADOPAGO]: {
      publicKey: process.env.MP_PUBLIC_KEY!,
      privateKey: process.env.MP_ACCESS_TOKEN!,
    },
  },
});
```

### 2. Tokenización en Frontend y Cumplimiento PCI-DSS
Por regulaciones bancarias internacionales (PCI-DSS) y de la Superintendencia Financiera de Colombia (SFC), **un servidor backend nunca debe recibir datos sensibles de tarjetas (número de 16 dígitos, fecha de expiración o CVV) en texto plano**, a menos que cuente con certificación PCI-DSS Nivel 1.

Por esta razón, el SDK opera como un backend seguro que consume **tokens**:
1. **En el Navegador (Frontend):** El usuario ingresa su tarjeta en un formulario web que utiliza la librería de tokenización oficial de la pasarela activa (ej. Wompi Widget/JS, Mercado Pago CardForm/SDK, Kushki.js o Rapyd Collect).
2. **Generación del Token:** La pasarela valida la tarjeta directamente desde el navegador y devuelve un token temporal (ej. `tok_test_card_12345`).
3. **Procesamiento en Backend:** Su frontend envía ese token a su servidor Node.js, donde `KitPagos` ejecuta el cobro de forma segura mediante `PaymentMethod.card(token, { installments })`.

---

## Licencia

Este proyecto está bajo la Licencia [Apache 2.0](LICENSE). Puede usarlo, modificarlo y distribuirlo libremente en proyectos comerciales y de código abierto.

---

Desarrollado con ❤️ para el ecosistema fintech colombiano por **Puros Brothers (Grupo 22)**.
