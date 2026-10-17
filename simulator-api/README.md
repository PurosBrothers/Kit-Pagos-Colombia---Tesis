# API de Simulación y Capa REST — Kit Pagos Colombia

[![Fastify](https://img.shields.io/badge/Fastify-5.x-black.svg)](https://fastify.dev/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0.3-green.svg)](https://swagger.io/specification/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

La **API de Simulación** es el segundo componente del artefacto de Kit Pagos Colombia. Desarrollada sobre [Fastify](https://fastify.dev/) en TypeScript, cumple dos funciones arquitectónicas desacopladas:

1. **Capa REST de Kit Pagos (`/v1/api`)**: Expone las capacidades del SDK a través de una interfaz HTTP unificada, permitiendo procesar cobros, consultar estados, listar bancos PSE y verificar firmas de webhooks sin necesidad de instalar el paquete npm.
2. **Servidor Mock de Pasarelas (`/v1/sim`)**: Provee 32 rutas simuladas con fidelidad a los contratos de **Wompi**, **Mercado Pago**, **Kushki** y **Rapyd**, permitiendo ejercitar flujos completos (incluyendo escenarios de rechazo, timeout, errores de red y desenlaces de PSE) sin depender de conexión a internet ni incurrir en bloqueos de sandboxes reales.

Servicio desplegado en vivo en Render: [https://kit-pagos-colombia.onrender.com](https://kit-pagos-colombia.onrender.com)

---

## Documentación Interactiva OpenAPI 3.0

El servicio implementa la especificación **OpenAPI 3.0.3** mediante los plugins oficiales `@fastify/swagger` y `@fastify/swagger-ui`. Los esquemas JSON validan estrictamente las peticiones antes de alcanzar los controladores y generan la documentación en tiempo de compilación/arranque sin riesgo de divergencia:

- **Swagger UI interactivo:** [`/docs`](https://kit-pagos-colombia.onrender.com/docs) (o `http://localhost:3000/docs` en local).
- **Especificación OpenAPI en JSON:** [`/docs/json`](https://kit-pagos-colombia.onrender.com/docs/json).

---

## 1. Capa REST de Kit Pagos (`/v1/api`)

Todos los endpoints de la capa REST operan bajo el tag `Kit Pagos` y retornan respuestas normalizadas al vocabulario canónico del dominio (`Transaction`, `TransactionStatus`, `KitPagosError`).

### Autenticación y Cabeceras

- **Token de Aplicación:** Se declara mediante el esquema `bearerAuth` en la cabecera `Authorization: Bearer <token>`.
- **Credenciales Propias (Opcional):** Si el cliente desea utilizar sus propias credenciales de pasarela en lugar de las configuradas en el servidor, puede suministrarlas mediante cabeceras HTTP:
  - `x-gateway-public-key`: Llave pública o ID de cliente.
  - `x-gateway-private-key`: Llave privada, secret key o token de acceso.
  - `x-gateway-integrity-secret`: Secreto de integridad (requerido por Wompi).
  - `x-gateway-webhook-secret`: Secreto para verificación de eventos.
- **Declaración de Entorno:** Mediante la cabecera `x-kit-pagos-environment` (`simulator`, `sandbox` o `production`), el cliente declara el ambiente destino y el servidor resuelve la URL oficial desde un catálogo cerrado sin exponer credenciales a destinos arbitrarios (Issue #123).

### Endpoints Unificados

| Método | Ruta | Propósito | Respuesta Exitosa |
|---|---|---|---|
| `GET` | `/v1/api/gateways` | Catálogo de pasarelas activas en el SDK. Prueba de vida sin llamadas externas. | `200 OK`: `{"gateways": ["wompi", "mercadopago", "kushki", "rapyd"]}` |
| `POST` | `/v1/api/payments` | Creación unificada de cobros con unión discriminada explícita. | `201 Created`: `TRANSACTION` (cobro directo) o `REDIRECT_REQUIRED` (PSE / 3DS con `redirectUrl`) |
| `GET` | `/v1/api/payments/:id` | Consulta de estado canónico de una transacción por ID y pasarela (`?gateway=...`). | `200 OK`: `{"gateway": "...", "transaction": { "status": "APPROVED", ... }}` |
| `GET` | `/v1/api/pse-banks` | Catálogo consolidado de bancos PSE con código nativo y código ACH unificado. | `200 OK`: `{"pseBanks": [{ "gateway": "...", "banks": [...] }]}` |
| `POST` | `/v1/api/webhooks/:gateway` | Verificación de firma criptográfica byte a byte y normalización de eventos. | `200 OK`: `{"gateway": "...", "eventType": "...", "newStatus": "..."}` |

### Códigos de Error Canónicos (`KitPagosErrorCode`)

Las peticiones no conformes o fallidas responden con un payload estructurado:

```json
{
  "code": "INVALID_REQUEST",
  "message": "Parámetro requerido ausente o inválido"
}
```

Mapeo formal a códigos de estado HTTP según el estándar del proyecto (RF-08), definido en `src/kit-pagos-api/errors/kitPagosErrorResponse.ts`:
- `INVALID_REQUEST` / `UNSUPPORTED_OPERATION` → `400 Bad Request` (también cuando el cuerpo no cumple el esquema)
- `INVALID_CREDENTIALS` / `WEBHOOK_SIGNATURE_INVALID` → `401 Unauthorized`
- `RESOURCE_NOT_FOUND` → `404 Not Found`
- `RESOURCE_LOCKED` → `423 Locked`
- `RATE_LIMIT_EXCEEDED` → `429 Too Many Requests`
- `CONNECTION_FAILED` / `GATEWAY_SERVER_ERROR` / `MALFORMED_RESPONSE` / `MAX_RETRIES_EXCEEDED` → `502 Bad Gateway`
- `GATEWAY_TIMEOUT` → `504 Gateway Timeout`
- `UNKNOWN_ERROR` → `500 Internal Server Error`

Un token de la API ausente o inválido, o una pasarela sin credenciales, responde `401` con `{ "error": "Unauthorized", "message": "…" }`, sin `code`.

---

## 2. Servidor Mock de Simulación (`/v1/sim`)

El servidor provee 32 rutas organizadas por pasarela que emulan el comportamiento y formato de carga de cada sandbox oficial, más el disparador de webhooks y `GET /health`. Las rutas se enumeran con su nivel de evidencia en [`docs/02-arquitectura/3-api-de-simulacion.md`](../docs/02-arquitectura/3-api-de-simulacion.md).

### Rutas por Pasarela

- **Wompi (`/v1/sim/wompi`)** — 7:
  - `GET /v1/sim/wompi/merchants/:publicKey` — Consulta de comercio y aceptación de términos.
  - `POST /v1/sim/wompi/tokens/cards` — Emisión de token de tarjeta.
  - `POST /v1/sim/wompi/transactions` — Creación de transacción (tarjeta o PSE).
  - `GET /v1/sim/wompi/transactions/:id` — Consulta de estado de transacción.
  - `GET /v1/sim/wompi/pse/financial_institutions` — Lista de instituciones financieras PSE.
  - `GET /v1/sim/wompi/pse/redirect` — Página de banco del PSE (ver abajo).
  - `GET /v1/sim/wompi/terms` — Términos y condiciones del simulador.
- **Mercado Pago (`/v1/sim/mercadopago`)** — 9:
  - `POST /v1/sim/mercadopago/payments` — Cobro directo con tarjeta por la Payments API, el camino del SDK 0.5.0 (exige idempotencia).
  - `GET /v1/sim/mercadopago/payments/:id` — Consulta de pago con tarjeta por ID.
  - `POST /v1/sim/mercadopago/card_tokens` — Emisión de token de tarjeta.
  - `GET /v1/sim/mercadopago/card_tokens/:id` — Lectura del token con el access token: el BIN en `first_six_digits`.
  - `POST /v1/sim/mercadopago/orders` — Creación de orden de PSE o de tarjeta (la tarjeta, desde el SDK 0.6.0).
  - `GET /v1/sim/mercadopago/orders/:id` — Consulta de orden.
  - `GET /v1/sim/mercadopago/payment_methods` — Catálogo de medios de pago, con los bancos PSE.
  - `GET /v1/sim/mercadopago/payment_methods/search` — Marca y tipo de tarjeta por BIN (`?public_key=…&bins=…`).
  - `GET /v1/sim/mercadopago/payments/:paymentId/bank_transfer` — Página de banco del PSE (ver abajo).
- **Kushki (`/v1/sim/kushki`)** — 7:
  - `POST /v1/sim/kushki/card/v1/charges` — Cobro directo con tarjeta.
  - `GET /v1/sim/kushki/charges/:ticketNumber` — Consulta de cargo con tarjeta.
  - `GET /v1/sim/kushki/transfer/v1/bankList` — Lista de bancos PSE.
  - `POST /v1/sim/kushki/transfer/v1/tokens` — Token de la transferencia, con el banco y la URL de retorno.
  - `POST /v1/sim/kushki/transfer/v1/init` — Inicio de transferencia bancaria PSE.
  - `GET /v1/sim/kushki/transfer/v1/status/:token` — Consulta de estado de transferencia PSE.
  - `GET /v1/sim/kushki/transfer/v1/agent` — Página de banco del PSE (ver abajo).
- **Rapyd (`/v1/sim/rapyd`)** — 9:
  - `POST /v1/sim/rapyd/payments` — Creación de cobro (tarjeta o PSE).
  - `GET /v1/sim/rapyd/payments/:paymentId` — Consulta de pago por ID.
  - `POST /v1/sim/rapyd/checkout` — Creación de página alojada (Hosted Checkout).
  - `GET /v1/sim/rapyd/checkout/:checkoutId` — Consulta del checkout.
  - `GET /v1/sim/rapyd/checkout/:checkoutId/pay` — Página que simula al pagador completando el pago del checkout.
  - `GET /v1/sim/rapyd/checkout/:checkoutId/pagar` — Redirección `308` hacia `/pay`.
  - `POST /v1/sim/rapyd/customers` — Creación de cliente.
  - `GET /v1/sim/rapyd/payment_methods/country` — Medios de pago y bancos del país.
  - `GET /v1/sim/rapyd/complete-bank-payment` — Página de banco del PSE (ver abajo).
- **Disparador de Webhooks**:
  - `POST /v1/sim/webhooks/trigger` — Dispara una notificación HTTP firmada criptográficamente hacia un endpoint destino, permitiendo probar la recepción de webhooks de forma determinista.

### Páginas de banco del PSE

Las cuatro pasarelas entregan, en la respuesta del cobro con PSE, una URL que apunta a una página del propio simulador (las cuatro rutas marcadas arriba). Es HTML: avisa que la redirección es simulada y ofrece «Volver al comercio», a la URL de retorno que el comercio pidió al crear el cobro (Mercado Pago le agrega `payment_id`, como la real). No mueve el pago: el desenlace lo fija el banco de prueba o el escenario al crearlo, y se lee consultando el pago.

---

## Instalación y Ejecución Local

### Requisitos Previos

El simulador consume los tipos y clases del SDK desde `sdk/dist`. Compile primero el SDK:

```bash
# Desde la raíz del repositorio
cd sdk && npm install && npm run build
```

### Iniciar el Servidor

```bash
cd ../simulator-api
npm install
npm run dev
```

El servidor escuchará por defecto en `http://localhost:3000`.

### Scripts Disponibles

- `npm run dev`: Inicia el servidor con recarga en caliente (`ts-node-dev`).
- `npm run build`: Compila el código TypeScript a JavaScript en `dist/`.
- `npm start`: Ejecuta el servidor compilado en producción (`node dist/server.js`).
- `npm test`: Ejecuta la suite de pruebas unitarias y de integración con Jest (incluyendo pruebas OpenAPI).
- `npm run lint`: Ejecuta el linter ESLint en todo el paquete.

---

## Colección de Postman

La API de simulación y la capa REST cuentan con una colección versionada de Postman en formato Schema v2.1.0 y entornos listos para usar en:
[`postman/`](./postman/)

- `kit-pagos-simulator.postman_collection.json`: Peticiones organizadas para todos los endpoints de `/v1/api`, diagnóstico (`/health`), y las 4 pasarelas en `/v1/sim`.
- `local.postman_environment.json`: Entorno para ejecución en `localhost:3000`.
- `render.postman_environment.json`: Entorno para pruebas contra la nube de Render (`https://kit-pagos-colombia.onrender.com`).

Consulte [`postman/README.md`](./postman/README.md) para instrucciones de importación y ejecución con Newman en terminal.

---

## Variables de Entorno

| Variable | Descripción | Valor por Defecto |
|---|---|---|
| `PORT` | Puerto HTTP en el que escucha el servidor Fastify, y el de las URL que la API arma hacia sí misma cuando no hay `SIMULATOR_SDK_BASE_URL`. Un valor que no es un entero entre 1 y 65535 detiene el arranque. | `3000` |
| `HOST` | Interfaz en la que escucha. | `0.0.0.0` |
| `SIMULATOR_PUBLIC_ORIGIN` | Origen público (`protocolo://host`) de las URL que el simulador entrega: las páginas de banco del PSE, el checkout de Rapyd y los términos de Wompi. Hace falta detrás de un proxy que termina TLS, como Render. Un valor con ruta, credenciales u otro protocolo detiene el arranque. | Sin valor: el protocolo y el `Host` de cada petición |
| `SIMULATOR_SDK_BASE_URL` | URL a la que el SDK interno llama en el ambiente `simulator`; se le agrega `/v1/sim/<pasarela>`. En Render es la URL pública del servicio. | Sin valor: el propio proceso, `http://localhost:<PORT>` |
| `SIMULATOR_TRUST_FORWARDED_FOR` | Con `true`, la IP del pagador que `POST /v1/api/payments` completa cuando el cuerpo no trae `ipAddress` sale de la primera dirección de `X-Forwarded-For`. Solo detrás de un proxy que escriba esa cabecera, como Render. | Apagada |

La lista completa, con las credenciales de cada pasarela, está en [`.env.example`](../.env.example) y en la sección 4.4 de [`4-despliegue-en-render-y-coleccion-postman.md`](../docs/02-arquitectura/4-despliegue-en-render-y-coleccion-postman.md), que explica además de qué archivos se leen y cuál gana.

---

## Licencia

Código publicado bajo licencia [Apache-2.0](../LICENSE). Proyecto de grado de la Pontificia Universidad Javeriana de Bogotá.
