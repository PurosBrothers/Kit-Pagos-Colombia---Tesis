# Registro de inconsistencias del SAD

Este documento registra las discrepancias encontradas entre las distintas secciones y diagramas del Software Architecture Document (SAD), y entre el SAD y el código del repositorio. El SAD en sí (el archivo `.docx` en Google Drive) sigue siendo la fuente única de verdad del proyecto, pero varios de sus artefactos se redactaron en momentos distintos y no se sincronizaron entre ellos. Este archivo existe para que esas correcciones no se pierdan y se puedan aplicar directamente sobre el documento original.

Cada fila indica el estado: **Resuelto** (ya se decidió y se aplicó en el código y en `layers-and-components.md`) o **Pendiente en el SAD** (la decisión ya se tomó, pero falta corregir el texto o los diagramas del documento original, algo que este agente no puede editar directamente porque vive fuera del repositorio).

## Iteración 0 — Responsables por sección del SAD

Antes de empezar a implementar nada de la primera iteración de código, cada corrección pendiente en el documento original debe quedar asignada a quien redactó esa sección, según la división de trabajo del equipo:

| # | Sección del SAD | Responsable | Correcciones pendientes encontradas en este documento |
|---|---|---|---|
| 1 | Introducción | Joshua | La sección 1.2 ya dice Apache 2.0 correctamente (ver punto 12, que era un error solo en el código). **Punto 15 (nuevo):** en 1.2, cambiar "Wompi, PayU, Mercado Pago y Kushki" por "Wompi, Rapyd, Mercado Pago y Kushki". |
| 2 | Requisitos funcionales | Joan | Punto 14: corregir RF-03 para que use los mismos seis valores que el enum `TransactionStatus` implementado (`APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED`, `ERROR`), en vez de la lista en español que tiene hoy. RF-04 no requiere ningún cambio de texto. **Punto 15:** ninguna RF nombra "PayU" explícitamente, no requiere corrección por este punto. |
| 3 | Modelo de dominio | Henao | Punto 2 (`SdkError` del diagrama de clases), punto 3 (quitar `updateStatus()` del diagrama, es inmutable), punto 6 (agregar `WebhookEvent` a la tabla de conceptos), **y punto 13 (falta por completo el modelo de dominio de la API de Simulación)**. **Punto 15 (nuevo):** en `Domain Class Diagram.png`, el enum `Gateway` lista "WOMPI, PAYU, MERCADOPAGO, KUSHKI"; cambiar "PAYU" por "RAPYD". Esta imagen no tiene fuente PlantUML en el repo, se corrige manualmente con la herramienta original. |
| 4 | Stakeholders | Henao | Ninguna encontrada. |
| 5 | ASR | Joan | Ninguna encontrada. |
| 6 | Restricciones | David | **Punto 15 (nuevo):** revisar si esta sección menciona términos específicos de la API de PayU (`apiLogin`/`apiKey`, MD5) como restricción técnica; de ser así, actualizar a los términos de Rapyd (`access_key`/`secret_key`) o señalar explícitamente que el contrato de Rapyd está pendiente de investigación. |
| 7 | Contexto y Alcance | Joshua | **Punto 15 (nuevo):** en 7.1.3, reemplazar el párrafo completo sobre "PayU Latam" (autenticación por body, firma MD5/SHA-256) por uno equivalente sobre Rapyd (autenticación `access_key`/`secret_key`, firma de webhook `Base64(HMAC-SHA256(url_path + salt + timestamp + access_key + secret_key + body_string))`); en 7.2.4, cambiar "Wompi, PayU, Mercado Pago y Kushki" por "Wompi, Rapyd, Mercado Pago y Kushki". |
| 8 | Vista de contenedores | Joshua | Punto 5: en 8.1 y 8.2, cambiar toda mención de "Railway" por "Render". En `Container Diagram - C4.png` de la API de Simulación, la etiqueta del contenedor "API de Simulación Desplegada" dice hoy "Railway o Render — URL pública HTTPS"; debe decir solo "Render". **Punto 15 (nuevo):** en 8.1.1, cambiar "Wompi, PayU, Mercado Pago y Kushki" y "Adaptador Wompi, Adaptador PayU, Adaptador Mercado Pago y Adaptador Kushki" por sus equivalentes con Rapyd. |
| 9 | Vista de componentes | Joshua | **Punto 15 (nuevo):** en 9.1.3, cambiar los valores del enum `Gateway` de "WOMPI, PAYU, MERCADOPAGO o KUSHKI" a "WOMPI, RAPYD, MERCADOPAGO o KUSHKI"; renombrar el título 9.1.5 y su contenido ("PayU Adapter" → "Rapyd Adapter"); en 9.1.7 y 9.2.4, actualizar la mención "Para PayU, Mercado Pago y Kushki se implementa..." con el algoritmo real de Rapyd; en 9.2.3, renombrar "PayUMockFactory" a "RapydMockFactory". En `Component Diagram - C4.png`, corregir las etiquetas "PayU Adapter", "Traduce a PayU (Body auth, MD5/SHA)" y "PayU API — Latam Sandbox". Esta imagen no tiene fuente PlantUML en el repo, se corrige manualmente. |
| 10 | Vista de procesos | David | Punto 7 (reemplazar las Figuras 8, 9 y 10 por los diagramas de secuencia regenerados, y corregir el texto de 10.1.1 que menciona `KitPagosFacade`). |
| 11 | Vista física | Joan | Ninguna encontrada (ya quedó correcta con Render). |
| 12 | Modelo de datos | Henao | Ninguna encontrada. |
| 13 | ADR | Joan | Punto 7: la sección 13.1 sí referencia el `Hexagonal architecture class diagram.png` por nombre ("el Diagrama de Clases de la Arquitectura Hexagonal"), confirmado por el propio texto. Reemplazar la imagen embebida por la versión regenerada, y agregarle un número de figura ("Figura N"), ya que hoy es el único diagrama del documento sin ese rótulo, a diferencia del resto de figuras citadas en la sección 13. **Punto 15 (nuevo):** revisar si algún ADR de esta sección documenta el vocabulario nativo de PayU (`state_pol`, la particularidad de que PayU siempre devuelve HTTP 200) y corregirlo o marcarlo como pendiente de la investigación de Rapyd. |
| 14 | Riesgo técnico | David | Punto 10 (falta framework de pruebas en `simulator-api`) es un riesgo de calidad que vale la pena registrar ahí, aunque no sea una inconsistencia de redacción. **Punto 15 (nuevo):** registrar la transición de PayU a Rapyd como un riesgo ya materializado (cambio de proveedor externo fuera de control del equipo, que invalidó documentación e implementación ya hecha del algoritmo de firma). |
| 15 | Estructura del Sistema | David | Punto 1 (corregir nombres de métodos en 15.2 a `getPaymentStatus`/`validateWebhook`), punto 3 (aclarar que la reconciliación reconstruye la entidad), punto 6 (aclarar que `WebhookVerifier` tiene dos métodos públicos, no uno). |
| 16 | Glosario | David | **Punto 15 (nuevo):** si la definición de `Gateway`/`Adapter` usa a PayU como ejemplo, reemplazarlo por Rapyd, y agregar una nota breve sobre la adquisición de PayU por Rapyd para que el lector entienda por qué cambió el nombre. |

