# Especificación de Capas y Componentes — Kit Pagos Colombia

> **Documento Oficial de Arquitectura (Nivel 3 — Modelo C4)**  
> **Proyecto:** Kit Pagos Colombia — Trabajo de Grado en Ingeniería de Sistemas  
> **Institución:** Pontificia Universidad Javeriana (Bogotá)  
> **Metodología:** Design Science Research (DSR)  
> **Versión:** 1.0.0

> Las discrepancias detectadas entre este documento, el SAD original y los diagramas C4 se registran en [`sad-inconsistencies.md`](./sad-inconsistencies.md), con su estado de resolución y las correcciones pendientes en el documento fuente.
>
> Para una explicación conceptual de por qué se eligió esta arquitectura y una demostración directa de cómo se refleja en el código real de `sdk/src/` (incluyendo qué partes ya están implementadas y cuáles siguen pendientes), ver [`architecture-explained.md`](./architecture-explained.md).
>
> La cuarta pasarela originalmente era PayU. Rapyd adquirió la operación de PayU en Latinoamérica en 2025, y el registro de comercio nuevo para Colombia ya no otorga acceso a la API clásica de PayU, sino únicamente a la de Rapyd Collect. Este documento ya refleja ese cambio de nombre; ver el punto 15 de [`sad-inconsistencies.md`](./sad-inconsistencies.md) para el detalle de la decisión y el estado pendiente de investigación del contrato real de Rapyd.

---

## 1. Estructura de Directorios del Repositorio (`src/` y `api/`)

```text
kit-pagos-colombia/
├── src/                                        <-- CONTENEDOR 1: SDK KIT PAGOS COLOMBIA
│   ├── domain/                                 <-- Capa de Dominio (Núcleo Puro)
│   │   ├── entities/
│   │   │   └── Transaction.ts                  <-- Transaction Entity (única entidad con identidad propia)
│   │   ├── value-objects/
│   │   │   ├── Amount.ts                       <-- Value Object: monto, toMinorUnits(), equals()
│   │   │   ├── Currency.ts                     <-- Value Object: código ISO 4217, "COP" por defecto
│   │   │   ├── OrderReference.ts               <-- Value Object: referencia de orden del comercio
│   │   │   ├── Payer.ts                        <-- Value Object: datos del pagador (email obligatorio)
│   │   │   ├── GatewayTransactionId.ts         <-- Value Object: id nativo + Gateway que lo originó
│   │   │   ├── RejectionReason.ts              <-- Value Object: rejectionCode + rejectionCategory
│   │   │   ├── ReturnUrlConfig.ts              <-- Value Object: resolveFor(status)
│   │   │   ├── TransactionStatus.ts            <-- Enum: APPROVED, DECLINED, PENDING, EXPIRED, VOIDED, ERROR
│   │   │   ├── RejectionCategory.ts            <-- Enum: INSUFFICIENT_FUNDS, INVALID_CARD_DATA, etc.
│   │   │   ├── SdkErrorCode.ts                 <-- Enum: INVALID_CREDENTIALS, GATEWAY_TIMEOUT, etc.
│   │   │   ├── Gateway.ts                      <-- Enum: WOMPI, PAYU, MERCADOPAGO, KUSHKI
│   │   │   └── WebhookEvent.ts                 <-- Value Object: evento normalizado de webhook (RF-04)
│   │   ├── errors/
│   │   │   └── SdkError.ts                     <-- Excepción tipada unificada (code, gateway, originalPayload)
│   │   └── services/
│   │       └── WebhookVerifier.ts              <-- Webhook Verifier (servicio de dominio sin estado propio)
│   │
│   ├── application/                            <-- Capa de Aplicación (Puertos y Servicios)
│   │   ├── ports/
│   │   │   └── PaymentGatewayPort.ts           <-- Payment Gateway Port (Contrato hexagonal)
│   │   └── services/
│   │       ├── ResponseNormalizer.ts           <-- Response Normalizer
│   │       ├── RetryHandler.ts                 <-- Retry Handler (Resiliencia & Backoff)
│   │       └── ErrorHandler.ts                 <-- Error Handler (Mapeo de excepciones)
│   │
│   └── infrastructure/                         <-- Capa de Infraestructura (Adaptadores y Facade)
│       ├── config/
│       │   └── SDKConfigurator.ts              <-- SDK Configurator
│       ├── factories/
│       │   └── GatewayFactory.ts               <-- Gateway Factory (Patrón GoF Factory)
│       ├── adapters/
│       │   ├── WompiAdapter.ts                 <-- Wompi Adapter
│       │   ├── RapydAdapter.ts                 <-- Rapyd Adapter
│       │   ├── MercadoPagoAdapter.ts           <-- Mercado Pago Adapter
│       │   └── KushkiAdapter.ts                <-- Kushki Adapter
│       └── facade/
│           └── KitPagos.ts                     <-- KitPagos (Patrón GoF Facade — Punto de entrada público)
│
└── api/                                        <-- CONTENEDOR 2: API DE SIMULACIÓN (FASTIFY)
    ├── routes/
    │   └── router.ts                           <-- HTTP Router & Headers Middleware
    ├── engine/
    │   └── ScenarioEngine.ts                   <-- Scenario Execution Engine
    ├── factories/
    │   ├── GatewayMockFactory.ts               <-- Gateway Mock Factory (orquestador)
    │   ├── WompiMockFactory.ts
    │   ├── RapydMockFactory.ts
    │   ├── MercadoPagoMockFactory.ts
    │   └── KushkiMockFactory.ts
    ├── security/
    │   └── SignatureGenerator.ts               <-- Signature Generator
    ├── endpoints/
    │   └── WebhookTriggerEndpoint.ts           <-- Webhook Trigger Endpoint (POST /v1/sim/webhooks/trigger)
    └── docs/
        └── OpenAPIProvider.ts                  <-- OpenAPI Documentation Provider (Swagger UI /docs)
```

