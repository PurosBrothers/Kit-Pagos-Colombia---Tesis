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
| **Kushki** | ✅ | ✅ | ✅ | ✅ |
| **Rapyd** | ✅ | ✅ | ✅ | ✅ |

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
      integritySecret: process.env.WOMPI_INTEGRITY_SECRET,
    },
    [Gateway.MERCADOPAGO]: {
      publicKey: process.env.MP_PUBLIC_KEY!,
      privateKey: process.env.MP_ACCESS_TOKEN!,
    },
    [Gateway.KUSHKI]: {
      publicKey: process.env.KUSHKI_PUBLIC_ID!,
      privateKey: process.env.KUSHKI_PRIVATE_ID!,
    },
    [Gateway.RAPYD]: {
      publicKey: process.env.RAPYD_ACCESS_KEY!,
      privateKey: process.env.RAPYD_SECRET_KEY!,
    },
  },
  maxRetries: 3,                 // Reintentos automáticos ante fallos transitorios
  webhookToleranceSeconds: 300,  // Tolerancia de 5 minutos contra ataques de replay
});
```

---

### 2. Crear una Transacción con Tarjeta

```typescript
import { Amount, Currency, PaymentMethod } from "kit-pagos-colombia";

async function cobrarConTarjeta() {
  const result = await sdk.createPayment({
    amount: new Amount("75000"), // $75.000 COP
    currency: new Currency("COP"),
    orderReference: "ORD-2026-0901",
    payerEmail: "cliente@ejemplo.com",
    paymentMethod: PaymentMethod.card({
      token: "tok_test_card_12345",
      installments: 1,
    }),
  });

  if (result.type === "TRANSACTION") {
    const tx = result.transaction;
    console.log(`Estado: ${tx.getStatus()}`); // APPROVED, DECLINED, PENDING...
    console.log(`ID Pasarela: ${tx.gatewayTransactionId.value}`);
  }
}
```

---

### 3. Crear una Transacción con PSE (Redirección Bancaria)

```typescript
import { Amount, Currency, PaymentMethod, ReturnUrlConfig } from "kit-pagos-colombia";

async function pagarConPSE() {
  const result = await sdk.createPayment({
    amount: new Amount("150000"),
    currency: new Currency("COP"),
    orderReference: "ORD-PSE-8841",
    payerEmail: "comprador@banco.com",
    paymentMethod: PaymentMethod.pse({
      bankCode: "1022", // Código ACH del banco
      userType: "0",    // 0: Persona natural, 1: Jurídica
      userLegalIdType: "CC",
      userLegalId: "1234567890",
    }),
    returnUrlConfig: new ReturnUrlConfig("https://mitienda.com/checkout/resultado"),
  });

  if (result.type === "REDIRECT_REQUIRED") {
    // Redirige al pagador a la URL de su banco
    console.log(`Redirigir a: ${result.redirectUrl}`);
  }
}
```

---

### 4. Consultar Estado de una Transacción

```typescript
async function verificarEstado(transactionId: string) {
  const transaction = await sdk.getPaymentStatus(transactionId);

  if (transaction.isApproved()) {
    console.log("¡Pago aprobado exitosamente!");
  } else if (transaction.getStatus() === "DECLINED") {
    console.log(`Pago rechazado: ${transaction.rejectionReason?.message}`);
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

---

### 6. Manejo Unificado de Errores

Todos los fallos técnicos se transforman en instancias de `KitPagosError` con códigos homogéneos:

```typescript
import { KitPagosError, KitPagosErrorCode } from "kit-pagos-colombia";

try {
  await sdk.createPayment({ /* ... */ });
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
- `UNSUPPORTED_OPERATION`: Método o flujo no soportado por la pasarela seleccionada.
- `UNKNOWN_ERROR`: Error genérico no tipificado.

---

## Licencia

Este proyecto está bajo la Licencia [Apache 2.0](LICENSE). Puedes usarlo, modificarlo y distribuirlo libremente en proyectos comerciales y de código abierto.

---

Desarrollado con ❤️ para el ecosistema fintech colombiano por **Puros Brothers (Grupo 22)**.
