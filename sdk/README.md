# Kit Pagos Colombia

[![npm version](https://img.shields.io/npm/v/kit-pagos-colombia.svg?color=blue)](https://www.npmjs.com/package/kit-pagos-colombia)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

**Kit Pagos Colombia** es un SDK unificado en TypeScript para la integración de pasarelas de pago en Colombia (**Wompi**, **Mercado Pago**, **Kushki** y **Rapyd**).

Está construido con **arquitectura hexagonal (puertos y adaptadores)**: el dominio no conoce HTTP ni pasarelas, y cada pasarela es un adaptador. Para el comercio, cambiar de pasarela es cambiar `gateway` y sus credenciales, y el código del cobro, de la consulta y del webhook queda igual. Lo que no se puede unificar está en [Lo que el SDK no hace](#lo-que-el-sdk-no-hace).

---

## Características Principales

- **Una sola interfaz para las cuatro pasarelas:** `createPayment()`, `getPaymentStatus()`, `getPseBanks()` y `validateWebhook()`, con los mismos tipos en Wompi, Mercado Pago, Kushki y Rapyd.
- **Tipado estricto:** contratos, entidades, objetos de valor y enumeraciones en TypeScript, con sus declaraciones `.d.ts`. El resultado de un cobro es una unión que obliga a tratar la redirección.
- **Montos exactos:** el objeto de valor `Amount` usa `big.js`, sin los errores de redondeo del punto flotante, y calcula las unidades menores según ISO 4217. Cada adaptador manda el monto en la unidad que pide su pasarela: centavos en Wompi y pesos en Mercado Pago.
- **Verificación de webhooks:** la firma nativa de cada pasarela (HMAC-SHA256 o SHA-256), comparada en tiempo constante (`crypto.timingSafeEqual`), y una ventana de tolerancia contra la repetición de notificaciones viejas, configurable.
- **Reintentos solo donde no hay riesgo:** `getPaymentStatus()` y `getPseBanks()` se reintentan ante fallos transitorios, con retroceso exponencial y fluctuación. `createPayment()` nunca se reintenta, para no cobrar dos veces.
- **Sin credenciales en los errores (RF-08):** las llaves configuradas, los tokens `Bearer` y los secretos se borran del mensaje y del cuerpo de cada `KitPagosError`, para que no terminen en sus registros.
- **Tokenización en el navegador (`kit-pagos-colombia/browser`):** un módulo sin dependencias de Node.js (21 955 bytes sin minificar y 5,3 KB con gzip en la 0.6.0) que tokeniza la tarjeta contra Wompi, Mercado Pago y Kushki. El número de la tarjeta no pasa por su servidor; la página donde se escribe sí hay que protegerla (ver [Despliegue a producción](#despliegue-a-producción-y-consideraciones-reales), §2).

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

## Lo que el SDK no hace

- **Los tokens de tarjeta no son portables.** Se emiten contra la pasarela que va a cobrar, así que cambiar de pasarela cambia también la tokenización del navegador.
- **Cada pasarela pide sus datos, y el SDK no los inventa.** Por ejemplo, Mercado Pago exige para PSE nombre y apellido separados, teléfono con indicativo, dirección e IP del pagador. Si falta un dato, el SDK lo dice antes de salir a la red, con `INVALID_REQUEST` y la lista de lo que falta.
- **La redirección no desaparece.**
  - Con PSE redirigen las cuatro.
  - Con tarjeta, Rapyd cobra en su página alojada, y Wompi y Kushki pueden pedir 3DS.
  - El resultado de `createPayment()` obliga a tratar las dos ramas.
- **Solo tarjeta y PSE.** No hay efectivo, ni Nequi, ni suscripciones, ni reembolsos.
- **No protege la página de pago ni decide el monto.** La cabecera Content-Security-Policy de la página donde se escribe la tarjeta la manda su servidor, y el monto lo calcula su servidor con su catálogo: el SDK cobra lo que se le pide. Está explicado en [Despliegue a producción](#despliegue-a-producción-y-consideraciones-reales), §2.

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

- **Paso 1:** [Inicializar el SDK](#1-inicializar-el-sdk)
- **Paso 2:** [Crear una Transacción con Tarjeta](#2-crear-una-transacción-con-tarjeta)
  - 🌐 **Frontend:** [Tokenización en el Navegador con `kit-pagos-colombia/browser`](#21-tokenización-en-el-navegador-kit-pagos-colombiabrowser)
- **Paso 3:** [Crear una Transacción con PSE](#3-crear-una-transacción-con-pse-redirección-bancaria)
- **Paso 4:** [Consultar Estado de una Transacción](#4-consultar-estado-de-una-transacción)
- **Paso 5:** [Validar y Conciliar Webhooks](#5-validar-y-conciliar-webhooks)
- **Paso 6:** [Manejo Unificado de Errores](#6-manejo-unificado-de-errores)

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
      publicKey: process.env.MERCADOPAGO_PUBLIC_KEY!,
      privateKey: process.env.MERCADOPAGO_ACCESS_TOKEN!,
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    },
    [Gateway.KUSHKI]: {
      publicKey: process.env.KUSHKI_PUBLIC_MERCHANT_ID!,
      privateKey: process.env.KUSHKI_PRIVATE_MERCHANT_ID!,
      webhookSecret: process.env.KUSHKI_WEBHOOK_SECRET,
    },
    [Gateway.RAPYD]: {
      publicKey: process.env.RAPYD_API_ACCESS_KEY!,
      privateKey: process.env.RAPYD_API_SECRET_KEY!,
      // Rapyd firma sus webhooks con la misma llave de la API, así que no lleva
      // `webhookSecret`; sí lleva la URL del webhook tal como está en su panel.
      webhookUrl: "https://mitienda.com/webhooks/rapyd",
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

> **Entornos y Resolución Automática de URLs (`environment`).** Puede especificar el entorno destino mediante la opción `environment: "simulator" | "sandbox" | "production"`. El SDK resuelve automáticamente la URL oficial de cada pasarela desde un catálogo cerrado integrado. Por defecto el ambiente es `simulator` y apunta al simulador local (`http://localhost:3000/v1/sim/{gateway}`); para usar el simulador desplegado en Render, indíquelo con `baseUrl` (ver «El simulador de Render» más abajo, con lo que se puede cobrar ahí). Si necesita apuntar a una URL específica o mock propio, el parámetro `baseUrl` sigue disponible como anulación explícita.

> **`webhookSecret` no es la llave de API.** En Wompi, Mercado Pago y Kushki el secreto que
> firma los webhooks es un valor distinto, que se saca de otra parte del panel. Si lo omite,
> el SDK cae a `privateKey` por compatibilidad y **la verificación de webhooks reales de esas
> tres va a fallar**, con un error de firma inválida que parece un ataque y es configuración.
> En Wompi, además, `integritySecret` y `webhookSecret` son dos secretos distintos: el primero
> firma lo que envía, el segundo verifica lo que le llega. Sin `integritySecret`, `createPayment()`
> en Wompi falla con `INVALID_CREDENTIALS` antes de salir a la red, porque Wompi no crea ninguna
> transacción sin firma.
>
> Los nombres de las variables son los de `.env.example` en la raíz del repositorio.

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
    // El token lo emite la pasarela al tokenizar en el navegador, y el SDK lo trata como
    // cadena opaca: el número de la tarjeta nunca llega a su servidor.
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
> Wompi y Kushki pueden pedir autenticación 3DS. Mercado Pago no redirige con tarjeta (ver la
> nota siguiente). Trate siempre las dos ramas.
>
> El monto del cobro lo calcula su servidor con los precios de su catálogo, nunca el navegador:
> el SDK cobra lo que se le pide (ver [Despliegue a producción](#despliegue-a-producción-y-consideraciones-reales), §2).

> **Mercado Pago cobra la tarjeta por la Orders API desde la versión 0.6.0.** Hasta la 0.5.0
> usaba la Payments API (`POST /v1/payments`), que con las credenciales `APP_USR-` del vendedor
> de prueba de una aplicación «Checkout API via Orders» responde `401 "Unauthorized use of live
> credentials"` (medido el 15 de octubre de 2026). Ahora tarjeta y PSE usan la misma pareja de
> credenciales y la misma API, sin cambios en su código: `PaymentMethod.card(token, {
> installments })` sigue igual. Lo que sí cambia:
>
> - El SDK hace dos lecturas antes de cobrar (`GET /v1/card_tokens/{token}` y
>   `GET /v1/payment_methods/search`) para deducir la marca y el tipo de la tarjeta, que la
>   Orders API exige. Por eso necesita `publicKey` en las credenciales de Mercado Pago.
> - El identificador de la transacción es el de la orden (`ORD…`, o `ORDTST…` con un vendedor
>   de prueba) y no un número. `getPaymentStatus()` sigue consultando los ids numéricos de los
>   pagos creados con versiones anteriores.
> - Un rechazo llega como una transacción `DECLINED` con `rejectionReason` (por ejemplo
>   `insufficient_amount`), igual que en PSE, y no como un error.
> - El monto no admite centavos: `total_amount` solo acepta pesos enteros, así que un monto con
>   decimales distintos de cero falla con `INVALID_REQUEST` antes de cobrar.
> - La respuesta de la orden no trae el email del pagador, así que `transaction.payer.email`
>   lleva un valor de relleno; conserve el email en su propio registro.
> - El cobro con tarjeta de Mercado Pago no devuelve redirección: la orden llega con
>   `transaction_security.validation: "never"` y el SDK no pide 3DS.

#### 2.1 Tokenización en el Navegador (`kit-pagos-colombia/browser`)

Los datos de la tarjeta (número, CVC y vencimiento) **no deben llegar a su servidor**: si llegan, ese servidor entra en el alcance de PCI DSS, aunque los reenvíe de inmediato. Por eso el SDK de servidor no los acepta, y la tarjeta se tokeniza en el navegador.

El paquete exporta un punto de entrada independiente y liviano para el frontend (`kit-pagos-colombia/browser`, unos 22 KB sin minificar y 5,3 KB con gzip, sin módulos de Node.js). Tokeniza con Wompi, Mercado Pago y, desde la 0.6.0-rc.4, Kushki:

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
    docType: "CC",            // El SDK lo exige en Mercado Pago; Wompi y Kushki no lo usan
    docNumber: "19119119100",  // El SDK lo exige en Mercado Pago; Wompi y Kushki no lo usan
  };
  // El monto del cobro, con el mismo formato del pago. Kushki ata el token a él; las otras lo ignoran.
  const monto = "48000.00";

  // 1. Tokenización contra Wompi:
  const wompiResult = await KitPagosBrowser.tokenizeCard({
    gateway: Gateway.WOMPI,
    publicKey: "pub_test_1234567890", // pub_prod_... con environment: "production"
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

  // 3. Tokenización contra Kushki, con su merchant id público y el monto del cobro:
  const kushkiResult = await KitPagosBrowser.tokenizeCard({
    gateway: Gateway.KUSHKI,
    publicKey: "kushki-public-merchant-id",
    environment: "sandbox",
    card: datosFormulario,
    amount: monto,
  });

  // El token resultante se envía a SU backend para llamar a PaymentMethod.card()
  console.log(`Token Wompi: ${wompiResult.token}`);
  console.log(`Token Mercado Pago: ${mpResult.token}`);
  console.log(`Token Kushki: ${kushkiResult.token}`);
}
```

> **Límite de tiempo de la tokenización (`timeoutMs`).** La petición a la pasarela se corta a
> los `timeoutMs` milisegundos (30 000 por omisión), incluida la lectura de la respuesta, y en
> ese caso `tokenizeCard()` lanza `KitPagosError` con `GATEWAY_TIMEOUT`. Acepta un entero entre
> 1 y 2 147 483 647, igual que `timeoutMs` del SDK de servidor; cualquier otro valor lanza
> `INVALID_REQUEST` antes de enviar la tarjeta. Usa `AbortSignal.timeout`, que el navegador del
> pagador tiene que soportar.

> **Kushki, desde la 0.6.0-rc.4.** Kushki pide el monto al tokenizar (`amount`, obligatorio solo
> con ella) y ata el token a ese valor: cobrar el token por otro monto responde `400 K220` y el SDK
> de servidor lo devuelve como `INVALID_REQUEST`. Cobre exactamente el monto con el que tokenizó.
> La tokenización usa `POST /card/v1/tokens` con el merchant id público en la cabecera
> `Public-Merchant-Id`; su CORS se midió el 17 de octubre de 2026 contra UAT.

> **Lo que cubre y lo que no.** Con `KitPagosBrowser`, el número de la tarjeta viaja solo entre el navegador del pagador y los servidores de la pasarela, y su backend recibe el token opaco. Eso deja su servidor fuera de los datos de la tarjeta, pero **no protege la página donde se escribe**. El formulario es suyo: un script malicioso que corra en esa página podría leer el número antes de que se tokenice, y por eso el comercio queda en SAQ A-EP. Lo que lo limita es una cabecera Content-Security-Policy que manda su servidor (ver [Despliegue a producción](#despliegue-a-producción-y-consideraciones-reales), §2).
>
> Rapyd no tokeniza en el navegador: cobra la tarjeta en su página alojada, así que `KitPagosBrowser` la rechaza con `KitPagosError(UNSUPPORTED_OPERATION)` sin abrir conexiones. Con Rapyd, cree el pago con tarjeta y sin token, y siga la redirección.

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

> Los `code` que devuelve `sdk.getPseBanks()` **solo valen en la pasarela que los dio**:
> cambiar de pasarela obliga a volver a pedir la lista. Si el banco ya se conoce, `PseBankCode`
> (el código de compensación de ACH Colombia, como `PseBankCode.BANCOLOMBIA`) sirve en las cuatro:
> el SDK lo traduce para Rapyd. La excepción son los bancos ficticios de los sandboxes de Wompi y
> Kushki, que solo existen con el código de `getPseBanks()`.

> Contra el sandbox de Rapyd, desde la 0.6.0-rc.3, `getPseBanks()` devuelve solo los bancos que
> esa cuenta puede cobrar. El sandbox lista todos los métodos de la plataforma, y con los demás el
> pago falla con `400 ERROR_GET_GATEWAY`: el 17 de octubre de 2026 cobraban 9 de 50 (Davivienda,
> Bancolombia, Caja Social, AV Villas, Unión, Contactar, Acción Fiduciaria, Ding y PayCash). En
> producción, donde Rapyd lista solo los métodos habilitados, y en el simulador, la lista llega
> completa.

> Un PSE también puede volver como `TRANSACTION`, y por eso conviene tratar las dos ramas. Pasa
> cuando el pago ya tiene desenlace al crearlo: en el sandbox de Wompi la URL del banco llega en
> la misma consulta que `APPROVED`, `DECLINED` o `ERROR`, y Mercado Pago responde `402` cuando la
> orden se crea con el pago fallido. En los dos casos `createPayment()` devuelve la transacción
> normalizada (en Mercado Pago, `DECLINED` con el identificador de la orden) en vez de una
> redirección hacia un pago que ya terminó.
>
> En Mercado Pago, la orden también puede nacer `processing` sin URL del banco: el 15 de octubre
> de 2026, entre las 21:33 y las 21:44, pasó con 12 de 12 órdenes, que unos 4 segundos después
> estaban rechazadas con `processing_error`. Desde la 0.6.0-rc.2, `createPayment()` la devuelve
> como una transacción `PENDING` con el identificador de la orden y `rawStatus` `processing`, en
> vez de fallar con `MALFORMED_RESPONSE`. Consulte su estado con `getPaymentStatus()` para
> conocer el desenlace: esas órdenes terminaron en `failed / processing_error`, que el SDK
> entrega como `DECLINED` con `rejectionCode` `processing_error`. En el sandbox esto pasa por
> ventanas, y se recupera solo con la misma aplicación: el 19 de octubre de 2026 falló entre las
> 14:09 y las 14:17, y desde las 14:25 volvió a entregar la URL del banco. Si le pasa, espere
> entre 10 y 15 minutos y vuelva a intentar, sin crear una aplicación nueva.

> Mercado Pago exige además `ipAddress`, la IP del pagador. Desde la versión 0.6.0 el SDK la
> normaliza antes de enviarla: quita los espacios, convierte `::ffff:a.b.c.d` en `a.b.c.d` y
> `::1` en `127.0.0.1`, que son las formas en que Node entrega `req.ip` en un servidor que
> escucha en `::` y que Mercado Pago rechaza con `400` (medido el 15 de octubre de 2026). Las
> demás direcciones pasan tal cual, y una IP en blanco cuenta como faltante.

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
(`CONNECTION_FAILED`, `GATEWAY_TIMEOUT`, `GATEWAY_SERVER_ERROR`, `RATE_LIMIT_EXCEEDED`,
`RESOURCE_LOCKED`), hasta
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

> **El mensaje de un error HTTP trae el código y el motivo de la pasarela**, desde la
> 0.6.0-rc.5: `Kushki gateway returned an HTTP error status 400 (K220: Monto de la transacción
> es diferente al monto de la venta inicial)`. Para decidir, use `error.code`, que sigue siendo
> el normalizado (`INVALID_REQUEST` en ese caso); el mensaje es para leerlo, y pasa por la misma
> limpieza de credenciales que el resto del error. El cuerpo completo está en `originalPayload`.

> **`createPayment()` no se reintenta**, ni siquiera ante `GATEWAY_TIMEOUT`. Que la respuesta
> no haya llegado a tiempo no prueba que la pasarela no haya creado el cobro, y repetirlo podría
> cobrar dos veces. Antes de volver a cobrar, confirme el estado con `getPaymentStatus()` o
> espere el webhook.
>
> La pasarela tampoco lo evita por usted. Medido en Mercado Pago el 15 de octubre de 2026: dos
> cobros con la misma `orderReference` crearon dos órdenes y se cobraron los dos, con tarjeta y
> con PSE. El SDK manda una llave de idempotencia nueva en cada llamada, a propósito: con la
> misma llave, Mercado Pago responde una copia del primer resultado, y reintentar un rechazo con
> otra tarjeta daría `409` (`INVALID_REQUEST`).

---

## Catálogo de Códigos de Error (`KitPagosErrorCode`)

- `INVALID_CREDENTIALS`: Fallo de autenticación HTTP 401/403.
- `CONNECTION_FAILED`: Imposibilidad de conectar con el servidor de la pasarela.
- `GATEWAY_TIMEOUT`: La pasarela no respondió dentro de `timeoutMs`, o respondió HTTP 408.
- `RATE_LIMIT_EXCEEDED`: Límite de tasa de solicitudes superado (HTTP 429).
- `INVALID_REQUEST`: Parámetros de cobro malformados o rechazados por validación (HTTP 400/409/422).
- `RESOURCE_NOT_FOUND`: Transacción u orden no encontrada (HTTP 404).
- `RESOURCE_LOCKED`: La pasarela está procesando otra petición con la misma llave (HTTP 423, medido en la Orders API de Mercado Pago). Es transitorio: se reintenta solo en `getPaymentStatus()` y `getPseBanks()`.
- `GATEWAY_SERVER_ERROR`: Error interno en los servidores de la pasarela (HTTP 5xx).
- `MALFORMED_RESPONSE`: Respuesta o webhook no interpretable como JSON válido.
- `WEBHOOK_SIGNATURE_INVALID`: Firma digital de webhook inválida o timestamp caducado.
- `UNSUPPORTED_OPERATION`: Método o flujo no soportado por la pasarela seleccionada (por ejemplo, consultar un cobro con tarjeta en Kushki).
- `MAX_RETRIES_EXCEEDED`: Un fallo transitorio persistió en todos los intentos de `getPaymentStatus()` o `getPseBanks()`. El último error viaja en `cause`.
- `UNKNOWN_ERROR`: Error genérico no tipificado.

---

## Despliegue a Producción y Consideraciones Reales

Si va a utilizar este SDK en un entorno de producción para procesar pagos reales con dinero de verdad, tenga en cuenta las siguientes consideraciones de arquitectura y normativa financiera:

### 1. Resolución de Entornos y URLs Oficiales

El SDK incluye un catálogo cerrado de URLs para los tres ambientes soportados, evitando tener que configurar manualmente las direcciones de cada proveedor:

| Pasarela | Sandbox (`environment: "sandbox"`) | Producción (`environment: "production"`) |
|---|---|---|
| **Wompi** | `https://sandbox.wompi.co/v1` | `https://production.wompi.co/v1` |
| **Mercado Pago** | `https://api.mercadopago.com/v1` | `https://api.mercadopago.com/v1` |
| **Kushki** | `https://api-uat.kushkipagos.com` | `https://api.kushkipagos.com` |
| **Rapyd** | `https://sandboxapi.rapyd.net/v1` | `https://api.rapyd.net/v1` |

**El simulador (`environment: "simulator"`).** Es el ambiente por omisión, y apunta a la API de Simulación local (`http://localhost:3000/v1/sim/{gateway}`), para que ninguna petición salga de la máquina sin pedirlo. El simulador verifica las firmas de Wompi y Rapyd. Si corre sin perfil (sin `.env`), usa los secretos por omisión `test_integrity_kit_pagos_simulator` (el de integridad de Wompi) y `rapyd_secret_kit_pagos_simulator` (punto 86 del `architecture-log.md`):

```typescript
const sdkSimulador = new KitPagos({
  gateway: Gateway.WOMPI,
  environment: "simulator", // http://localhost:3000/v1/sim/wompi
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_demo",
      privateKey: "prv_test_demo",
      integritySecret: "test_integrity_kit_pagos_simulator", // el del simulador sin perfil
    },
  },
});
```

Medido el 19 de octubre de 2026 contra un simulador sin perfil: con ese secreto, un PSE de Wompi se creó (`REDIRECT_REQUIRED`) y la consulta dio `APPROVED`. Con otro secreto, el simulador respondió `422` «La firma es inválida», como Wompi.

**El simulador de Render** (con su documentación OpenAPI 3.0 en [`/docs`](https://kit-pagos-colombia.onrender.com/docs), detallada en [`simulator-api/README.md`](../simulator-api/README.md)) se usa con `baseUrl`, por ejemplo `https://kit-pagos-colombia.onrender.com/v1/sim/kushki`. Ese despliegue verifica las firmas de Wompi y Rapyd con los secretos del equipo, así que desde su código solo cobran Mercado Pago y Kushki con llaves de demostración. Medido el 19 de octubre de 2026:

- Kushki y Mercado Pago listaron bancos y crearon un PSE (`REDIRECT_REQUIRED`).
- Wompi, sin `integritySecret`, falló con `INVALID_CREDENTIALS` antes de la red.
- Wompi, con el secreto por omisión, recibió `422` «La firma es inválida».

Para Wompi y Rapyd, use el simulador local o la API REST `/v1/api` de ese mismo despliegue, que firma en el servidor.

**Sandbox y producción.** `environment` elige las URL del catálogo, pero no es lo único que cambia al cobrar de verdad:

```typescript
import { KitPagos, Gateway } from "kit-pagos-colombia";

const sdkProduccion = new KitPagos({
  gateway: Gateway.WOMPI,
  environment: "production",
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: process.env.WOMPI_PUBLIC_KEY!,
      privateKey: process.env.WOMPI_PRIVATE_KEY!,
      integritySecret: process.env.WOMPI_INTEGRITY_SECRET!, // Sin él, Wompi no crea transacciones
      webhookSecret: process.env.WOMPI_EVENTS_SECRET!,
    },
    [Gateway.MERCADOPAGO]: {
      publicKey: process.env.MERCADOPAGO_PUBLIC_KEY!,
      privateKey: process.env.MERCADOPAGO_ACCESS_TOKEN!,
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET!,
    },
  },
});
```

Al pasar a producción también hay que hacer esto:

- usar las llaves productivas, incluidos los secretos de webhook, que son distintos por ambiente;
- registrar las URL de webhook en el panel de cada pasarela y comprobar que lleguen;
- sincronizar el reloj del servidor, porque la ventana contra la repetición de webhooks depende de él;
- cumplir lo del punto 2.

La lista completa está en la [guía de implementación](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/blob/main/docs/03-sdk/4-guia-de-implementacion.md), §9 y §10.

### 2. La tarjeta, la página de pago y el monto

**El número de la tarjeta no debe llegar a su servidor.** Si llega, ese servidor entra en el alcance de PCI DSS, aunque lo reenvíe de inmediato a la pasarela. El SDK de servidor no lo acepta: `PaymentMethod.card()` recibe un token.

1. **En el navegador:** el pagador escribe la tarjeta en un formulario que la tokeniza con `KitPagosBrowser` (Wompi, Mercado Pago y Kushki) o con la librería oficial de la pasarela. Con Rapyd no hay token: el pago se crea sin él y el pagador escribe la tarjeta en la página alojada de Rapyd.
2. **El token:** la pasarela recibe la tarjeta directamente desde el navegador y devuelve un token (por ejemplo, `tok_test_…` en Wompi).
3. **En su servidor:** el frontend le manda el token, y `KitPagos` cobra con `PaymentMethod.card(token, { installments })`.

**La página donde se escribe la tarjeta sí queda en el alcance.**

- **El riesgo.** Con `KitPagosBrowser` el formulario es suyo, y el comercio queda en SAQ A-EP. Un script malicioso en esa página podría leer el número antes de que se tokenice y mandarlo a otro dominio. Puede llegar por un XSS, en una dependencia comprometida o en un archivo que cambió en un CDN.
- **La defensa.** Lo que lo limita es una cabecera `Content-Security-Policy` que manda su servidor, con `connect-src` limitado a su API y al host de tokenización de cada pasarela que use:
  - Wompi: `sandbox.wompi.co` o `production.wompi.co`;
  - Mercado Pago: `api.mercadopago.com`;
  - Kushki: `api-uat.kushkipagos.com` o `api.kushkipagos.com`.
- **Lo medido** (19 de octubre de 2026, Chrome 148, con la 0.6.0 desde jsDelivr). Con esa política, las tres tokenizaron y un envío a otro dominio quedó bloqueado.
- **Si carga el módulo con integridad desde un import map,** la CSP tiene que llevar el hash de ese import map. Sin él, el navegador bloquea el mapa y carga el módulo sin verificar su integridad, sin ningún error en la página.
- **La política completa y lo que no cierra** están en la [guía de implementación](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/blob/main/docs/03-sdk/4-guia-de-implementacion.md), §9. Si necesita que el número nunca entre a su página (SAQ A), use los campos alojados de la pasarela en iframes: `KitPagosBrowser` no los envuelve.

**El monto lo decide su servidor.**

- **El problema.** El SDK cobra el monto que se le pide, y no conoce los precios de su tienda. Si el monto viene del navegador, el pagador lo puede cambiar antes de pagar. La firma de integridad de Wompi solo garantiza que nadie lo cambió después de firmado.
- **Qué hacer.** Calcule el total en el servidor, con su catálogo. Antes de despachar, compare la transacción aprobada con la orden: `transaction.amount.equals(...)`, `currency` y `orderReference`.

Los prototipos del proyecto no mandan esa cabecera, y el que corre solo en el navegador decide el monto en la página. Son demostraciones contra los sandboxes, no plantillas para producción.

---

## Licencia

Este proyecto está bajo la Licencia [Apache 2.0](LICENSE). Puede usarlo, modificarlo y distribuirlo libremente en proyectos comerciales y de código abierto.

---

Desarrollado con ❤️ para el ecosistema fintech colombiano por **Puros Brothers (Grupo 22)**.