---

## 2. Detalle de Componentes — SDK Kit Pagos Colombia (Nivel 3)

El SDK es el contenedor de mayor complejidad arquitectónica del sistema. Su diseño interno sigue la **Arquitectura Hexagonal (Ports & Adapters)** que organiza el sistema alrededor de un núcleo de dominio independiente, comunicado con el exterior únicamente a través de interfaces abstractas. El contenedor expone once componentes con responsabilidades claramente delimitadas, organizados en tres capas: dominio, aplicación e infraestructura.

---

### 2.1. KitPagos (`src/infrastructure/facade/KitPagos.ts`)

- **Patrón Arquitectónico:** GoF Facade.
- **Responsabilidad:** Es el punto de entrada único del SDK y el único componente que el desarrollador que consume el SDK instancia directamente.
- **Métodos Públicos:** Expone tres métodos: `createPayment(request)`, `getPaymentStatus(id)` y `validateWebhook(payload, headers)`. Estos nombres coinciden con el Component Diagram C4 y la sección 9.1.1 del SAD; la sección 15.2 usa nombres distintos (`getStatus`, `verifyWebhook`), inconsistencia registrada en `sad-inconsistencies.md` (punto 1).
- **Comportamiento:** Oculta la complejidad interna del sistema detrás de una interfaz simple y predecible. Mantiene una referencia a `SDKConfigurator` y a `GatewayFactory`; antes de ejecutar cualquier operación consulta al Configurator para determinar la pasarela activa y sus credenciales, solicita al Factory la instancia del adaptador correspondiente, y envuelve la llamada resultante con `RetryHandler`. Retorna entidades `Transaction` normalizadas al desarrollador o excepciones `SdkError` tipadas en caso de fallo. `validateWebhook()` retorna un `WebhookEvent` en lugar de un booleano, para cumplir RF-04 (ver sección 2.10).

---

### 2.2. SDK Configurator (`src/infrastructure/config/SDKConfigurator.ts`)

- **Responsabilidad:** Gestiona toda la configuración del SDK en un único punto: pasarela activa, credenciales por proveedor, modo de entorno y parámetros del mecanismo de reintento. Todos los demás componentes que necesitan información de configuración la obtienen desde aquí.
- **Redirección de Simulación:** El conmutador entre modo producción y modo simulación vive en este componente. Cuando el modo es simulación, los adaptadores redirigen sus solicitudes hacia la API de Simulación, que constituye el entorno principal de validación durante la fase de evaluación del proyecto.

