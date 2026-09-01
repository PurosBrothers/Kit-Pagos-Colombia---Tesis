# Registro de arquitectura: decisiones, inconsistencias y pendientes

> **Nota de historial:** este archivo se llamaba `sad-inconsistencies.md`. Se renombró y
> reorganizó porque su contenido creció más allá de lo que ese nombre prometía; ver la nota al
> final del documento para el detalle del cambio. Los números de cada punto (`punto 1`, `punto
> 15`, etc.) **no cambiaron**, para no romper las referencias que ya existen en comentarios de
> código, pruebas y diagramas.

Este documento registra tres tipos de contenido relacionado con la arquitectura del proyecto,
separados en secciones:

- **Sección A:** quién es responsable de corregir cada sección del SAD original (`.docx`), como
  punto de partida para todo lo demás.
- **Sección B:** discrepancias encontradas entre las distintas secciones y diagramas del
  Software Architecture Document (SAD), y entre el SAD y el código del repositorio.
- **Sección C:** decisiones técnicas de investigación tomadas durante el proyecto (principalmente
  la migración de PayU a Rapyd), documentadas con su contexto, alternativas y consecuencias, al
  estilo de un ADR informal.
- **Sección D:** seguimiento de qué diagramas del SAD están obsoletos y cuáles ya se
  regeneraron.
- **Sección E:** deuda de documentación y configuración del repositorio que no corresponde a
  ninguna sección específica del SAD.

El SAD en sí (el archivo `.docx` en Google Drive) sigue siendo la fuente única de verdad del
proyecto, pero varios de sus artefactos se redactaron en momentos distintos y no se sincronizaron
entre ellos. Este archivo existe para que esas correcciones no se pierdan y se puedan aplicar
directamente sobre el documento original.

Cada punto indica su estado: **Resuelto** (ya se decidió y se aplicó en el código y en
`layers-and-components.md`) o **Pendiente en el SAD** (la decisión ya se tomó, pero falta
corregir el texto o los diagramas del documento original, algo que este agente no puede editar
directamente porque vive fuera del repositorio).

---

## Sección A — Responsables por sección del SAD (Iteración 0)

Antes de empezar a implementar nada de la primera iteración de código, cada corrección pendiente en el documento original debe quedar asignada a quien redactó esa sección, según la división de trabajo del equipo:

