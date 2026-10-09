# API de Simulación y Capa REST — Kit Pagos Colombia

[![Fastify](https://img.shields.io/badge/Fastify-5.x-black.svg)](https://fastify.dev/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0.3-green.svg)](https://swagger.io/specification/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

La **API de Simulación** es el segundo componente del artefacto de Kit Pagos Colombia. Desarrollada sobre [Fastify](https://fastify.dev/) en TypeScript, cumple dos funciones arquitectónicas desacopladas:

1. **Capa REST de Kit Pagos (`/v1/api`)**: Expone las capacidades del SDK a través de una interfaz HTTP unificada, permitiendo procesar cobros, consultar estados, listar bancos PSE y verificar firmas de webhooks sin necesidad de instalar el paquete npm.
2. **Servidor Mock de Pasarelas (`/v1/sim`)**: Provee 23 rutas simuladas con fidelidad a los contratos de **Wompi**, **Mercado Pago**, **Kushki** y **Rapyd**, permitiendo ejercitar flujos completos (incluyendo escenarios de rechazo, timeout, errores de red y desenlaces de PSE) sin depender de conexión a internet ni incurrir en bloqueos de sandboxes reales.

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

Mapeo formal a códigos de estado HTTP según el estándar del proyecto (RF-08):
- `INVALID_REQUEST` / `MISSING_PARAMETER` → `400 Bad Request`
- `UNAUTHORIZED` / `INVALID_CREDENTIALS` / `INVALID_SIGNATURE` → `401 Unauthorized`
- `TRANSACTION_NOT_FOUND` → `404 Not Found`
- `UNSUPPORTED_OPERATION` → `422 Unprocessable Entity`
- `GATEWAY_ERROR` / `INTERNAL_ERROR` → `502 Bad Gateway`
- `GATEWAY_TIMEOUT` → `504 Gateway Timeout`

---

## 2. Servidor Mock de Simulación (`/v1/sim`)

El servidor provee 23 rutas organizadas por pasarela que emulan el comportamiento y formato de carga de cada sandbox oficial:

### Rutas por Pasarela

- **Wompi (`/v1/sim/wompi`)**:
  - `GET /v1/sim/wompi/merchants/:key` — Consulta de comercio y aceptación de términos.
  - `POST /v1/sim/wompi/tokens/cards` — Emisión de token de tarjeta.
  - `POST /v1/sim/wompi/transactions` — Creación de transacción (tarjeta o PSE).
  - `GET /v1/sim/wompi/transactions/:id` — Consulta de estado de transacción.
  - `GET /v1/sim/wompi/pse/financial_institutions` — Lista de instituciones financieras PSE.
  - `GET /v1/sim/wompi/terms` — Términos y condiciones del simulador.
- **Mercado Pago (`/v1/sim/mercadopago`)**:
  - `POST /v1/sim/mercadopago/v1/payments` — Cobro directo con tarjeta (exige idempotencia).
  - `GET /v1/sim/mercadopago/v1/payments/:id` — Consulta de transacción por ID.
  - `POST /v1/sim/mercadopago/v1/orders` — Creación de orden PSE.
  - `GET /v1/sim/mercadopago/v1/payment_methods/pse/banks` — Catálogo de bancos PSE.
- **Kushki (`/v1/sim/kushki`)**:
  - `POST /v1/sim/kushki/card/v1/charges` — Cobro directo con tarjeta.
  - `POST /v1/sim/kushki/tokens/v1/card` — Tokenización de tarjeta.
  - `POST /v1/sim/kushki/transfer-in/v1/init` — Inicio de transferencia bancaria PSE.
  - `GET /v1/sim/kushki/transfer-in/v1/status/:token` — Consulta de estado de transferencia PSE.
- **Rapyd (`/v1/sim/rapyd`)**:
  - `POST /v1/sim/rapyd/v1/checkout` — Creación de página alojada (Hosted Checkout).
  - `POST /v1/sim/rapyd/v1/payments` — Creación de cobro (tarjeta o PSE).
  - `GET /v1/sim/rapyd/v1/payments/:id` — Consulta de pago por ID.
  - `GET /v1/sim/rapyd/v1/payment_methods/banks` — Lista de bancos habilitados.
- **Disparador de Webhooks (`/v1/sim/webhooks/trigger/:gateway`)**:
  - `POST /v1/sim/webhooks/trigger/:gateway` — Dispara una notificación HTTP firmada criptográficamente hacia un endpoint destino, permitiendo probar la recepción de webhooks de forma determinista.

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

## Variables de Entorno

| Variable | Descripción | Valor por Defecto |
|---|---|---|
| `PORT` | Puerto HTTP en el que escucha el servidor Fastify. | `3000` |
| `SIMULATOR_PUBLIC_ORIGIN` | Origen público para construir URLs de retorno, checkout y bancos PSE (esencial tras proxies como Render). | `http://localhost:3000` |
| `SIMULATOR_SDK_BASE_URL` | URL base que el SDK interno utiliza para alcanzar el simulador. | Mismo que `SIMULATOR_PUBLIC_ORIGIN` |

---

## Licencia

Código publicado bajo licencia [Apache-2.0](../LICENSE). Proyecto de grado de la Pontificia Universidad Javeriana de Bogotá.