---

### 2.3. Gateway Factory (`src/infrastructure/factories/GatewayFactory.ts`)

- **Patrón Arquitectónico:** GoF Factory.
- **Responsabilidad:** Recibe el enum `Gateway` (con valores `WOMPI`, `RAPYD`, `MERCADOPAGO` o `KUSHKI`) y retorna la instancia del adaptador correspondiente.
- **Desacoplamiento:** Cambiar de pasarela es una operación de configuración: el desarrollador modifica el parámetro de inicialización del SDK y el Factory instancia el adaptador correcto sin que ningún otro componente deba cambiar.

---

### 2.4. Payment Gateway Port (`src/application/ports/PaymentGatewayPort.ts`)

- **Patrón Arquitectónico:** Puerto de salida de la Arquitectura Hexagonal. Define el contrato que los adaptadores de infraestructura deben implementar para conectarse al núcleo del sistema.
- **Responsabilidad:** Es la interfaz abstracta que especifica las tres operaciones disponibles — `createPayment()`, `getStatus()` y `verifySignature()` — sin conocimiento de ningún proveedor específico.
- **Extensibilidad:** Cualquier clase que implemente este contrato puede conectarse al sistema como pasarela válida, lo que hace posible incorporar nuevos proveedores sin modificar el núcleo.

---

### 2.5. Wompi Adapter (`src/infrastructure/adapters/WompiAdapter.ts`)

- **Patrón Arquitectónico:** GoF Adapter.
- **Responsabilidad:** Implementa el `PaymentGatewayPort` y traduce su contrato hacia las convenciones de Wompi.
- **Detalles de implementación:**
  - Autenticación: header `Authorization: Bearer {llave_privada}`.
  - Endpoint de creación: `POST /v1/transactions`.
  - Mapeo de estado: campo `data.status` con valores `APPROVED`, `DECLINED`, `VOIDED`, `PENDING`.
  - Verificación de firma: SHA-256 sobre cadena de propiedades + timestamp + secreto de integridad.
- **Prioridad:** Alta. Es el adaptador de referencia del proyecto, con implementación completa y validación exhaustiva en sandbox.
- **Modo simulación:** Redirige solicitudes al simulador con headers `x-simulate-scenario` y `x-simulate-delay`.

---

### 2.6. Rapyd Adapter (`src/infrastructure/adapters/RapydAdapter.ts`)

- **Patrón Arquitectónico:** GoF Adapter.
- **Responsabilidad:** Implementa el `PaymentGatewayPort` y traduce su contrato hacia las convenciones de Rapyd Collect.
- **Detalles de implementación (confirmados):**
  - Autenticación: header `access_key` más firma calculada con `secret_key` (no hay `apiLogin`/`apiKey` como en la antigua API de PayU).
  - Firma de webhook: `Base64(HMAC-SHA256(url_path + salt + timestamp + access_key + secret_key + body_string))`, distinta de la fórmula que usaba PayU.
  - **⚠️ PENDIENTE:** el mapeo exacto de campos de creación de pago y de consulta de estado (endpoint de Checkout/Collect, forma del payload, catálogo de estados) todavía no está investigado con el mismo nivel de detalle que las otras tres pasarelas. Ver el issue de investigación del contrato de Rapyd Collect antes de implementar este adaptador.
- **Prioridad:** Media. Pendiente de implementación (ver `sad-inconsistencies.md`, punto 15).
- **Modo simulación:** Redirige solicitudes al simulador en modo pruebas.

> **Nota histórica:** esta pasarela era originalmente PayU. `sdk/src/domain/services/WebhookVerifier.ts` y sus pruebas ya tienen implementado y validado el algoritmo de firma de PayU (`Gateway.PAYU`, MD5/SHA-256 sobre `apiKey~merchantId~referenceCode~amount~currency~estado`) como parte del trabajo de Iteración 1. Ese código sigue funcionando pero queda obsoleto frente a la pasarela real disponible hoy; debe migrarse a la fórmula de Rapyd cuando se resuelva la investigación pendiente, no antes, para no reemplazar lógica probada por una fórmula a medio confirmar.

---

### 2.7. Mercado Pago Adapter (`src/infrastructure/adapters/MercadoPagoAdapter.ts`)

