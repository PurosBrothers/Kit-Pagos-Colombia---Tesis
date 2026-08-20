# Registro de inconsistencias del SAD

Este documento registra las discrepancias encontradas entre las distintas secciones y diagramas del Software Architecture Document (SAD), y entre el SAD y el código del repositorio. El SAD en sí (el archivo `.docx` en Google Drive) sigue siendo la fuente única de verdad del proyecto, pero varios de sus artefactos se redactaron en momentos distintos y no se sincronizaron entre ellos. Este archivo existe para que esas correcciones no se pierdan y se puedan aplicar directamente sobre el documento original.

Cada fila indica el estado: **Resuelto** (ya se decidió y se aplicó en el código y en `layers-and-components.md`) o **Pendiente en el SAD** (la decisión ya se tomó, pero falta corregir el texto o los diagramas del documento original, algo que este agente no puede editar directamente porque vive fuera del repositorio).

## 1. Nombres de los tres métodos públicos del facade

**Encontrado:** El `Component Diagram - C4.png` del SDK y la sección 9.1.1 usan `createPayment()`, `getPaymentStatus()`, `validateWebhook()`. La sección 15.2 usa `createPayment(request)`, `getStatus(id)`, `verifyWebhook(payload, headers)`. El diagrama `Hexagonal architecture class diagram.png` (obsoleto, ver punto 7) usa `processWebhook()`.

**Decisión:** Se adopta la versión que coincide en más artefactos: `createPayment()`, `getPaymentStatus()`, `validateWebhook()`.

**Estado:** Resuelto en código (`KitPagos.ts`) y en `layers-and-components.md`. **Pendiente en el SAD:** corregir la sección 15.2 para que use estos mismos nombres.

## 2. Forma de la clase `SdkError`

**Encontrado:** El `Domain Class Diagram.png` muestra `SdkError` con `friendlyMessage`, `httpStatus`, `originalError` y `requestId`, además de `code` y `gateway`. La sección 15.1 solo define `code`, `gateway` y `originalPayload`.

**Decisión:** Se mantiene la versión de la sección 15.1 (`code`, `gateway`, `originalPayload`), ya implementada.

**Estado:** Resuelto en código. **Pendiente en el SAD:** corregir el `Domain Class Diagram.png` para que coincida con la sección 15.1, o justificar explícitamente por qué la clase real necesita los campos adicionales (si el equipo decide que sí los necesita más adelante, esta decisión debe revisarse).

## 3. Mutabilidad de `Transaction` y campo `authorizationCode`

**Encontrado:** El `Domain Class Diagram.png` muestra un método `updateStatus(...)` en `Transaction`, lo que sugiere una entidad mutable. La sección 9.1.8 menciona explícitamente el atributo `authorizationCode`, que no estaba implementado.

**Decisión:** `Transaction` se mantiene inmutable. Cuando llega un webhook de conciliación, el `Response Normalizer` construye una instancia nueva en lugar de mutar la existente. El campo `authorizationCode` sí se incorpora, como atributo opcional fijado en el constructor.

**Estado:** Resuelto en código. **Pendiente en el SAD:** quitar el método `updateStatus(...)` del `Domain Class Diagram.png` y aclarar en la sección 15.1 que la reconciliación por webhook se resuelve reconstruyendo la entidad, no mutándola.

## 4. Mayúsculas y minúsculas en el enum `Gateway`

**Encontrado:** `Gateway.ts` se implementó con valores en minúscula (`"wompi"`, `"payu"`, ...), mientras que `TransactionStatus`, `RejectionCategory` y `SdkErrorCode` usan mayúsculas, y el `Domain Class Diagram.png` muestra `WOMPI`, `PAYU`, `MERCADOPAGO`, `KUSHKI`.

**Decisión:** Se corrige `Gateway.ts` a mayúsculas para mantener consistencia con el resto del vocabulario normalizado del dominio.

