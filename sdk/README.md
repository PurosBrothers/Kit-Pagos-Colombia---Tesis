# Kit Pagos Colombia

[![npm version](https://img.shields.io/npm/v/kit-pagos-colombia.svg?color=blue)](https://www.npmjs.com/package/kit-pagos-colombia)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

**Kit Pagos Colombia** es un SDK unificado en TypeScript para la integración de pasarelas de pago en Colombia (**Wompi**, **Mercado Pago**, **Kushki** y **Rapyd**).

Diseñado bajo los principios de **Arquitectura Hexagonal (Ports & Adapters)** y **Domain-Driven Design (DDD)**, permite a comercios y desarrolladores desacoplar por completo su lógica de negocio de los detalles propietarios de cada pasarela, habilitando la intercambiabilidad de pasarelas mediante configuración pura, sin modificar el código de la aplicación.

---

## Características Principales

- **Intercambiabilidad real sin *vendor lock-in*:** Cambia de proveedor de pagos (ej. de Wompi a Mercado Pago o Kushki) modificando únicamente el archivo de configuración.
- **Tipado estricto de extremo a extremo:** Contratos, entidades, objetos de valor y enumeraciones en TypeScript con declaraciones `.d.ts` completas.
- **Aritmética financiera exacta:** Manejo de montos mediante el objeto de valor `Amount` (con respaldo de `big.js`), previniendo errores de redondeo de punto flotante IEEE 754 y calculando unidades menores según ISO 4217 (`COP`).
- **Verificación criptográfica de Webhooks:** Validación de firmas nativas (HMAC-SHA256, SHA-256) con comparación en tiempo constante (`crypto.timingSafeEqual`) y **protección contra ataques de repetición (*anti-replay attacks*)** con ventana de tolerancia temporal configurable.
- **Gestión de fallos y resiliencia:** Política de reintentos automáticos con retroceso exponencial (*exponential backoff*) y fluctuación (*jitter*) ante fallos de red transitorios, aislando errores permanentes de negocio.
- **Seguridad y privacidad por diseño (RF-08):** Sanitización automática de llaves privadas, tokens `Bearer` y secretos en mensajes de error y registros para evitar filtraciones en logs de producción.

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
> acusar a tus credenciales. No te quedás sin el dato: el estado ya viene resuelto en la
> respuesta de `createPayment()`, y los cambios posteriores llegan por webhook.

---

## Instalación

Instala el paquete en tu proyecto con tu gestor de paquetes preferido:

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

Configura las credenciales de tus pasarelas e indica cuál es la pasarela activa:

```typescript
import { KitPagos, Gateway } from "kit-pagos-colombia";

const sdk = new KitPagos({
  gateway: Gateway.WOMPI, // Pasarela activa seleccionada
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: process.env.WOMPI_PUBLIC_KEY!,
      privateKey: process.env.WOMPI_PRIVATE_KEY!,
      integritySecret: process.env.WOMPI_INTEGRITY_SECRET, // Firma los cobros que creás
      webhookSecret: process.env.WOMPI_EVENTS_SECRET,      // Verifica los webhooks que recibís
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
      publicKey: process.env.RAPYD_ACCESS_KEY!,
      privateKey: process.env.RAPYD_SECRET_KEY!,
      // Rapyd es la única que firma sus webhooks con la misma llave de la API,
      // así que acá `webhookSecret` no hace falta.
    },
  },
  maxRetries: 3,                 // Reintentos automáticos ante fallos transitorios
  webhookToleranceSeconds: 300,  // Tolerancia de 5 minutos contra ataques de replay
  baseUrl: process.env.PAYMENT_GATEWAY_URL, // Opcional: URL productiva (ver tabla de URLs abajo)
});
```

> **Entornos y URLs Base (`baseUrl`).** Por defecto, el SDK apunta al simulador integrado (`http://localhost:3000/v1/sim/{gateway}`) para permitir desarrollo, pruebas y evaluación sin costo ni credenciales reales. **Para conectar a producción y procesar pagos reales**, es indispensable configurar el parámetro `baseUrl` (como cadena global o como diccionario mapeando cada pasarela a su URL productiva).

> **`webhookSecret` no es la llave de API.** En Wompi, Mercado Pago y Kushki el secreto que
> firma los webhooks es un valor distinto, que se saca de otra parte del panel. Si lo omitís,
> el SDK cae a `privateKey` por compatibilidad y **la verificación de webhooks reales de esas
> tres va a fallar**, con un error de firma inválida que parece un ataque y es configuración.
> En Wompi, además, `integritySecret` y `webhookSecret` son dos secretos distintos: el primero
> firma lo que mandás, el segundo verifica lo que te llega.

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
    // trata como cadena opaca: el número de la tarjeta nunca llega a tu servidor, que es
    // lo que te mantiene fuera del alcance de PCI DSS.
    paymentMethod: PaymentMethod.card("tok_test_card_12345", { installments: 1 }),
  });

  // El resultado es una unión discriminada por `outcome`: el campo `transaction` no
  // existe hasta que descartás el caso de redirección, así que olvidarla no compila.
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