- **Patrón Arquitectónico:** GoF Adapter.
- **Responsabilidad:** Implementa el `PaymentGatewayPort` y traduce su contrato hacia las convenciones de Mercado Pago.
- **Detalles de implementación:**
  - Autenticación: header `Authorization: Bearer {access_token}`.
  - Mapeo de estado: campo `status` y `status_detail`. Valores clave: `accredited` (aprobado), `cc_rejected_insufficient_amount` (fondos insuficientes), `cc_rejected_bad_filled_card_number` (número de tarjeta incorrecto).
  - Verificación de firma: HMAC-SHA256 sobre headers y body.
- **Prioridad:** Media. Implementación funcional validada en sandbox.
- **Modo simulación:** Redirige solicitudes al simulador en modo pruebas.

---

### 2.8. Kushki Adapter (`src/infrastructure/adapters/KushkiAdapter.ts`)

- **Patrón Arquitectónico:** GoF Adapter.
- **Responsabilidad:** Implementa el `PaymentGatewayPort` y traduce su contrato hacia las convenciones de Kushki.
- **Detalles de implementación:**
  - Autenticación: header `Private-Merchant-Id`.
  - Mapeo de estado: campo `transaction_status` con valores `APPROVAL` y `DECLINED`. **Nota crítica:** Kushki usa `APPROVAL` en lugar de `APPROVED`, diferencia que el Response Normalizer gestiona explícitamente.
  - Verificación de firma: HMAC-SHA256.
- **Prioridad:** Media. Implementación funcional validada en sandbox UAT.
- **Modo simulación:** Redirige solicitudes al simulador en modo pruebas.

---

### 2.9. Response Normalizer (`src/application/services/ResponseNormalizer.ts`)

- **Responsabilidad:** Recibe la respuesta nativa de cualquier adaptador y la transforma al modelo de dominio unificado del SDK.
- **Mapeo de estados:** Traduce los estados crudos de cada proveedor al enum `TransactionStatus` con valores `APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED` y `ERROR`. Gestiona explícitamente el caso `APPROVAL` de Kushki como equivalente a `APPROVED`.
- **Construcción de entidad:** Una vez normalizado el estado, construye y retorna la entidad `Transaction` con todos los campos del dominio.
- **Impacto en métricas CK:** Al centralizar la normalización, el código cliente no necesita referenciar los tipos de respuesta de ninguna pasarela, lo que reduce directamente su CBO (Coupling Between Object Classes) — indicador clave de la evaluación del framework.

---

### 2.10. Webhook Verifier (`src/domain/services/WebhookVerifier.ts`)

- **Patrón Arquitectónico:** Servicio de Dominio (DDD) sin estado propio.
- **Responsabilidad:** Verifica la autenticidad de los webhooks entrantes de cada pasarela mediante `verify(payload, headers, secret, gateway): boolean`, delegando internamente en la lógica de verificación de firma correspondiente al Gateway recibido.
- **Implementación por pasarela:**
  - **Wompi:** SHA-256 sobre cadena de propiedades + timestamp + secreto. Implementación completa y validada.
  - **Rapyd:** `Base64(HMAC-SHA256(url_path + salt + timestamp + access_key + secret_key + body_string))`. **⚠️ PENDIENTE de implementar**; el código actual (`Gateway.PAYU`) todavía implementa la fórmula de PayU (MD5/SHA-256 sobre `apiKey~merchantId~referenceCode~amount~currency~estado`), que ya no aplica a la pasarela real disponible. Migrar cuando se resuelva la investigación del contrato de Rapyd Collect (ver `sad-inconsistencies.md`, punto 15).
  - **Mercado Pago:** HMAC-SHA256 sobre headers y body. Implementación suficiente para validar webhooks del simulador.
  - **Kushki:** HMAC-SHA256. Implementación suficiente para validar webhooks del simulador.