| # | Sección del SAD | Responsable | Correcciones pendientes encontradas en este documento |
|---|---|---|---|
| 1 | Introducción | Joshua | La sección 1.2 ya dice Apache 2.0 correctamente (ver punto 12, que era un error solo en el código). **Punto 15:** en 1.2, cambiar "Wompi, PayU, Mercado Pago y Kushki" por "Wompi, Rapyd, Mercado Pago y Kushki". |
| 2 | Requisitos funcionales | Joan | Punto 14: corregir RF-03 para que use los mismos seis valores que el enum `TransactionStatus` implementado (`APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED`, `ERROR`), en vez de la lista en español que tiene hoy. RF-04 no requiere ningún cambio de texto. **Punto 15:** ninguna RF nombra "PayU" explícitamente, no requiere corrección por este punto. |
| 3 | Modelo de dominio | Henao | Punto 2 (`SdkError` del diagrama de clases), punto 3 (quitar `updateStatus()` del diagrama, es inmutable), punto 6 (agregar `WebhookEvent` a la tabla de conceptos), **y punto 13 (falta por completo el modelo de dominio de la API de Simulación)**. **Punto 15:** en `Domain Class Diagram.png`, el enum `Gateway` lista "WOMPI, PAYU, MERCADOPAGO, KUSHKI"; cambiar "PAYU" por "RAPYD". Esta imagen no tiene fuente PlantUML en el repo, se corrige manualmente con la herramienta original. |
| 4 | Stakeholders | Henao | Ninguna encontrada. |
| 5 | ASR | Joan | Ninguna encontrada. |
| 6 | Restricciones | David | **Punto 15:** revisar si esta sección menciona términos específicos de la API de PayU (`apiLogin`/`apiKey`, MD5) como restricción técnica; de ser así, actualizar a los términos de Rapyd (`access_key`/`secret_key`) o señalar explícitamente que el contrato de Rapyd está pendiente de investigación (ver punto 19 para el detalle de qué sigue pendiente). |
| 7 | Contexto y Alcance | Joshua | **Punto 15:** en 7.1.3, reemplazar el párrafo completo sobre "PayU Latam" (autenticación por body, firma MD5/SHA-256) por uno equivalente sobre Rapyd (autenticación `access_key`/`secret_key`, firma de webhook `Base64(HMAC-SHA256(url_path + salt + timestamp + access_key + secret_key + body_string))`); en 7.2.4, cambiar "Wompi, PayU, Mercado Pago y Kushki" por "Wompi, Rapyd, Mercado Pago y Kushki". |
| 8 | Vista de contenedores | Joshua | Punto 5: en 8.1 y 8.2, cambiar toda mención de "Railway" por "Render" (el diagrama ya quedó corregido en el punto 17, solo falta el texto). **Punto 15:** en 8.1.1, cambiar "Wompi, PayU, Mercado Pago y Kushki" y "Adaptador Wompi, Adaptador PayU, Adaptador Mercado Pago y Adaptador Kushki" por sus equivalentes con Rapyd. **Punto 17:** reemplazar las figuras de `Container Diagram - C4.png` (SDK y API de Simulación) y `Context Diagram - C4.png` (SDK y API de Simulación) por las versiones regeneradas. |
| 9 | Vista de componentes | Joshua | **Punto 15:** en 9.1.3, cambiar los valores del enum `Gateway` de "WOMPI, PAYU, MERCADOPAGO o KUSHKI" a "WOMPI, RAPYD, MERCADOPAGO o KUSHKI"; renombrar el título 9.1.5 y su contenido ("PayU Adapter" → "Rapyd Adapter"); en 9.1.7 y 9.2.4, actualizar la mención "Para PayU, Mercado Pago y Kushki se implementa..." con el algoritmo real de Rapyd; en 9.2.3, renombrar "PayUMockFactory" a "RapydMockFactory". En `Component Diagram - C4.png` **del SDK**, corregir las etiquetas "PayU Adapter", "Traduce a PayU (Body auth, MD5/SHA)" y "PayU API — Latam Sandbox". Esta imagen no tiene fuente PlantUML en el repo, se corrige manualmente. **Punto 17:** reemplazar `Component Diagram - C4.png` **de la API de Simulación** por la versión regenerada (esta sí tiene fuente PlantUML nueva). |
| 10 | Vista de procesos | David | Punto 7 (reemplazar las Figuras 8, 9 y 10 por los diagramas de secuencia regenerados, y corregir el texto de 10.1.1 que menciona `KitPagosFacade`). **Punto 17:** si esta sección también embebe los 4 diagramas de secuencia de la API de Simulación (pago exitoso, pago denegado, error de red, notificación webhook), reemplazarlos por las versiones regeneradas; corrigen contenido técnico obsoleto de PayU, no solo el nombre. |
| 11 | Vista física | Joan | Ninguna encontrada (ya quedó correcta con Render). |
| 12 | Modelo de datos | Henao | Ninguna encontrada. |
| 13 | ADR | Joan | Punto 7: la sección 13.1 sí referencia el `Hexagonal architecture class diagram.png` por nombre ("el Diagrama de Clases de la Arquitectura Hexagonal"), confirmado por el propio texto. Reemplazar la imagen embebida por la versión regenerada, y agregarle un número de figura ("Figura N"), ya que hoy es el único diagrama del documento sin ese rótulo, a diferencia del resto de figuras citadas en la sección 13. **Punto 15:** revisar si algún ADR de esta sección documenta el vocabulario nativo de PayU (`state_pol`, la particularidad de que PayU siempre devuelve HTTP 200) y corregirlo o marcarlo como pendiente de la investigación de Rapyd. |
| 14 | Riesgo técnico | David | Punto 10 (falta framework de pruebas en `simulator-api`, ya resuelto vía issue #6) es un riesgo de calidad que vale la pena registrar ahí, aunque no sea una inconsistencia de redacción. **Punto 15:** registrar la transición de PayU a Rapyd como un riesgo ya materializado (cambio de proveedor externo fuera de control del equipo, que invalidó documentación e implementación ya hecha del algoritmo de firma). |
| 15 | Estructura del Sistema | David | Punto 1 (corregir nombres de métodos en 15.2 a `getPaymentStatus`/`validateWebhook`), punto 3 (aclarar que la reconciliación reconstruye la entidad), punto 6 (aclarar que `WebhookVerifier` tiene dos métodos públicos, no uno). |
| 16 | Glosario | David | **Punto 15:** si la definición de `Gateway`/`Adapter` usa a PayU como ejemplo, reemplazarlo por Rapyd, y agregar una nota breve sobre la adquisición de PayU por Rapyd para que el lector entienda por qué cambió el nombre. |

Los puntos 4, 8, 9, 11 y 12 de la Sección B, y toda la Sección E, no corresponden a ninguna de las 16 secciones del SAD (son documentos de repositorio o decisiones de código ya resueltas), así que no tienen un responsable de esta lista; se dejan como tareas de ingeniería general para la primera iteración.

---

## Sección B — Inconsistencias entre el SAD y el código

### 1. Nombres de los tres métodos públicos del facade

**Responsable de corregirlo en el SAD:** David (sección 15.2).

**Encontrado:** El `Component Diagram - C4.png` del SDK y la sección 9.1.1 usan `createPayment()`, `getPaymentStatus()`, `validateWebhook()`. La sección 15.2 usa `createPayment(request)`, `getStatus(id)`, `verifyWebhook(payload, headers)`. El diagrama `Hexagonal architecture class diagram.png` (obsoleto, ver punto 7) usa `processWebhook()`.

**Decisión:** Se adopta la versión que coincide en más artefactos: `createPayment()`, `getPaymentStatus()`, `validateWebhook()`.

**Estado:** Resuelto en código (`KitPagos.ts`) y en `layers-and-components.md`. **Pendiente en el SAD:** corregir la sección 15.2 para que use estos mismos nombres.

### 2. Forma de la clase `SdkError`

**Responsable de corregirlo en el SAD:** Henao (sección 3, `Domain Class Diagram.png`).

**Encontrado:** El `Domain Class Diagram.png` muestra `SdkError` con `friendlyMessage`, `httpStatus`, `originalError` y `requestId`, además de `code` y `gateway`. La sección 15.1 solo define `code`, `gateway` y `originalPayload`.

**Decisión:** Se mantiene la versión de la sección 15.1 (`code`, `gateway`, `originalPayload`), ya implementada.

**Estado:** Resuelto en código. **Pendiente en el SAD:** corregir el `Domain Class Diagram.png` para que coincida con la sección 15.1, o justificar explícitamente por qué la clase real necesita los campos adicionales (si el equipo decide que sí los necesita más adelante, esta decisión debe revisarse).

### 3. Mutabilidad de `Transaction` y campo `authorizationCode`

**Responsable de corregirlo en el SAD:** Henao (diagrama, sección 3) y David (aclaración textual, sección 15.1).

**Encontrado:** El `Domain Class Diagram.png` muestra un método `updateStatus(...)` en `Transaction`, lo que sugiere una entidad mutable. La sección 9.1.8 menciona explícitamente el atributo `authorizationCode`, que no estaba implementado.

**Decisión:** `Transaction` se mantiene inmutable. Cuando llega un webhook de conciliación, el `Response Normalizer` construye una instancia nueva en lugar de mutar la existente. El campo `authorizationCode` sí se incorpora, como atributo opcional fijado en el constructor.

**Estado:** Resuelto en código. **Pendiente en el SAD:** quitar el método `updateStatus(...)` del `Domain Class Diagram.png` y aclarar en la sección 15.1 que la reconciliación por webhook se resuelve reconstruyendo la entidad, no mutándola.

### 4. Mayúsculas y minúsculas en el enum `Gateway`

**Responsable de corregirlo en el SAD:** Nadie, no requiere acción sobre el documento (ver estado).

**Encontrado:** `Gateway.ts` se implementó con valores en minúscula (`"wompi"`, `"payu"`, ...), mientras que `TransactionStatus`, `RejectionCategory` y `SdkErrorCode` usan mayúsculas, y el `Domain Class Diagram.png` muestra `WOMPI`, `PAYU`, `MERCADOPAGO`, `KUSHKI`.

**Decisión:** Se corrige `Gateway.ts` a mayúsculas para mantener consistencia con el resto del vocabulario normalizado del dominio.

**Estado:** Resuelto en código. No requiere cambios en el SAD, ya que el diagrama ya estaba correcto; el error estaba solo en la implementación.

### 5. Plataforma de despliegue de la API de Simulación: Railway vs. Render

**Responsable de corregirlo en el SAD:** Joshua (secciones 8.1 y 8.2).

**Encontrado:** Las secciones 8.1 y 8.2 (Vista de contenedores) afirman que la API de Simulación está desplegada en **Railway**. La sección 11.2 (Vista física, redactada en una sesión posterior de este mismo proyecto) dice **Render**, y las credenciales reales del equipo (`.env.example`) confirman Render. Se verificó además `Container Diagram - C4.png` de la API de Simulación: la etiqueta del contenedor "API de Simulación Desplegada" dice literalmente *"Railway o Render — URL pública HTTPS"*, es decir que ni siquiera el propio diagrama se decide entre las dos opciones.

**Decisión:** Render es la plataforma correcta.

**Estado:** Resuelto en el diagrama (punto 17): el `Container Diagram - C4.png` y el `Deploy Diagram - C4.png` regenerados de la API de Simulación ya dicen únicamente "Render", sin ambigüedad. **Pendiente en el SAD (texto):**
1. Sección 8.1: reemplazar "Railway" por "Render" en el texto.
2. Sección 8.2: mismo reemplazo.

### 6. Concepto `WebhookEvent` para satisfacer RF-04

**Responsable de corregirlo en el SAD:** Henao (tabla de conceptos, sección 3) y David (sección 15.1). RF-04 (sección 2, dueña Joan) ya está redactado con precisión y no requiere cambios; ver punto 14.

**Encontrado:** RF-04 exige que la validación de un webhook "retorne un evento normalizado" cuando la firma es válida. Ni la sección 9.1.7 ni la 15.1 definen ese evento; `WebhookVerifier` solo tenía `verify(...): boolean`. El único artefacto que mencionaba un `WebhookEvent` con `parseWebhook(): WebhookEvent` era el diagrama obsoleto del punto 7.

**Decisión:** Se reintroduce `WebhookEvent` como concepto vigente del dominio. `WebhookVerifier` gana un segundo método público, `parse(payload, gateway): WebhookEvent`, y `KitPagos.validateWebhook(payload, headers)` ahora retorna `WebhookEvent` en lugar de `boolean`.

**Estado:** Resuelto en código. **Pendiente en el SAD:** agregar `WebhookEvent` a la tabla de conceptos del dominio (sección 3) y actualizar la sección 15.1 para reflejar que `WebhookVerifier` ya no tiene un único método público, sino dos (`verify` y `parse`).

### 14. RF-03 usa nombres de estado en español, distintos del enum implementado

**Responsable de corregirlo en el SAD:** Joan (sección 2, Tabla 1).

**Encontrado:** RF-03 dice: *"El sistema debe permitir consultar el estado de una transacción por identificador y retornarlo mapeado a los estados normalizados: PENDIENTE, APROBADO, RECHAZADO, EXPIRADO o ERROR."* Son 5 estados en español. El enum `TransactionStatus` implementado (`sdk/src/domain/value-objects/TransactionStatus.ts`), la sección 15.1, el ADR-03 (13.3) y el `Domain Class Diagram.png` coinciden entre sí en 6 valores, en inglés y mayúsculas: `APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED`, `ERROR`. RF-03 además omite `VOIDED` por completo.

De paso se revisó RF-04 (*"...retornar un evento normalizado si la firma es válida"*): no tiene ninguna inconsistencia, ya describía exactamente lo que `WebhookEvent` implementa (ver punto 6); no requiere ningún cambio de texto.

**Decisión:** Los 6 valores en inglés (`APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED`, `ERROR`) son los correctos, porque coinciden en tres artefactos independientes (código, sección 15.1 y ADR-03) contra uno solo (RF-03).

**Estado:** Pendiente en el SAD. Reemplazar en RF-03 la frase "PENDIENTE, APROBADO, RECHAZADO, EXPIRADO o ERROR" por "APPROVED, DECLINED, PENDING, EXPIRED, VOIDED o ERROR".

---

## Sección C — Decisiones técnicas: migración PayU → Rapyd

### 15. Migración Rapyd / PayU GPO — Cambio de algoritmo de firma y renombrado del enum

**Responsable de corregirlo en el SAD:** David (sección 15, WebhookVerifier) y Joshua (sección 7, Contexto; sección 16, Glosario).

**Contexto:** Rapyd completó la adquisición de PayU GPO en América Latina el 14 de marzo de 2025
(fuente: https://www.rapyd.net/es/). La API de procesamiento continúa en `api.payulatam.com`
durante el período de transición, pero el mecanismo de autenticación de **webhooks** cambia
completamente.

**Encontrado — tres impactos concretos:**

1. **Algoritmo de firma de webhooks (impacto en código):** El algoritmo previo de PayU era
   MD5/SHA-256 sobre el body `x-www-form-urlencoded` (`apiKey~merchantId~referenceCode~...`). El
   nuevo algoritmo de Rapyd es HMAC-SHA256 con resultado en Base64, enviado en el **header**
   `signature`, no en el body. Cadena de firma:
   `url_path + salt + timestamp + access_key + secret_key + body_string`.
   Fuente: https://docs.rapyd.net/en/webhook-authentication.html

2. **Headers de Rapyd (impacto en tabla de la sección 15.1):** La tabla de headers del SAD para
   `Gateway.PAYU` indicaba `null` (firma en body). Con Rapyd, los headers relevantes son
   `access_key`, `salt`, `signature` y `timestamp`. El campo `signature` reemplaza al campo
   `sign` del body.

3. **Enum `Gateway` (impacto en código y glosario):** El valor `PAYU = "PAYU"` fue renombrado a
   `RAPYD = "RAPYD"` en `sdk/src/domain/value-objects/Gateway.ts` para reflejar la nueva marca.
   El adaptador de infraestructura pasó de `PayUAdapter.ts` a `RapydAdapter.ts`.

**Decisión tomada:**

- **Opción A (aplicada):** Reemplazar directamente el algoritmo de firma por el de Rapyd. No se
  implementa dual-mode MD5/Rapyd porque añadiría complejidad WMC/CBO innecesaria en el período
  de transición, y los webhooks nuevos ya usan el formato Rapyd.
- El parámetro `url_path` (que no viaja en los headers de Rapyd) se inyecta como header
  sintético `x-webhook-url` por el middleware del comercio antes de llamar a `verify()`. Debe
  contener la URL completa configurada en el panel de Rapyd, no un path relativo (aclarado en
  el punto 16, tras una imprecisión inicial en el nombre y la descripción del header).
- El bloque `parse()` para `Gateway.RAPYD` conservó inicialmente el formato `URLSearchParams` con
  `state_pol`, bajo la suposición de que la **estructura del payload de notificación** de la API
  PayU/Rapyd no había cambiado durante la transición. Esa suposición no tenía cita y resultó ser
  incorrecta: la investigación de campo del issue #23 (documentada en `ubiquitous-language.md`)
  confirmó que Rapyd envía un webhook JSON con forma completamente distinta. Corregido en el
  punto 16.

**Estado:** Resuelto en código (`Gateway.ts`, `WebhookVerifier.ts`, `WebhookVerifier.test.ts`) y
en documentación (`ubiquitous-language.md`, `layers-and-components.md`, `architecture-explained.md`),
con la excepción del formato de `parse()` descrita arriba, corregida por separado en el punto 16.
**Pendiente en el SAD:** actualizar sección 15.1 (tabla de headers de WebhookVerifier), sección 7
(contexto de pasarelas), y sección 16 (glosario: entrada "PayU" debe actualizarse a
"Rapyd / PayU GPO").

### 16. `WebhookVerifier.parse()` para `Gateway.RAPYD` usaba el formato de notificación de PayU sin cita

**Responsable de corregirlo en el SAD:** David (sección 15, WebhookVerifier).

**Contexto:** El punto 15 documentó correctamente la migración del algoritmo de **firma** de
webhooks de PayU a Rapyd (HMAC-SHA256 en el header `signature`), pero dejó sin tocar el método
`parse()`, que sigue construyendo el evento normalizado a partir de `URLSearchParams` con el
campo `state_pol`, el formato clásico de notificación de PayU. El comentario que acompañaba ese
código afirmaba que "la estructura del payload de notificación no ha cambiado aún", sin ninguna
fuente que lo respaldara.

**Encontrado:** La investigación de campo del issue #23, ya documentada en
`ubiquitous-language.md` (sección 2, columna "Rapyd Nativo"), muestra que Rapyd envía un webhook
JSON con forma completamente distinta a la de PayU: un campo raíz `type` (`PAYMENT_SUCCEEDED` |
`PAYMENT_COMPLETED` | `PAYMENT_FAILED`) y un objeto `data` con `id`, `status` (`ACT` | `CLO` |
`ERR`) y `paid`. La suposición del código nunca se validó contra esa investigación, a pesar de
que ambas conviven en el mismo repositorio desde el cierre del issue #23.

De paso se encontró una segunda imprecisión, más pequeña, en `verify()`: el comentario describía
el parámetro `url_path` de la fórmula de firma como "el path del endpoint receptor" (ej.
`/webhooks/rapyd`), cuando la documentación de Rapyd exige la **URL completa** configurada en el
panel de webhooks (protocolo, dominio y path). El algoritmo de firma en sí ya era el correcto;
solo la semántica de ese parámetro estaba mal descrita, y el header sintético que lo transportaba
se renombró de `x-webhook-url-path` a `x-webhook-url` para reflejarlo.

**Decisión tomada:**

- `parse()` para `Gateway.RAPYD` ahora lee `type` y `data.id`/`data.status`, con el mapeo
  `PAYMENT_COMPLETED → APPROVED`, `PAYMENT_SUCCEEDED → PENDING`, cualquier otro valor → `ERROR`.
- El caso `PAYMENT_FAILED` se deja deliberadamente sin resolver del todo: Rapyd no distingue ahí
  un rechazo de negocio (`DECLINED`) de un fallo técnico (`ERROR`); ambos viajan mezclados en
  `data.failure_code`. Separarlos requiere el catálogo completo de `failure_code`, que solo se
  puede obtener disparando escenarios reales contra un sandbox de Rapyd. Mientras tanto se usa
  `ERROR` como valor conservador, con un comentario `TODO` en el código citando este punto. No se
  crea un issue de seguimiento todavía; se retoma al iniciar la Iteración 2, cuando se reparta el
  trabajo de `RapydAdapter`.
- `WebhookVerifier.test.ts` se reescribió para probar el payload JSON real de Rapyd en vez del
  formato de PayU, tanto en `verify()` como en `parse()`.

**Estado:** Resuelto en código (`WebhookVerifier.ts`, `WebhookVerifier.test.ts`) y en
`.env.example` (variables `PAYU_*` renombradas a `RAPYD_*`, alineadas al modelo de credenciales
`access_key`/`secret_key` de Rapyd en vez del modelo `apiKey`/`apiLogin` de PayU).

**Actualización:** el mapeo fino de `PAYMENT_FAILED` (`DECLINED` vs. `ERROR`) descrito arriba
como pendiente ya se resolvió, ver punto 18. Sigue pendiente la actualización de sección 15.1
del SAD para reflejar el nuevo comentario de `url_path`.

### 18. Investigación completa del comportamiento de errores y estados finales de Rapyd

**Contexto:** El punto 16 dejó pendiente el mapeo fino de `PAYMENT_FAILED` (`DECLINED` vs.
`ERROR`) porque se creía que requería credenciales de sandbox reales. Se investigó a fondo la
documentación pública de Rapyd (`docs.rapyd.net`) y se encontró suficiente información para
resolverlo sin sandbox, además de otros dos puntos marcados `⚠️ PENDIENTE` en
`ubiquitous-language.md`.

**Encontrado y resuelto:**

1. **Desambiguación `DECLINED` vs. `ERROR` en `PAYMENT_FAILED`:** confirmado contra
   `docs.rapyd.net/en/error-messages.html` y `docs.rapyd.net/en/card-network-errors.html`. Un
   `failure_code`/`error_code` con el prefijo `ERROR_PROCESSING_CARD` (ej.
   `ERROR_PROCESSING_CARD - [51]` = fondos insuficientes) es un rechazo del procesador de
   tarjeta → `TransactionStatus.DECLINED`. Cualquier otro `error_code` (ej.
   `MISSING_AUTHENTICATION_HEADERS`) es un fallo de validación o infraestructura previo al
   intento de cobro → `SdkErrorCode.*` / `ERROR`. Implementado en `WebhookVerifier.parse()`.
2. **`EstadoTransaccion.EXPIRED` para Rapyd:** confirmado contra
   `docs.rapyd.net/en/payment-expired-webhook.html`. Rapyd sí dispara un webhook explícito,
   `type: "PAYMENT_EXPIRED"`, con `data.status: "EXP"`, cuando el cliente no completa el pago a
   tiempo. Ya no requiere polling como se sospechaba. Implementado en `WebhookVerifier.parse()`.
3. **`EstadoTransaccion.VOIDED` para Rapyd:** confirmado contra
   `docs.rapyd.net/en/payment-canceled-webhook.html`. El estado nativo es `"CAN"` (se sospechaba
   sin confirmar) y el webhook correspondiente es `type: "PAYMENT_CANCELED"`, disparado solo
   para pagos cancelables vía el método Cancel Payment. Implementado en `WebhookVerifier.parse()`.
4. **Confirmación adicional (sin cambios, solo validación):** se confirmó independientemente que
   Rapyd sí devuelve códigos HTTP diferenciados (`200`/`400`/`401`, ver `docs.rapyd.net/en/list-payments.html`
   y `docs.rapyd.net/en/pay-an-order.html`), a diferencia de PayU y Kushki que siempre devuelven
   `200`. Esto ya estaba correctamente documentado en `ubiquitous-language.md` desde la
   investigación del issue #23; solo faltaba corregir la nota equivalente en
   `Sequence Diagram - Network Error.png` de la API de Simulación (ver punto 17), que todavía
   asumía que Rapyd se comporta igual que PayU/Kushki en este aspecto.

**Cambios realizados:** `sdk/src/domain/services/WebhookVerifier.ts` (nuevos casos
`PAYMENT_EXPIRED` → `EXPIRED`, `PAYMENT_CANCELED` → `VOIDED`, y desambiguación de
`PAYMENT_FAILED` por prefijo de `failure_code`), `WebhookVerifier.test.ts` (2 pruebas nuevas para
los estados agregados, y las pruebas de rechazo divididas en un caso `DECLINED` por tarjeta y un
caso `ERROR` técnico), y `ubiquitous-language.md` (se quitaron las 3 marcas `⚠️ PENDIENTE`
resueltas, en la fila de `status`, en el Apéndice de `EstadoTransaccion`, y en la alerta de
Rapyd).

**Estado:** Resuelto. Quedaba pendiente un último punto de Rapyd, resuelto parcialmente en el
punto 19: los campos de identidad del pagador para PSE Colombia.

### 19. PSE Colombia en Rapyd no es un único `payment_method_type`, sino uno por banco

**Responsable de corregirlo en el SAD:** Henao (sección 3, si el modelo de dominio detalla el
contrato del futuro `RapydAdapter`) y David (sección 6, si las restricciones mencionan `co_pse_bank`
como un identificador único).

**Contexto:** `ubiquitous-language.md` y el punto 18 asumían que existía un único identificador
`co_pse_bank` para PSE, pendiente de confirmar solo en el nombre de sus campos internos. Se
investigó a fondo la documentación pública de Rapyd para intentar cerrar ese pendiente sin
sandbox, y se encontró que la premisa de origen era incorrecta, no solo incompleta.

**Encontrado:** `docs.rapyd.net/en/get-payment-method-required-fields.html` incluye un ejemplo
real y citable de un método de pago bancario colombiano: `co_bbva_colombia_bank` (BBVA Colombia).
Esto, sumado a la regla de nomenclatura documentada en `docs.rapyd.net/en/payment-method-type.html`
(prefijo de país + sufijo de categoría, ej. `ee_mastercard_card`) y a un segundo ejemplo
colombiano encontrado en la misma página (`co_efecty_cash`, para la red de pago en efectivo
Efecty), confirma que Rapyd no expone PSE como un solo método agregador, sino como una familia de
métodos `co_{banco}_bank`, uno por cada banco colombiano afiliado a la red PSE. El catálogo
completo de bancos disponibles (y por tanto cuántos `co_{banco}_bank` existen) solo se puede
obtener con `GET /v1/payment_methods/countries/CO` (`List Payment Methods by Country`) y
credenciales de sandbox reales; no hay una lista estática publicada.

**Decisión tomada:** se corrigió `ubiquitous-language.md` (filas `payerEmail` y `payerDocument`,
nota de integridad y nota final) para reflejar la familia `co_{banco}_bank` en vez del supuesto
`co_pse_bank` único. Se documentó explícitamente que el ejemplo de respuesta que la propia
documentación de Rapyd muestra para `co_bbva_colombia_bank` (`number_type`, `tavv`) corresponde a
campos de tokenización de tarjeta, no a campos de redirección bancaria — es evidencia de que ese
ejemplo puntual es una plantilla genérica reutilizada por error en la documentación oficial de
Rapyd entre distintos tipos de método de pago, así que no debe copiarse como el esquema real de
campos de este método.

**Estado:** Resuelto en documentación. **Sigue sin poder confirmarse sin sandbox real:** (a) la
lista completa de bancos colombianos afiliados a PSE dentro de Rapyd, y (b) el esquema exacto de
campos de identidad del pagador (`payerDocument`) que exige cada uno vía
`GET /v1/payment_methods/{type}/required_fields`. Ninguno de los dos es un vacío de investigación
por falta de esfuerzo: es una limitación real de la documentación pública de Rapyd, que delega
ese descubrimiento a llamadas dinámicas contra la cuenta del comerciante. No se crea un issue de
seguimiento todavía; se retoma cuando el equipo tenga credenciales de sandbox de Rapyd (mismo
punto de partida que el `RapydAdapter` en general).

---

## Sección D — Diagramas: seguimiento de regeneración

### 7. Diagramas obsoletos: capa de Use Cases y Controller

**Responsable de corregirlo en el SAD:** David (Figuras 8, 9 y 10 de la sección 10, y el texto de 10.1.1) y Joan (el `Hexagonal architecture class diagram.png`, ver sección 13.1).

**Encontrado:** `Hexagonal architecture class diagram.png` y los tres diagramas de secuencia del SDK (`Sequence Diagram - Payment Creation.png`, `Sequence Diagram - Synchronous Payment.png`, `Sequence Diagram - Webhook Conciliation.png`) están dibujados contra un diseño anterior que incluía `CrearPagoUseCase`, `ConsultarEstadoUseCase`, `ProcesarWebhookUseCase`, `WebhookController`, un `PaymentController` REST, y conceptos que no existen en ningún otro lado del SAD vigente (`Order` como raíz de agregado, `Money` en vez de `Amount`, `EstadoTransaccion` en vez de `TransactionStatus`, `RejectionInfo` en vez de `RejectionReason`, y un cuarto nombre para el facade, `KitPagosFacade`, usado solo en el texto de la sección 10.1.1). Se confirmó, releyendo la sección 13.1 (ADR-01), que el texto sí referencia el `Hexagonal architecture class diagram.png` por nombre: *"Esta organización puede verse en el Diagrama de Componentes del SDK y en el Diagrama de Clases de la Arquitectura Hexagona[l]"*. A diferencia de las Figuras 8, 9 y 10 (citadas como "Figura N" en la sección 10), este diagrama se menciona solo por nombre, sin número de figura asociado en ninguna parte del documento.

**Decisión:** Se regeneran los 4 diagramas para reflejar el diseño final (facade directo, sin capa explícita de Use Cases ni Controller), consistente con las secciones 9 y 15 y con el `Component Diagram - C4.png` y el `Domain Class Diagram.png` vigentes.

**Estado:** Resuelto (diagramas regenerados en esta misma sesión, ver `docs/architecture/SDK/`). **Pendiente en el SAD:**
1. David: reemplazar las Figuras 8, 9 y 10 de la sección 10 por las versiones nuevas, y corregir el texto de la sección 10.1.1 que todavía menciona `KitPagosFacade` (debe decir `KitPagos`).
2. Joan: reemplazar la imagen citada en la sección 13.1 por la versión regenerada de `Hexagonal architecture class diagram.png`, y asignarle un número de figura ("Figura N") para que quede referenciada igual que el resto de diagramas del documento.

### 17. Auditoría post-#32: diagramas de la API de Simulación seguían citando a PayU

**Contexto:** Tras mergear el PR #32 (punto 16), se hizo una auditoría completa del repositorio
para confirmar que la transición PayU → Rapyd quedó completa. El código (`WebhookVerifier.ts`,
`Gateway.ts`, `.env.example`) está limpio: las únicas menciones a "PayU" restantes en archivos de
texto son notas históricas deliberadas sobre la adquisición (14 mar 2025), no lógica activa.

**Encontrado (imágenes, no tienen fuente PlantUML en el repo):**

1. `docs/architecture/SDK/Hexagonal architecture class diagram.png`: el enum `Gateway` seguía
   listando "PAYU" aunque el resto del mismo diagrama ya usaba `RapydAdapter`. **Corregido**: sí
   tiene fuente (`diagrams-source/hexagonal-architecture-class-diagram.puml`), se editó el enum a
   `RAPYD` y se regeneró el PNG contra el servidor público de PlantUML.
2. `docs/architecture/SDK/Domain Class Diagram.png`: sigue mostrando "PAYU". Ya estaba trackeado
   en la fila 3 de la tabla de la Sección A (Henao) porque no tiene fuente editable en el repo; no se
   tocó aquí. **Corrección posterior:** `docs/architecture/SDK/Component Diagram - C4.png` sí se
   recreó como parte de este mismo punto 17 (tiene fuente nueva,
   `diagrams-source/component-diagram.puml`, con `RapydAdapter`/`RapydAPI`); la fila 9 de la
   tabla de la Sección A ya se actualizó para reflejarlo.
3. **Nuevo, no trackeado hasta ahora** — cuatro diagramas de `docs/architecture/Simulador API/`
   también citan "PayU" y tampoco tienen fuente PlantUML en el repo:
   - `Container Diagram - C4.png`: recuadro "Pasarelas Reales (Wompi · PayU · Mercado Pago ·
     Kushki)".
   - `Deploy Diagram - C4.png`: recuadro "API de Simulación" dice "Replica el comportamiento de
     Wompi, PayU, Mercado Pago y Kushki". Este mismo diagrama también arrastra el problema del
     punto 5 (Railway vs. Render) sin corregir: dice "Plataforma Cloud (Railway / Render)
     [Platform as a Service (pendiente decisión final)]", pese a que la decisión por Render ya
     está tomada y aplicada en `Container Diagram - C4.png`.
   - `Component Diagram - C4.png`: caja "Gateway Mock Factory" dice "Construye payloads JSON
     emulando Wompi, PayU, Mercado Pago y Kushki".
   - `Sequence Diagram - Successful Payment.png`: la nota junto a "Scenario Engine" cita el
     formato de respuesta nativo de cada pasarela para el escenario exitoso, incluyendo
     `PayU: transactionResponse.state="APPROVED" (state_pol "4")`. Esto no es solo una etiqueta:
     es el formato real de notificación de PayU, ya confirmado obsoleto por la investigación del
     issue #23 (Rapyd no usa `state_pol`, usa un webhook JSON con campo `type`). Requiere
     corrección de contenido, no solo de nombre.
   - `Sequence Diagram - Webhook Notification.png`: la nota final cita el mecanismo de firma de
     cada pasarela, incluyendo `PayU: campo sign (MD5/HMAC-SHA256); puede reenviar -> deduplicar
     por transaction_id`. También es contenido técnico obsoleto: Rapyd firma con HMAC-SHA256 en
     Base64 sobre el header `signature`, no con un campo `sign` en el body.

**Estado:** Resuelto. Se decidió usar PlantUML (mismo criterio ya usado para los 4 diagramas del
SDK regenerados en el punto 7) en vez de esperar la herramienta original. Se crearon fuentes
PlantUML nuevas, en `diagrams-source/`, para los 11 diagramas listados abajo, y se regeneraron
los 11 PNG contra el servidor público de PlantUML. De paso se corrigieron, con la misma
investigación del punto 18, los contenidos técnicos obsoletos señalados arriba (formato de
notificación de PayU en el diagrama de pago exitoso, campo `sign` en el de webhooks) y el
problema de Railway/Render pendiente en el Deploy Diagram, que ahora dice únicamente "Render".

**SDK** (`docs/architecture/SDK/diagrams-source/`):
- `context-diagram.puml`, `container-diagram.puml`, `component-diagram.puml` (nuevos).

**API de Simulación** (`docs/architecture/Simulador API/diagrams-source/`, carpeta nueva):
- `context-diagram.puml`, `container-diagram.puml`, `component-diagram.puml`, `deploy-diagram.puml`.
- `sequence-successful-payment.puml`, `sequence-denied-payment.puml`,
  `sequence-network-error.puml`, `sequence-webhook-notification.puml`.

**Nota sobre el Deploy Diagram:** se investigó a fondo el comportamiento HTTP real de Rapyd para
errores de red (ver punto 18 y `docs.rapyd.net`): a diferencia de PayU y Kushki, que suelen
responder `200 OK` con el error en el body, Rapyd sí usa códigos HTTP distintos de 2xx (`400`,
`401`, etc.) para errores de solicitud y autenticación. El `Sequence Diagram - Network Error`
regenerado documenta esta diferencia explícitamente en su nota final.

**Pendiente, fuera del alcance de este punto:** `docs/architecture/SDK/Domain Class Diagram.png`
y `docs/architecture/SDK/Component Diagram - C4.png` (SDK) siguen sin fuente PlantUML en el repo
y siguen mostrando "PAYU" / "PayU Adapter"; permanecen a cargo de Henao y Joshua respectivamente,
según la tabla de la Sección A (filas 3 y 9), para corregirse con la herramienta original
con la que se dibujaron.

**Pendiente en el SAD:** el documento original embebe versiones antiguas de estos 11 diagramas
(ver el mapeo de reemplazo completo entregado por chat, con la sección exacta del `.docx` para
cada figura). Cada responsable de sección (ver tabla de la Sección A) debe reemplazar la imagen
correspondiente por el PNG regenerado.

---

## Sección E — Deuda de documentación y configuración del repositorio

### 8. `setup-and-structure.md` desactualizado

**Responsable:** No corresponde a ninguna de las 16 secciones del SAD; es un documento de repositorio. Queda como tarea de ingeniería general sin dueño fijo hasta que el equipo lo asigne.

**Encontrado:** Este documento describe `domain/enums/EstadoTransaccion.ts`, `domain/interfaces/IIntencionPago.ts`, `domain/errors/ErrorNormalizado.ts` y el facade en `application/KitPagos.ts`. Ninguno de estos nombres ni rutas coincide con la estructura vigente (`domain/entities`, `domain/value-objects`, `domain/errors`, `domain/services`, `application/ports`, `infrastructure/facade/KitPagos.ts`).

**Estado:** Pendiente. Es el documento de arranque más antiguo del repositorio; se recomienda actualizarlo o marcarlo explícitamente como histórico y redirigir a `layers-and-components.md` como referencia vigente de estructura.

### 9. Archivo de imagen suelto dentro del código fuente

**Responsable:** No corresponde a ninguna sección del SAD; limpieza de repositorio, cualquiera puede resolverlo.

**Encontrado:** `sdk/src/Hexagonal.png` está ubicado dentro del árbol de código fuente del SDK, no en `docs/architecture/`.

**Estado:** Pendiente. Se recomienda moverlo a `docs/architecture/SDK/` o eliminarlo si es una copia duplicada, para que no quede empaquetado dentro del artefacto publicado a npm.

### 10. Sin framework de pruebas en `simulator-api`

**Responsable:** No corresponde a una sección de redacción del SAD, pero David (dueño de Riesgos técnicos, sección 14) debería registrarlo ahí como riesgo de calidad ya cerrado.

**Encontrado:** `sdk/package.json` ya tenía Jest configurado con un umbral de cobertura del 80%. `simulator-api/package.json` no tenía ningún framework de pruebas configurado, a pesar de que la API de Simulación es, según el propio SAD, el entorno principal de validación del proyecto durante la fase de evaluación.

**Estado:** Resuelto. El [issue #6](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/6) decidió Jest + `app.inject()` de Fastify (en vez de Jest + Supertest, ver desviación documentada frente al SPMP en el comentario de ese issue) y ya está implementado: `simulator-api/jest.config.js`, `simulator-api/test/health.test.ts` y el script `test` en `package.json`.

### 11. `ubiquitous-language.md` desalineado con la reestructuración del dominio

**Responsable:** No es una sección del SAD, pero su contenido mezcla dominio (Henao) y manejo de errores (David); si alguno de los dos tiene tiempo de sobra, es el candidato natural para la pasada completa pendiente.

**Encontrado:** El documento fue escrito antes de la reestructuración de `sdk/src/domain` y usa `EstadoTransaccion` en lugar de `TransactionStatus`, nombres de archivo de contrato conceptuales (`IRequestCrearPago.ts`, `IWebhookPayload.ts`, `IResponseConsultaPago.ts`) que no corresponden a `PaymentGatewayPort.ts`, y un snippet de `SdkError` con `httpStatus` y `originalError` que contradice la decisión tomada en el punto 2 de este documento (versión "lean": `code`, `gateway`, `originalPayload`).

**Decisión:** Se mantiene la matriz de equivalencias por pasarela (Wompi/Rapyd/Mercado Pago/Kushki) tal como está, porque es investigación de campo valiosa y en gran parte independiente de la reestructuración del dominio. Se corrige puntualmente el snippet de `SdkError` y se agrega una nota de vigencia al inicio del documento.

**Estado:** Parcialmente resuelto (nota de vigencia y snippet de `SdkError` corregidos; columna Rapyd investigada y actualizada, ver puntos 15, 18 y 19). **Pendiente:** una pasada completa de reemplazo de `EstadoTransaccion` por `TransactionStatus` en las tablas, y decidir si vale la pena crear los archivos de contrato por flujo (creación, webhook, consulta, error) dentro de `application/ports/`, o si toda esa información debe vivir directamente como comentarios de implementación dentro de cada Adapter.

### 12. `sdk/package.json` sin scripts reales y con licencia incorrecta

**Responsable:** No requiere acción en el SAD; la sección 1.2 (Joshua) ya decía Apache 2.0 correctamente, el error estaba solo en el archivo de configuración.

**Encontrado:** El `package.json` del SDK tenía `"license": "ISC"`, contradiciendo la sección 1.2/2.1 del SAD y `setup-and-structure.md`, que exigen Apache 2.0 (y que ya está correctamente declarada en `simulator-api/package.json`). Además, el único script era `"test": "echo \"Error: no test specified\" && exit 1"`, un placeholder que falla siempre, a pesar de que Jest y `jest.config.js` ya estaban configurados; no existían scripts `build` ni `lint`.

**Decisión:** Se corrige `license` a `Apache-2.0` y se agregan los scripts `build` (tsc), `test` (jest) y `lint` (eslint), ya que son los que documenta `setup-and-structure.md`.

**Estado:** Resuelto. `npm test` ejecuta Jest de verdad y ya hay archivos `*.test.ts` (`Transaction.test.ts`, `Amount.test.ts`, `Currency.test.ts`, `SdkError.test.ts`, `WebhookVerifier.test.ts`, `SDKConfigurator.test.ts`, `GatewayFactory.test.ts`). `npm run lint` también funciona: `eslint.config.mjs` ya existe tanto en `sdk/` como en `simulator-api/`, con `@typescript-eslint/parser` y `@typescript-eslint/eslint-plugin` instalados.

### 13. Falta el modelo de dominio de la API de Simulación

**Responsable de escribirlo en el SAD:** Henao (sección 3).

**Encontrado:** La sección 3 (Modelo de dominio) del SAD solo documenta los conceptos del SDK (`Transaction`, `Amount`, `WebhookVerifier`, etc., Tabla 2). No existe una tabla ni un diagrama de conceptos equivalente para la API de Simulación, a pesar de que la sección 9.2 describe cinco componentes propios (`HttpRouterMiddleware`, `ScenarioExecutionEngine`, `GatewayMockFactory`, `SignatureGenerator`, `WebhookTriggerEndpoint`) que manipulan conceptos que nunca quedaron definidos formalmente: el enum de escenarios (`APROBADO`, `RECHAZADO`, `FONDOS_INSUFICIENTES`, `TIMEOUT`, `ERROR_RED`), la forma de un payload mock por pasarela, y la forma de una solicitud de disparo de webhook.

**Estado:** Pendiente, es trabajo nuevo, no una corrección. No hay una decisión tomada todavía sobre la forma de estos conceptos; queda para cuando Henao lo redacte.

---

## Nota sobre el renombrado de este archivo (de `sad-inconsistencies.md` a `architecture-log.md`)

Este archivo se llamó `sad-inconsistencies.md` desde su creación hasta que su contenido creció
más allá de simples discrepancias de redacción entre el SAD y el código: pasó a incluir
decisiones técnicas completas de investigación (la migración PayU → Rapyd, puntos 15-19) y
seguimiento de regeneración de diagramas (puntos 7 y 17), dos tipos de contenido que no son
"inconsistencias" en sentido estricto. Se renombró y se agruparon los puntos existentes bajo
secciones temáticas (A-E) para que el nombre y la estructura reflejen con precisión lo que
contiene, sin cambiar la numeración de ningún punto individual, ya que esos números están
citados directamente en comentarios de código (`WebhookVerifier.ts`), pruebas
(`WebhookVerifier.test.ts`) y notas de diagramas PlantUML.