Los puntos 4, 8, 9, 11 y 12 de este documento no corresponden a ninguna de las 16 secciones del SAD (son documentos de repositorio o decisiones de código ya resueltas), así que no tienen un responsable de esta lista; se dejan como tareas de ingeniería general para la primera iteración.

---

## 1. Nombres de los tres métodos públicos del facade

**Responsable de corregirlo en el SAD:** David (sección 15.2).

**Encontrado:** El `Component Diagram - C4.png` del SDK y la sección 9.1.1 usan `createPayment()`, `getPaymentStatus()`, `validateWebhook()`. La sección 15.2 usa `createPayment(request)`, `getStatus(id)`, `verifyWebhook(payload, headers)`. El diagrama `Hexagonal architecture class diagram.png` (obsoleto, ver punto 7) usa `processWebhook()`.

**Decisión:** Se adopta la versión que coincide en más artefactos: `createPayment()`, `getPaymentStatus()`, `validateWebhook()`.

**Estado:** Resuelto en código (`KitPagos.ts`) y en `layers-and-components.md`. **Pendiente en el SAD:** corregir la sección 15.2 para que use estos mismos nombres.

## 2. Forma de la clase `SdkError`

**Responsable de corregirlo en el SAD:** Henao (sección 3, `Domain Class Diagram.png`).