- **Segundo método público — `parse(payload, gateway): WebhookEvent`:** Construye el evento normalizado (`WebhookEvent`) a partir del payload ya verificado, para cumplir RF-04 ("retornar un evento normalizado si la firma es válida"). Este método no está en la sección 15.1 del SAD, que describe a `WebhookVerifier` con un único método público; es una desviación deliberada registrada en `sad-inconsistencies.md` (punto 6), porque ningún otro componente vigente del SAD define cómo se construye ese evento.
- **Integración:** `KitPagos.validateWebhook()` llama primero a `verify()` y, si la firma es válida, a `parse()`, devolviendo el `WebhookEvent` resultante al comercio (o un `SdkError(WEBHOOK_SIGNATURE_INVALID)` si la firma no es válida).

---

### 2.11. Transaction Entity (`src/domain/entities/Transaction.ts`)

- **Responsabilidad:** Es la única clase con identidad propia del dominio del SDK.
- **Encapsulamiento:** Se construye a partir de los objetos de valor `Amount`, `Currency`, `OrderReference`, `Payer` y `GatewayTransactionId`, además de referenciar el enum `TransactionStatus` que indica su estado y, opcionalmente, una instancia de `RejectionReason` cuando ese estado es `DECLINED`. Conserva además el campo `rawStatus`, que guarda el valor nativo devuelto por la pasarela antes de ser normalizado, con fines de auditoría, y el campo opcional `authorizationCode` (sección 9.1.8).
- **Métodos de negocio:** Expone `isApproved()`, `isPending()` e `isFinal()`, que permiten al desarrollador tomar decisiones de negocio sin necesidad de comparar directamente contra los valores del enum ni depender de los estados crudos de ninguna pasarela.
- **Inmutabilidad:** `Transaction` no expone ningún método de mutación. Cuando una transacción `PENDING` se concilia mediante webhook, el `Response Normalizer` construye una instancia nueva a partir del evento recibido, en lugar de mutar la instancia existente (ver `sad-inconsistencies.md`, punto 3).

---

### 2.12. ReturnUrlConfig (`src/domain/value-objects/ReturnUrlConfig.ts`)

- **Patrón Arquitectónico:** Value Object del dominio.
- **Responsabilidad:** Encapsula las URLs de redirección post-pago configuradas por el comercio: `returnUrl` (URL base), `success` (pago aprobado), `failure` (pago rechazado) y `pending` (pago pendiente de confirmación).
- **Uso:** La entidad `Transaction` utiliza este objeto de valor para resolver la URL de redirección correspondiente mediante el método `resolveFor(status)`.

---

### 2.13. Retry Handler (`src/application/services/RetryHandler.ts`)

- **Responsabilidad:** Intercepta errores transitorios antes de que lleguen al Error Handler e implementa la estrategia de reintentos.
- **Estrategia:** Backoff exponencial configurable. Valores por defecto: 3 reintentos con intervalos de 1s, 2s y 4s.
- **Clasificación de errores:** Distingue entre errores transitorios candidatos a reintento (timeout de red, HTTP 5xx) y errores definitivos que no se recuperarán con intentos adicionales (rechazo de pago, credenciales inválidas).
- **Salida:** Si se supera el máximo de intentos, pasa el error al `ErrorHandler` con código `MAX_RETRIES_EXCEEDED`.

---

### 2.14. Error Handler (`src/application/services/ErrorHandler.ts`)

- **Responsabilidad:** Convierte cualquier error no recuperable en una excepción `SdkError` tipada.
- **Estructura de SdkError:** extiende la clase `Error` nativa de JavaScript y añade tres atributos:
  - `code`: código normalizado del enum `SdkErrorCode` (valores: `INVALID_CREDENTIALS`, `GATEWAY_TIMEOUT`, `CONNECTION_FAILED`, `RATE_LIMIT_EXCEEDED`, `RESOURCE_NOT_FOUND`, `WEBHOOK_SIGNATURE_INVALID`, `MAX_RETRIES_EXCEEDED`, `MALFORMED_RESPONSE`, `UNSUPPORTED_OPERATION`, `UNKNOWN_ERROR`).
  - `gateway`: la pasarela (`Gateway`) que originó el error.
  - `originalPayload`: tipado como `unknown` para forzar una verificación explícita antes de su uso, en lugar de `any`.
- **Garantía:** El desarrollador nunca recibe excepciones no manejadas ni errores en formato nativo de ninguna pasarela.

---

## 3. Detalle de Componentes — API de Simulación (Fastify Container — Nivel 3)