**Estado:** Resuelto en código. No requiere cambios en el SAD, ya que el diagrama ya estaba correcto; el error estaba solo en la implementación.

## 5. Plataforma de despliegue de la API de Simulación: Railway vs. Render

**Encontrado:** Las secciones 8.1 y 8.2 (Vista de contenedores) afirman que la API de Simulación está desplegada en **Railway**. La sección 11.2 (Vista física, redactada en una sesión posterior de este mismo proyecto) dice **Render**, y las credenciales reales del equipo (`.env.example`) confirman Render.

**Decisión:** Render es la plataforma correcta.

**Estado:** Pendiente en el SAD. Hay que corregir las secciones 8.1 y 8.2 para que digan Render en lugar de Railway, y revisar si el `Container Diagram - C4.png` de la API de Simulación también menciona Railway en alguna etiqueta.

## 6. Concepto `WebhookEvent` para satisfacer RF-04

**Encontrado:** RF-04 exige que la validación de un webhook "retorne un evento normalizado" cuando la firma es válida. Ni la sección 9.1.7 ni la 15.1 definen ese evento; `WebhookVerifier` solo tenía `verify(...): boolean`. El único artefacto que mencionaba un `WebhookEvent` con `parseWebhook(): WebhookEvent` era el diagrama obsoleto del punto 7.

**Decisión:** Se reintroduce `WebhookEvent` como concepto vigente del dominio. `WebhookVerifier` gana un segundo método público, `parse(payload, gateway): WebhookEvent`, y `KitPagos.validateWebhook(payload, headers)` ahora retorna `WebhookEvent` en lugar de `boolean`.

**Estado:** Resuelto en código. **Pendiente en el SAD:** agregar `WebhookEvent` a la tabla de conceptos del dominio (sección 3) y actualizar la sección 15.1 para reflejar que `WebhookVerifier` ya no tiene un único método público, sino dos (`verify` y `parse`).

## 7. Diagramas obsoletos: capa de Use Cases y Controller

**Encontrado:** `Hexagonal architecture class diagram.png` y los tres diagramas de secuencia del SDK (`Sequence Diagram - Payment Creation.png`, `Sequence Diagram - Synchronous Payment.png`, `Sequence Diagram - Webhook Conciliation.png`) están dibujados contra un diseño anterior que incluía `CrearPagoUseCase`, `ConsultarEstadoUseCase`, `ProcesarWebhookUseCase`, `WebhookController`, un `PaymentController` REST, y conceptos que no existen en ningún otro lado del SAD vigente (`Order` como raíz de agregado, `Money` en vez de `Amount`, `EstadoTransaccion` en vez de `TransactionStatus`, `RejectionInfo` en vez de `RejectionReason`, y un cuarto nombre para el facade, `KitPagosFacade`, usado solo en el texto de la sección 10.1.1).

**Decisión:** Se regeneran los 4 diagramas para reflejar el diseño final (facade directo, sin capa explícita de Use Cases ni Controller), consistente con las secciones 9 y 15 y con el `Component Diagram - C4.png` y el `Domain Class Diagram.png` vigentes.

**Estado:** Resuelto (diagramas regenerados en esta misma sesión, ver `docs/architecture/SDK/`). **Pendiente en el SAD:** reemplazar las figuras 6, 8, 9 y 10 del documento por las versiones nuevas, y corregir el texto de la sección 10.1.1 que todavía menciona `KitPagosFacade`.

## 8. `setup-and-structure.md` desactualizado

**Encontrado:** Este documento describe `domain/enums/EstadoTransaccion.ts`, `domain/interfaces/IIntencionPago.ts`, `domain/errors/ErrorNormalizado.ts` y el facade en `application/KitPagos.ts`. Ninguno de estos nombres ni rutas coincide con la estructura vigente (`domain/entities`, `domain/value-objects`, `domain/errors`, `domain/services`, `application/ports`, `infrastructure/facade/KitPagos.ts`).