**Encontrado:** El `Domain Class Diagram.png` muestra `SdkError` con `friendlyMessage`, `httpStatus`, `originalError` y `requestId`, además de `code` y `gateway`. La sección 15.1 solo define `code`, `gateway` y `originalPayload`.

**Decisión:** Se mantiene la versión de la sección 15.1 (`code`, `gateway`, `originalPayload`), ya implementada.

**Estado:** Resuelto en código. **Pendiente en el SAD:** corregir el `Domain Class Diagram.png` para que coincida con la sección 15.1, o justificar explícitamente por qué la clase real necesita los campos adicionales (si el equipo decide que sí los necesita más adelante, esta decisión debe revisarse).

## 3. Mutabilidad de `Transaction` y campo `authorizationCode`

**Responsable de corregirlo en el SAD:** Henao (diagrama, sección 3) y David (aclaración textual, sección 15.1).

**Encontrado:** El `Domain Class Diagram.png` muestra un método `updateStatus(...)` en `Transaction`, lo que sugiere una entidad mutable. La sección 9.1.8 menciona explícitamente el atributo `authorizationCode`, que no estaba implementado.

**Decisión:** `Transaction` se mantiene inmutable. Cuando llega un webhook de conciliación, el `Response Normalizer` construye una instancia nueva en lugar de mutar la existente. El campo `authorizationCode` sí se incorpora, como atributo opcional fijado en el constructor.

**Estado:** Resuelto en código. **Pendiente en el SAD:** quitar el método `updateStatus(...)` del `Domain Class Diagram.png` y aclarar en la sección 15.1 que la reconciliación por webhook se resuelve reconstruyendo la entidad, no mutándola.

## 4. Mayúsculas y minúsculas en el enum `Gateway`

**Responsable de corregirlo en el SAD:** Nadie, no requiere acción sobre el documento (ver estado).

**Encontrado:** `Gateway.ts` se implementó con valores en minúscula (`"wompi"`, `"payu"`, ...), mientras que `TransactionStatus`, `RejectionCategory` y `SdkErrorCode` usan mayúsculas, y el `Domain Class Diagram.png` muestra `WOMPI`, `PAYU`, `MERCADOPAGO`, `KUSHKI`.

**Decisión:** Se corrige `Gateway.ts` a mayúsculas para mantener consistencia con el resto del vocabulario normalizado del dominio.

**Estado:** Resuelto en código. No requiere cambios en el SAD, ya que el diagrama ya estaba correcto; el error estaba solo en la implementación.

## 5. Plataforma de despliegue de la API de Simulación: Railway vs. Render

**Responsable de corregirlo en el SAD:** Joshua (secciones 8.1 y 8.2).

**Encontrado:** Las secciones 8.1 y 8.2 (Vista de contenedores) afirman que la API de Simulación está desplegada en **Railway**. La sección 11.2 (Vista física, redactada en una sesión posterior de este mismo proyecto) dice **Render**, y las credenciales reales del equipo (`.env.example`) confirman Render. Se verificó además `Container Diagram - C4.png` de la API de Simulación: la etiqueta del contenedor "API de Simulación Desplegada" dice literalmente *"Railway o Render — URL pública HTTPS"*, es decir que ni siquiera el propio diagrama se decide entre las dos opciones.

**Decisión:** Render es la plataforma correcta.

**Estado:** Pendiente en el SAD. Cambios puntuales requeridos:
1. Sección 8.1: reemplazar "Railway" por "Render" en el texto.
2. Sección 8.2: mismo reemplazo.
3. `Container Diagram - C4.png` (API de Simulación): editar la etiqueta del contenedor "API de Simulación Desplegada" para que diga solo `[Fastify / Node.js 18+ — Render — URL pública HTTPS]`, quitando "Railway o".

## 6. Concepto `WebhookEvent` para satisfacer RF-04

**Responsable de corregirlo en el SAD:** Henao (tabla de conceptos, sección 3) y David (sección 15.1). RF-04 (sección 2, dueña Joan) ya está redactado con precisión y no requiere cambios; ver punto 14.

**Encontrado:** RF-04 exige que la validación de un webhook "retorne un evento normalizado" cuando la firma es válida. Ni la sección 9.1.7 ni la 15.1 definen ese evento; `WebhookVerifier` solo tenía `verify(...): boolean`. El único artefacto que mencionaba un `WebhookEvent` con `parseWebhook(): WebhookEvent` era el diagrama obsoleto del punto 7.