La API de Simulación es un servicio Fastify sobre Node.js 18 cuya arquitectura interna sigue un flujo de procesamiento secuencial con responsabilidades claramente delimitadas entre seis componentes. El flujo avanza de izquierda a derecha desde la recepción de la solicitud hasta la generación de la respuesta firmada.

---

### 3.1. HTTP Router & Headers Middleware (`api/routes/router.ts`)

- **Responsabilidad:** Es la puerta de entrada del simulador, implementado como un plugin Fastify.
- **Enrutamiento:** Identifica la pasarela de destino a partir de la URL: `/v1/sim/wompi/*`, `/v1/sim/payu/*`, `/v1/sim/mercadopago/*` o `/v1/sim/kushki/*`.
- **Headers interceptados:**
  - `x-simulate-scenario`: escenario a ejecutar (`APROBADO`, `RECHAZADO`, `FONDOS_INSUFICIENTES`, `TIMEOUT`, `ERROR_RED`).
  - `x-simulate-delay`: milisegundos de latencia a introducir.
- **Fuentes de solicitud:** SDK Kit Pagos Colombia en modo simulación, o directamente el Desarrollador o Tester mediante herramientas REST (Postman, curl).

---

### 3.2. Scenario Execution Engine (`api/engine/ScenarioEngine.ts`)

- **Responsabilidad:** Es el componente de decisión del simulador.
- **Lógica de ejecución por escenario:**
  - `APROBADO` / `RECHAZADO` / `FONDOS_INSUFICIENTES`: delega la construcción del payload al `Gateway Mock Factory`.
  - `TIMEOUT`: introduce la latencia especificada en `x-simulate-delay` mediante una promesa de espera antes de responder. Permite verificar que el `Retry Handler` del SDK maneja correctamente los tiempos de espera prolongados.
  - `ERROR_RED`: retorna directamente HTTP 500 o 502 con cuerpo genérico de infraestructura, sin invocar al Mock Factory. Simula la caída del servidor del proveedor.

---

### 3.3. Gateway Mock Factory (`api/factories/GatewayMockFactory.ts`)

- **Responsabilidad:** Orquesta la construcción de payloads JSON que replican con exactitud la estructura de las respuestas nativas de cada pasarela.
- **Fábricas internas:**
  - `WompiMockFactory`: genera `data.status: "APPROVED"` o `"DECLINED"` con estructura completa de Wompi.
  - `RapydMockFactory`: **⚠️ PENDIENTE de diseñar.** Reemplaza al antiguo `PayUMockFactory` (que generaba `transactionResponse.state` con estructura de PayU); su forma real depende de la investigación del contrato de Rapyd Collect (ver `sad-inconsistencies.md`, punto 15).
  - `MercadoPagoMockFactory`: genera `status` y `status_detail` en minúsculas. Para fondos insuficientes: `status_detail: "cc_rejected_insufficient_amount"`.
  - `KushkiMockFactory`: genera `transaction_status: "APPROVAL"` o `"DECLINED"` respetando el vocabulario propio de Kushki.
- **Criticidad:** La precisión de este componente es crítica para la validación del framework. Si el formato del Mock no coincide con el de la pasarela real, el `Response Normalizer` del SDK fallará en los escenarios de prueba.

---

### 3.4. Signature Generator (`api/security/SignatureGenerator.ts`)

- **Responsabilidad:** Calcula la firma criptográfica que acompaña a los webhooks simulados, de modo que el `Webhook Verifier` del SDK pueda verificarla con su lógica de validación real.
- **Implementación por pasarela:**
  - **Wompi:** SHA-256 sobre cadena de propiedades + timestamp + secreto de integridad. Implementación completa y validada.
  - **Rapyd:** `Base64(HMAC-SHA256(url_path + salt + timestamp + access_key + secret_key + body_string))`. **⚠️ PENDIENTE de implementar**, reemplaza la fórmula de PayU (MD5/SHA-256 sobre `apiKey~merchantId~referenceCode~amount~currency~estado`) usada hasta ahora.
  - **Mercado Pago / Kushki:** HMAC-SHA256 sobre headers y body. Implementación suficiente para la fase de evaluación.
- **Invocación:** No opera de forma automática. Es invocado exclusivamente por el `Webhook Trigger Endpoint` cuando el desarrollador solicita explícitamente el envío de un webhook sintético.