> Con tarjeta también podés recibir `REDIRECT_REQUIRED`: Rapyd cobra en su página alojada, y
> cualquiera de las cuatro puede pedir autenticación 3DS. Tratá las dos ramas siempre.

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
      // corta antes de la llamada de red en vez de traducirte un HTTP 400.
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
    // Redirige al pagador a la URL de su banco
    console.log(`Redirigir a: ${result.redirect.redirectUrl}`);
    // Guardá este identificador: es con lo que consultás el pago si el pagador no vuelve.
    console.log(`ID Pasarela: ${result.redirect.gatewayTransactionId.value}`);
  }
}
```

> Los `bankCode` salen de `sdk.getPseBanks()` y **solo valen en la pasarela que los dio**:
> cambiar de pasarela obliga a volver a pedir la lista. Es la consecuencia de que cada una
> identifique los bancos a su manera; lo que el SDK garantiza es que no tengas que saber cómo.

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

**Webhooks de una pasarela que no es la activa.** Durante una migración cobrás por la pasarela
nueva y seguís recibiendo webhooks de la vieja por semanas: pagos ya iniciados, conciliaciones,
reembolsos. Pasale la pasarela emisora y no necesitás un segundo `KitPagos`; alcanza con que
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

> Si tu servidor tiene el reloj desfasado, la protección anti-replay va a rechazar webhooks
> legítimos con `WEBHOOK_SIGNATURE_INVALID`. Podés ampliar la ventana con `toleranceSeconds`,
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

---

## Catálogo de Códigos de Error (`KitPagosErrorCode`)

- `INVALID_CREDENTIALS`: Fallo de autenticación HTTP 401/403.
- `CONNECTION_FAILED`: Imposibilidad de conectar con el servidor de la pasarela.
- `GATEWAY_TIMEOUT`: Agotamiento del tiempo de espera de la petición.
- `RATE_LIMIT_EXCEEDED`: Límite de tasa de solicitudes superado (HTTP 429).
- `INVALID_REQUEST`: Parámetros de cobro malformados o rechazados por validación (HTTP 400/422).
- `RESOURCE_NOT_FOUND`: Transacción u orden no encontrada (HTTP 404).
- `GATEWAY_SERVER_ERROR`: Error interno en los servidores de la pasarela (HTTP 5xx).
- `MALFORMED_RESPONSE`: Respuesta o webhook no interpretable como JSON válido.
- `WEBHOOK_SIGNATURE_INVALID`: Firma digital de webhook inválida o timestamp caducado.
- `UNSUPPORTED_OPERATION`: Método o flujo no soportado por la pasarela seleccionada (por ejemplo, consultar un cobro con tarjeta en Kushki).
- `MAX_RETRIES_EXCEEDED`: Se agotaron los reintentos configurados sin obtener respuesta.
- `UNKNOWN_ERROR`: Error genérico no tipificado.

---

## 🚀 Despliegue a Producción y Consideraciones Reales

Si vas a utilizar este SDK en un entorno de producción para procesar pagos reales con dinero de verdad, ten en cuenta las siguientes consideraciones de arquitectura y normativa financiera:

### 1. URLs Base: Producción vs. Simulador Integrado
Por diseño de la arquitectura para soportar desarrollo ágil y evaluación académica (RF-09), el SDK incluye integración nativa con el componente `api-simulator`. Si omites `baseUrl`, el SDK apunta por defecto a `http://localhost:3000/v1/sim/{gateway}`, permitiendo probar todo el flujo de cobros y webhooks de forma determinista y sin costo.

**Para procesar pagos reales en producción**, es indispensable configurar el parámetro `baseUrl` apuntando al endpoint oficial productivo de la pasarela activa:

| Pasarela | Endpoint de Producción (Pagos Reales) |
|---|---|
| **Wompi** | `https://production.wompi.co/v1` |
| **Mercado Pago** | `https://api.mercadopago.com/v1` |
| **Kushki** | `https://api.kushkipagos.com` |
| **Rapyd** | `https://api.rapyd.net/v1` |

Puedes configurar `baseUrl` como una URL global (`string`) o como un diccionario para soportar múltiples pasarelas en el mismo servidor:

```typescript
import { KitPagos, Gateway } from "kit-pagos-colombia";

const sdkMultiPasarela = new KitPagos({
  gateway: Gateway.WOMPI,
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
  baseUrl: {
    [Gateway.WOMPI]: "https://production.wompi.co/v1",
    [Gateway.MERCADOPAGO]: "https://api.mercadopago.com/v1",
  },
});
```

### 2. Tokenización en Frontend y Cumplimiento PCI-DSS
Por regulaciones bancarias internacionales (PCI-DSS) y de la Superintendencia Financiera de Colombia (SFC), **un servidor backend nunca debe recibir datos sensibles de tarjetas (número de 16 dígitos, fecha de expiración o CVV) en texto plano**, a menos que cuente con certificación PCI-DSS Nivel 1.

Por esta razón, el SDK opera como un backend seguro que consume **tokens**:
1. **En el Navegador (Frontend):** El usuario ingresa su tarjeta en un formulario web que utiliza la librería de tokenización oficial de la pasarela activa (ej. Wompi Widget/JS, Mercado Pago CardForm/SDK, Kushki.js o Rapyd Collect).
2. **Generación del Token:** La pasarela valida la tarjeta directamente desde el navegador y devuelve un token temporal (ej. `tok_test_card_12345`).
3. **Procesamiento en Backend:** Tu frontend envía ese token a tu servidor Node.js, donde `KitPagos` ejecuta el cobro de forma segura mediante `PaymentMethod.card(token, { installments })`.

---

## Licencia

Este proyecto está bajo la Licencia [Apache 2.0](LICENSE). Puedes usarlo, modificarlo y distribuirlo libremente en proyectos comerciales y de código abierto.

---

Desarrollado con ❤️ para el ecosistema fintech colombiano por **Puros Brothers (Grupo 22)**.