**Decisión:** Se reintroduce `WebhookEvent` como concepto vigente del dominio. `WebhookVerifier` gana un segundo método público, `parse(payload, gateway): WebhookEvent`, y `KitPagos.validateWebhook(payload, headers)` ahora retorna `WebhookEvent` en lugar de `boolean`.

**Estado:** Resuelto en código. **Pendiente en el SAD:** agregar `WebhookEvent` a la tabla de conceptos del dominio (sección 3) y actualizar la sección 15.1 para reflejar que `WebhookVerifier` ya no tiene un único método público, sino dos (`verify` y `parse`).

## 7. Diagramas obsoletos: capa de Use Cases y Controller

**Responsable de corregirlo en el SAD:** David (Figuras 8, 9 y 10 de la sección 10, y el texto de 10.1.1) y Joan (el `Hexagonal architecture class diagram.png`, ver sección 13.1).

**Encontrado:** `Hexagonal architecture class diagram.png` y los tres diagramas de secuencia del SDK (`Sequence Diagram - Payment Creation.png`, `Sequence Diagram - Synchronous Payment.png`, `Sequence Diagram - Webhook Conciliation.png`) están dibujados contra un diseño anterior que incluía `CrearPagoUseCase`, `ConsultarEstadoUseCase`, `ProcesarWebhookUseCase`, `WebhookController`, un `PaymentController` REST, y conceptos que no existen en ningún otro lado del SAD vigente (`Order` como raíz de agregado, `Money` en vez de `Amount`, `EstadoTransaccion` en vez de `TransactionStatus`, `RejectionInfo` en vez de `RejectionReason`, y un cuarto nombre para el facade, `KitPagosFacade`, usado solo en el texto de la sección 10.1.1). Se confirmó, releyendo la sección 13.1 (ADR-01), que el texto sí referencia el `Hexagonal architecture class diagram.png` por nombre: *"Esta organización puede verse en el Diagrama de Componentes del SDK y en el Diagrama de Clases de la Arquitectura Hexagona[l]"*. A diferencia de las Figuras 8, 9 y 10 (citadas como "Figura N" en la sección 10), este diagrama se menciona solo por nombre, sin número de figura asociado en ninguna parte del documento.

**Decisión:** Se regeneran los 4 diagramas para reflejar el diseño final (facade directo, sin capa explícita de Use Cases ni Controller), consistente con las secciones 9 y 15 y con el `Component Diagram - C4.png` y el `Domain Class Diagram.png` vigentes.

**Estado:** Resuelto (diagramas regenerados en esta misma sesión, ver `docs/architecture/SDK/`). **Pendiente en el SAD:**
1. David: reemplazar las Figuras 8, 9 y 10 de la sección 10 por las versiones nuevas, y corregir el texto de la sección 10.1.1 que todavía menciona `KitPagosFacade` (debe decir `KitPagos`).
2. Joan: reemplazar la imagen citada en la sección 13.1 por la versión regenerada de `Hexagonal architecture class diagram.png`, y asignarle un número de figura ("Figura N") para que quede referenciada igual que el resto de diagramas del documento.

## 8. `setup-and-structure.md` desactualizado

**Responsable:** No corresponde a ninguna de las 16 secciones del SAD; es un documento de repositorio. Queda como tarea de ingeniería general sin dueño fijo hasta que el equipo lo asigne.

**Encontrado:** Este documento describe `domain/enums/EstadoTransaccion.ts`, `domain/interfaces/IIntencionPago.ts`, `domain/errors/ErrorNormalizado.ts` y el facade en `application/KitPagos.ts`. Ninguno de estos nombres ni rutas coincide con la estructura vigente (`domain/entities`, `domain/value-objects`, `domain/errors`, `domain/services`, `application/ports`, `infrastructure/facade/KitPagos.ts`).

**Estado:** Pendiente. Es el documento de arranque más antiguo del repositorio; se recomienda actualizarlo o marcarlo explícitamente como histórico y redirigir a `layers-and-components.md` como referencia vigente de estructura.

## 9. Archivo de imagen suelto dentro del código fuente

**Responsable:** No corresponde a ninguna sección del SAD; limpieza de repositorio, cualquiera puede resolverlo.