---

### 3.5. Webhook Trigger Endpoint (`api/endpoints/WebhookTriggerEndpoint.ts`)

- **Responsabilidad:** Gestiona el envío de webhooks sintéticos de forma controlada y explícita mediante `POST /v1/sim/webhooks/trigger`.
- **Parámetros de entrada:** URL destino, tipo de evento y pasarela a simular.
- **Justificación del diseño manual:** Esta decisión responde a una restricción práctica del contexto de evaluación académica. Los proyectos prototípicos que integran el framework corren típicamente en entornos locales sin URL pública fija, lo que hace inviable el dispatch automático sin una solución de tunelización adicional como ngrok. Al requerir invocación manual, el componente elimina esa dependencia sin sacrificar la capacidad de probar el flujo completo de validación de webhooks.
- **Flujo:** Recibe la solicitud → delega la generación de firma al `Signature Generator` → ejecuta HTTP POST hacia la URL destino indicada → retorna el resultado del intento de entrega.

---

### 3.6. OpenAPI Documentation Provider (`api/docs/OpenAPIProvider.ts`)

- **Responsabilidad:** Sirve automáticamente la especificación OpenAPI 3.0 del simulador en el endpoint `/docs` mediante el plugin `@fastify/swagger`.
- **Beneficio operativo:** No requiere mantenimiento manual. Cada modificación en los endpoints del simulador se refleja automáticamente en la especificación servida.
- **Entregable formal:** Constituye uno de los entregables formales del proyecto definidos en la propuesta (sección 1.3), produciendo directamente un artefacto evaluable sin trabajo adicional.

---

## 4. Decisiones Arquitectónicas Relevantes

### DA-01 — Adopción de Arquitectura Hexagonal sobre Capas Tradicionales

| Campo | Detalle |
|---|---|
| **Decisión** | Organizar el SDK en capas de dominio, aplicación e infraestructura con comunicación exclusiva a través del puerto `PaymentGatewayPort` |
| **Alternativa considerada** | Arquitectura en capas tradicionales (presentación, lógica, datos) con acoplamiento directo a cada pasarela |
| **Justificación** | El problema central del proyecto es la fragmentación de cuatro pasarelas con convenciones distintas. La arquitectura hexagonal garantiza que el núcleo sea independiente de cualquier proveedor, que agregar una pasarela nueva requiera solo un adaptador nuevo, y que el simulador pueda reemplazar a las pasarelas reales sin modificar el núcleo. Una arquitectura en capas tradicional hubiera acoplado el dominio a los tipos de respuesta de cada proveedor, elevando el CBO del código cliente |
| **Consecuencias** | Mayor número de archivos y mayor complejidad de estructura inicial. Compensado por extensibilidad demostrable y separación de responsabilidades verificable mediante métricas CK |

---

### DA-02 — Uso de Fastify sobre Express para la API de Simulación

| Campo | Detalle |
|---|---|
| **Decisión** | Implementar la API de Simulación con Fastify en lugar de Express |
| **Alternativa considerada** | Express.js, que es el framework Node.js más ampliamente conocido |
| **Justificación** | Fastify ofrece integración nativa con OpenAPI 3.0 mediante `@fastify/swagger`, lo que permite que la documentación interactiva sea un entregable automático del proyecto sin trabajo adicional. Adicionalmente, Fastify tiene mejor rendimiento en benchmarks estándar y un sistema de plugins más estructurado que facilita la separación del Router como componente independiente |
| **Consecuencias** | Curva de aprendizaje ligeramente mayor que Express para desarrolladores no familiarizados. Compensada por la generación automática de OpenAPI y el rendimiento del servicio |

---

### DA-03 — Webhook Trigger Manual sobre Dispatch Automático