**Estado:** Pendiente. Es el documento de arranque más antiguo del repositorio; se recomienda actualizarlo o marcarlo explícitamente como histórico y redirigir a `layers-and-components.md` como referencia vigente de estructura.

## 9. Archivo de imagen suelto dentro del código fuente

**Encontrado:** `sdk/src/Hexagonal.png` está ubicado dentro del árbol de código fuente del SDK, no en `docs/architecture/`.

**Estado:** Pendiente. Se recomienda moverlo a `docs/architecture/SDK/` o eliminarlo si es una copia duplicada, para que no quede empaquetado dentro del artefacto publicado a npm.

## 10. Sin framework de pruebas en `simulator-api`

**Encontrado:** `sdk/package.json` ya tiene Jest configurado con un umbral de cobertura del 80%. `simulator-api/package.json` no tiene ningún framework de pruebas configurado, a pesar de que la API de Simulación es, según el propio SAD, el entorno principal de validación del proyecto durante la fase de evaluación.

**Estado:** Pendiente. Se recomienda decidir el framework de pruebas para `simulator-api` antes de empezar a implementar sus endpoints.

## 11. `ubiquitous-language.md` desalineado con la reestructuración del dominio

**Encontrado:** El documento fue escrito antes de la reestructuración de `sdk/src/domain` y usa `EstadoTransaccion` en lugar de `TransactionStatus`, nombres de archivo de contrato conceptuales (`IRequestCrearPago.ts`, `IWebhookPayload.ts`, `IResponseConsultaPago.ts`) que no corresponden a `PaymentGatewayPort.ts`, y un snippet de `SdkError` con `httpStatus` y `originalError` que contradice la decisión tomada en el punto 2 de este documento (versión "lean": `code`, `gateway`, `originalPayload`).

**Decisión:** Se mantiene la matriz de equivalencias por pasarela (Wompi/PayU/Mercado Pago/Kushki) tal como está, porque es investigación de campo valiosa y en gran parte independiente de la reestructuración del dominio. Se corrige puntualmente el snippet de `SdkError` y se agrega una nota de vigencia al inicio del documento.

**Estado:** Parcialmente resuelto (nota de vigencia y snippet de `SdkError` corregidos). **Pendiente:** una pasada completa de reemplazo de `EstadoTransaccion` por `TransactionStatus` en las tablas, y decidir si vale la pena crear los archivos de contrato por flujo (creación, webhook, consulta, error) dentro de `application/ports/`, o si toda esa información debe vivir directamente como comentarios de implementación dentro de cada Adapter.

## 12. `sdk/package.json` sin scripts reales y con licencia incorrecta

**Encontrado:** El `package.json` del SDK tenía `"license": "ISC"`, contradiciendo la sección 1.2/2.1 del SAD y `setup-and-structure.md`, que exigen Apache 2.0 (y que ya está correctamente declarada en `simulator-api/package.json`). Además, el único script era `"test": "echo \"Error: no test specified\" && exit 1"`, un placeholder que falla siempre, a pesar de que Jest y `jest.config.js` ya estaban configurados; no existían scripts `build` ni `lint`.

**Decisión:** Se corrige `license` a `Apache-2.0` y se agregan los scripts `build` (tsc), `test` (jest) y `lint` (eslint), ya que son los que documenta `setup-and-structure.md`.

**Estado:** Resuelto parcialmente. `npm test` ahora ejecuta Jest de verdad, pero seguirá fallando ("No tests found") hasta que exista al menos un archivo `*.test.ts`, lo cual es el comportamiento esperado, no un bug. `npm run lint` seguirá fallando porque **no existe ningún archivo `eslint.config.js`** en el proyecto (ESLint 10 requiere flat config; no hay `@typescript-eslint/parser` ni `@typescript-eslint/eslint-plugin` instalados). Configurar ESLint correctamente (elegir el ruleset, instalar los paquetes de `@typescript-eslint`, y crear `eslint.config.js`) debe ser un issue explícito de la primera iteración, no un ajuste incidental.