**Encontrado:** `sdk/src/Hexagonal.png` está ubicado dentro del árbol de código fuente del SDK, no en `docs/architecture/`.

**Estado:** Pendiente. Se recomienda moverlo a `docs/architecture/SDK/` o eliminarlo si es una copia duplicada, para que no quede empaquetado dentro del artefacto publicado a npm.

## 10. Sin framework de pruebas en `simulator-api`

**Responsable:** No corresponde a una sección de redacción del SAD, pero David (dueño de Riesgos técnicos, sección 14) debería registrarlo ahí como riesgo de calidad.

**Encontrado:** `sdk/package.json` ya tiene Jest configurado con un umbral de cobertura del 80%. `simulator-api/package.json` no tiene ningún framework de pruebas configurado, a pesar de que la API de Simulación es, según el propio SAD, el entorno principal de validación del proyecto durante la fase de evaluación.

**Estado:** Pendiente. Se recomienda decidir el framework de pruebas para `simulator-api` antes de empezar a implementar sus endpoints.

## 11. `ubiquitous-language.md` desalineado con la reestructuración del dominio

**Responsable:** No es una sección del SAD, pero su contenido mezcla dominio (Henao) y manejo de errores (David); si alguno de los dos tiene tiempo de sobra, es el candidato natural para la pasada completa pendiente.

**Encontrado:** El documento fue escrito antes de la reestructuración de `sdk/src/domain` y usa `EstadoTransaccion` en lugar de `TransactionStatus`, nombres de archivo de contrato conceptuales (`IRequestCrearPago.ts`, `IWebhookPayload.ts`, `IResponseConsultaPago.ts`) que no corresponden a `PaymentGatewayPort.ts`, y un snippet de `SdkError` con `httpStatus` y `originalError` que contradice la decisión tomada en el punto 2 de este documento (versión "lean": `code`, `gateway`, `originalPayload`).

**Decisión:** Se mantiene la matriz de equivalencias por pasarela (Wompi/PayU/Mercado Pago/Kushki) tal como está, porque es investigación de campo valiosa y en gran parte independiente de la reestructuración del dominio. Se corrige puntualmente el snippet de `SdkError` y se agrega una nota de vigencia al inicio del documento.

**Estado:** Parcialmente resuelto (nota de vigencia y snippet de `SdkError` corregidos). **Pendiente:** una pasada completa de reemplazo de `EstadoTransaccion` por `TransactionStatus` en las tablas, y decidir si vale la pena crear los archivos de contrato por flujo (creación, webhook, consulta, error) dentro de `application/ports/`, o si toda esa información debe vivir directamente como comentarios de implementación dentro de cada Adapter.

## 12. `sdk/package.json` sin scripts reales y con licencia incorrecta

**Responsable:** No requiere acción en el SAD; la sección 1.2 (Joshua) ya decía Apache 2.0 correctamente, el error estaba solo en el archivo de configuración.

**Encontrado:** El `package.json` del SDK tenía `"license": "ISC"`, contradiciendo la sección 1.2/2.1 del SAD y `setup-and-structure.md`, que exigen Apache 2.0 (y que ya está correctamente declarada en `simulator-api/package.json`). Además, el único script era `"test": "echo \"Error: no test specified\" && exit 1"`, un placeholder que falla siempre, a pesar de que Jest y `jest.config.js` ya estaban configurados; no existían scripts `build` ni `lint`.

**Decisión:** Se corrige `license` a `Apache-2.0` y se agregan los scripts `build` (tsc), `test` (jest) y `lint` (eslint), ya que son los que documenta `setup-and-structure.md`.

**Estado:** Resuelto parcialmente. `npm test` ahora ejecuta Jest de verdad, pero seguirá fallando ("No tests found") hasta que exista al menos un archivo `*.test.ts`, lo cual es el comportamiento esperado, no un bug. `npm run lint` seguirá fallando porque **no existe ningún archivo `eslint.config.js`** en el proyecto (ESLint 10 requiere flat config; no hay `@typescript-eslint/parser` ni `@typescript-eslint/eslint-plugin` instalados). Configurar ESLint correctamente (elegir el ruleset, instalar los paquetes de `@typescript-eslint`, y crear `eslint.config.js`) debe ser un issue explícito de la primera iteración, no un ajuste incidental.