| Campo | Detalle |
|---|---|
| **Decisión** | El envío de webhooks sintéticos requiere invocación manual mediante `POST /v1/sim/webhooks/trigger` en lugar de operar de forma automática y asíncrona |
| **Alternativa considerada** | Webhook Dispatcher Worker que despacha automáticamente tras cada transacción simulada |
| **Justificación** | Los proyectos prototípicos de evaluación corren en entornos locales sin URL pública. Un dispatch automático requeriría que el comercio exponga un endpoint público en todo momento, lo que implica dependencia de herramientas de tunelización como ngrok durante las pruebas. Al hacer el dispatch manual y explícito, el desarrollador controla cuándo y hacia qué URL se envía el webhook, eliminando la dependencia de infraestructura adicional |
| **Consecuencias** | El flujo de webhooks no es completamente automático. El desarrollador debe invocar el trigger manualmente para probar el flujo de notificaciones asíncronas. Esta limitación queda documentada como trabajo futuro |

---

### DA-04 — Distribución como Paquete npm bajo Apache 2.0

| Campo | Detalle |
|---|---|
| **Decisión** | Distribuir el framework como paquete npm open source bajo licencia Apache License 2.0 |
| **Alternativa considerada** | Distribución como repositorio sin publicación en npm, o bajo licencia MIT |
| **Justificación** | npm es el canal de distribución estándar del ecosistema Node.js/TypeScript. La instalación mediante `npm install` es el mecanismo que los desarrolladores colombianos ya conocen y usan. Apache 2.0 se eligió sobre MIT porque incluye una cláusula explícita de no agresión en materia de patentes, lo que protege tanto a los autores como a los usuarios del framework en uso comercial |
| **Consecuencias** | Requiere mantener el archivo `package.json` con metadatos correctos y un proceso de publicación en el registro npm. La licencia Apache 2.0 impone la obligación de incluir el aviso de derechos de autor en distribuciones derivadas |

---

## 5. Matriz de Trazabilidad entre Requisitos y Componentes

| Requisito (SRS) | Componente del SDK | Componente de la API de Simulación |
|:---|:---|:---|
| **RF-01** Crear intención de pago | `KitPagos` → `GatewayFactory` → `Adapter` | `HTTPRouter` → `ScenarioEngine` → `GatewayMockFactory` |
| **RF-02** Respuesta normalizada con Transaction | `ResponseNormalizer` → `Transaction Entity` | `GatewayMockFactory` (payload de referencia) |
| **RF-03** Consultar estado de transacción | `KitPagos` → `Adapter` → `ResponseNormalizer` | `GatewayMockFactory` |
| **RF-04** Validar firma de webhook y retornar evento normalizado | `WebhookVerifier` (`verify()` + `parse()`) → `WebhookEvent` | `SignatureGenerator` → `WebhookTriggerEndpoint` |
| **RF-05** Excepciones tipadas SdkError | `ErrorHandler` (`SdkError` + `SdkErrorCode`) | `ScenarioEngine` (escenario `ERROR_RED`) |
| **RF-06** Cambiar pasarela sin modificar código | `SDKConfigurator` + `GatewayFactory` | N/A |
| **RF-07** Reintentos con backoff exponencial | `RetryHandler` | `ScenarioEngine` (escenario `TIMEOUT`) |
| **RF-08** Credenciales no expuestas en logs | `SDKConfigurator` + `ErrorHandler` | N/A |
| **RF-09** Endpoints REST por pasarela | N/A | `HTTPRouter` (`/v1/sim/{pasarela}/*`) |
| **RF-10** Escenarios controlados configurables | `SDKConfigurator` (header `x-simulate-scenario`) | `HTTPRouter` → `ScenarioEngine` |
| **RF-11** Estructura de error nativa por pasarela | `ResponseNormalizer` (campo `rawStatus`) | `GatewayMockFactory` (payload de error nativo) |
| **RF-12** Webhook sintético hacia URL destino | `WebhookVerifier` (validación del receptor) | `WebhookTriggerEndpoint` → `SignatureGenerator` |
| **RF-13** Especificación OpenAPI 3.0 en `/docs` | N/A | `OpenAPIProvider` |
| **RF-14** Documentación de datos de prueba por pasarela | N/A | Documentación centralizada (repositorio) |
| **RF-15** Comportamiento esperado por dato de prueba | `ResponseNormalizer` (mapeo de estados) | `GatewayMockFactory` (escenarios por dato) |

---

*Documento técnico de especificación de arquitectura alineado con los diagramas C4 Nivel 3 del proyecto Kit Pagos Colombia. Versión 1.0.0 — Pontificia Universidad Javeriana, 2026.*