## 13. Falta el modelo de dominio de la API de Simulación

**Responsable de escribirlo en el SAD:** Henao (sección 3).

**Encontrado:** La sección 3 (Modelo de dominio) del SAD solo documenta los conceptos del SDK (`Transaction`, `Amount`, `WebhookVerifier`, etc., Tabla 2). No existe una tabla ni un diagrama de conceptos equivalente para la API de Simulación, a pesar de que la sección 9.2 describe cinco componentes propios (`HttpRouterMiddleware`, `ScenarioExecutionEngine`, `GatewayMockFactory`, `SignatureGenerator`, `WebhookTriggerEndpoint`) que manipulan conceptos que nunca quedaron definidos formalmente: el enum de escenarios (`APROBADO`, `RECHAZADO`, `FONDOS_INSUFICIENTES`, `TIMEOUT`, `ERROR_RED`), la forma de un payload mock por pasarela, y la forma de una solicitud de disparo de webhook.

**Estado:** Pendiente, es trabajo nuevo, no una corrección. No hay una decisión tomada todavía sobre la forma de estos conceptos; queda para cuando Henao lo redacte.

## 14. RF-03 usa nombres de estado en español, distintos del enum implementado

**Responsable de corregirlo en el SAD:** Joan (sección 2, Tabla 1).

**Encontrado:** RF-03 dice: *"El sistema debe permitir consultar el estado de una transacción por identificador y retornarlo mapeado a los estados normalizados: PENDIENTE, APROBADO, RECHAZADO, EXPIRADO o ERROR."* Son 5 estados en español. El enum `TransactionStatus` implementado (`sdk/src/domain/value-objects/TransactionStatus.ts`), la sección 15.1, el ADR-03 (13.3) y el `Domain Class Diagram.png` coinciden entre sí en 6 valores, en inglés y mayúsculas: `APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED`, `ERROR`. RF-03 además omite `VOIDED` por completo.

De paso se revisó RF-04 (*"...retornar un evento normalizado si la firma es válida"*): no tiene ninguna inconsistencia, ya describía exactamente lo que `WebhookEvent` implementa (ver punto 6); no requiere ningún cambio de texto.

**Decisión:** Los 6 valores en inglés (`APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED`, `ERROR`) son los correctos, porque coinciden en tres artefactos independientes (código, sección 15.1 y ADR-03) contra uno solo (RF-03).

**Estado:** Pendiente en el SAD. Reemplazar en RF-03 la frase "PENDIENTE, APROBADO, RECHAZADO, EXPIRADO o ERROR" por "APPROVED, DECLINED, PENDING, EXPIRED, VOIDED o ERROR".

## 15. Transición de la cuarta pasarela: PayU a Rapyd

**Responsables de corregirlo en el SAD:** Joshua (secciones 1, 7, 8, 9 y `Component Diagram - C4.png` del SDK), Henao (`Domain Class Diagram.png`), David (Restricciones, Riesgo técnico, Glosario), Joan (ADR, si documentan el vocabulario nativo de PayU).

**Encontrado:** Rapyd completó la compra de la operación de PayU en Latinoamérica (y África) en marzo de 2025. Desde 2026, el registro de un comercio nuevo en Colombia ya no otorga acceso a la API clásica de PayU (`apiLogin`/`apiKey`, autenticación por body, firma MD5/SHA-256 sobre `apiKey~merchantId~referenceCode~amount~currency~estado`), sino únicamente credenciales de Rapyd Collect (`access_key`/`secret_key`, firma de webhook `Base64(HMAC-SHA256(url_path + salt + timestamp + access_key + secret_key + body_string))`). Esto no es un cambio de nombre cosmético: el modelo de autenticación y el algoritmo de firma son distintos entre ambas pasarelas.

El nombre "PayU" aparece explícitamente en el SAD en, al menos, los siguientes puntos confirmados:
- Sección 1.2: "cuatro proveedores principales (Wompi, PayU, Mercado Pago y Kushki)".
- Sección 7.1.3: párrafo completo describiendo la autenticación y firma de "PayU Latam".
- Sección 7.2.4: "las pasarelas reales (Wompi, PayU, Mercado Pago y Kushki)".
- Sección 8.1.1: "cuatro adaptadores... Wompi, PayU, Mercado Pago y Kushki" y "Adaptador Wompi, Adaptador PayU, Adaptador Mercado Pago y Adaptador Kushki".
- Sección 9.1.3 (Gateway Factory): "el enum Gateway, con valores WOMPI, PAYU, MERCADOPAGO o KUSHKI".
- Sección 9.1.5: título "Wompi Adapter, PayU Adapter, Mercado Pago Adapter y Kushki Adapter" y su contenido ("Los adaptadores de PayU, Mercado Pago y Kushki tienen el mismo nivel de completitud funcional...").
- Sección 9.1.7 (Webhook Verifier) y 9.2.4 (Signature Generator): "Para PayU, Mercado Pago y Kushki se implementa la verificación/firma con el algoritmo correspondiente, MD5/SHA-256...".
- Sección 9.2.3 (Gateway Mock Factory): "PayUMockFactory".
- `Component Diagram - C4.png` (SDK): etiqueta explícitamente "PayU Adapter", "Traduce a PayU (Body auth, MD5/SHA)" y "PayU API — Latam Sandbox".
- `Domain Class Diagram.png`: el enum `Gateway` lista "WOMPI, PAYU, MERCADOPAGO, KUSHKI".

**Decisión:** Renombrar la cuarta pasarela de PayU a Rapyd en todo el SAD, incluyendo ambos diagramas de imagen. En el repositorio ya se aplicó el renombrado mecánico en `architecture-explained.md`, `layers-and-components.md`, `setup-and-structure.md`, `methodology.md` y el diagrama `Hexagonal architecture class diagram.png` (regenerado desde su fuente PlantUML). El código del SDK (`sdk/src/domain/value-objects/Gateway.ts`, que hoy define `PAYU = "PAYU"`, y la rama `case Gateway.PAYU` de `WebhookVerifier.ts` con su algoritmo de firma de PayU, ya implementado y con pruebas pasando desde la Iteración 1) **no se tocó todavía**: cambiarlo ahora significaría renombrar un símbolo sin tener lista la lógica real de Rapyd que debe reemplazarlo, dejando código con el nombre correcto pero el comportamiento equivocado. Ese cambio de código queda condicionado al issue de investigación del contrato de Rapyd Collect (ver más abajo), no a este punto de documentación.

`ubiquitous-language.md` no se corrigió como parte de este renombrado mecánico porque sus ~30 menciones de "PayU" eran la columna completa de mapeo de campos contra la API clásica de PayU (solicitud de pago, webhook, consulta de estado, catálogo de errores); reemplazar solo la palabra habría dejado contenido técnico falso. Ese archivo requería el mismo nivel de investigación de campo que ya se había hecho para Wompi, Mercado Pago y Kushki, sobre la API real de Rapyd Collect/Checkout. Esa investigación se hizo en el issue [#23](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/23) contra `docs.rapyd.net`: la columna "PayU Latam" fue reemplazada por "Rapyd" en las cuatro tablas y en el apéndice del enum de estados, con la fórmula real de firma (de request y de webhook, que son distintas entre sí), los endpoints de creación/consulta de pago, los tres tipos de webhook (`PAYMENT_SUCCEEDED`/`PAYMENT_COMPLETED`/`PAYMENT_FAILED`) y el formato de error. Quedaron explícitamente marcados como `⚠️ PENDIENTE` los campos que Rapyd modela de forma dinámica por método de pago (identidad del pagador para `co_pse_bank`) y que requieren credenciales de sandbox reales para confirmarse (ver issue [#14](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/14)), y el criterio exacto para distinguir `DECLINED` de `ERROR` dentro del único valor de estado `"ERR"` que Rapyd usa para ambos casos.

**Estado:** Pendiente en el SAD (todas las menciones listadas arriba). **Resuelto en `ubiquitous-language.md`** (columna Rapyd documentada, issue #23 cerrado). El diagrama `Component Diagram - C4.png` del SDK y el `Domain Class Diagram.png` no tienen fuente PlantUML en el repositorio, por lo que deben corregirse manualmente por sus respectivos dueños (Joshua y Henao) con la herramienta con la que se crearon originalmente. El código de `WebhookVerifier.ts` (rama `case Gateway.PAYU`) sigue sin migrarse a Rapyd: ese cambio se hace en la Iteración 2, ahora que ya existe la fórmula real de firma para implementarlo correctamente.
