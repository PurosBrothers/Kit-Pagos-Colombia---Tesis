# Estructura de la memoria final — Kit Pagos Colombia

Este documento convierte la plantilla LaTeX existente en un mapa de escritura para la memoria de grado. Define qué debe argumentar cada capítulo, qué evidencia ya existe en el repositorio, qué falta producir y qué partes dependen de la evaluación de la Fase 5. No es todavía la memoria terminada: no reemplaza el SPMP ni el SAD, no inventa resultados y no cambia los objetivos aprobados.

La estructura se basa en la plantilla [`memoria/main.tex`](memoria/main.tex), los objetivos transcritos en [`docs/project-management/thesis-objectives.md`](../project-management/thesis-objectives.md), la metodología DSR de [`docs/project-management/methodology.md`](../project-management/methodology.md) y el inventario documental y técnico del repositorio.

## 1. Decisiones de alcance y formato

### Plantilla

- **Confirmado:** existe una plantilla LaTeX en [`memoria/`](memoria/) con portadas, preliminares, capítulos, referencias y anexos.
- **Pendiente de confirmar:** que esta sea la versión institucional vigente y obligatoria. Que esté en el repositorio no demuestra por sí solo su autoridad.
- La plantilla contiene indicaciones que no coinciden sobre la extensión: la introducción menciona un máximo de 60 páginas y referencias menciona 80 páginas sin incluirlas. El límite que aplica es de 80 páginas sin anexos.
- Los nombres de capítulos se especializan para Kit Pagos Colombia, conservando el orden y los componentes académicos que ya exige la plantilla. Si los títulos institucionales resultan inmodificables, se conserva el título oficial y se usan los subtítulos propuestos.

### Ubicación y formato elegidos

La fuente de la memoria vivirá versionada en `docs/final-doc/memoria/`, en LaTeX. Es una decisión adecuada para este proyecto porque permite revisar cambios por Git, mantener el documento junto a la evidencia técnica, enlazar rutas del repositorio y compilar una versión reproducible. Google Docs no será la fuente maestra mientras se mantenga esta decisión; si se necesita una copia colaborativa, se tratará como copia derivada y se sincronizará con la fuente versionada.

Los documentos del proyecto están versionados en LaTeX: el SAD 2.0 en [`sad/`](sad/), el SRS 2.0 en [`srs/`](srs/), el SPMP 2.0 en [`spmp/`](spmp/) y el plan de pruebas en [`pruebas/`](pruebas/). Los originales de mayo de 2026 del SAD, el SRS y el SPMP están en [`sad/SAD-original.pdf`](sad/SAD-original.pdf), [`srs/SRS-original.pdf`](srs/SRS-original.pdf) y [`spmp/SPMP-original.pdf`](spmp/SPMP-original.pdf). Antes de la entrega final se debe registrar la referencia bibliográfica verificable de cada fuente y la versión consultada; no se debe presentar una ruta local de Google Drive como si fuera una fuente pública.

### Título de trabajo

**Kit Pagos Colombia: desarrollo de un framework para simplificar la integración de múltiples pasarelas de pago en el contexto colombiano.**

Es un título descriptivo derivado del objetivo general del SPMP, no una transcripción confirmada del título aprobado. Validarlo antes de cerrar las portadas.

## 2. Contexto del artefacto y estado de evidencia

Kit Pagos Colombia reúne cuatro componentes que deben presentarse como un artefacto integrado, los mismos que describen el SRS 2.0 y el SPMP 2.0:

1. **SDK TypeScript**: interfaz común para integrar Wompi, Mercado Pago, Kushki y Rapyd, con adaptadores y arquitectura hexagonal.
2. **Módulo de navegador** (`kit-pagos-colombia/browser`): tokeniza la tarjeta con Wompi, Mercado Pago y Kushki; Rapyd cobra en su página alojada.
3. **API de Simulación**: permite ejercitar integraciones de forma controlada sin depender de transacciones reales. Distinguir sus rutas de simulación de las rutas REST propias `/v1/api`.
4. **Documentación de datos de prueba**: describe datos y escenarios de las cuatro pasarelas y hace reproducibles las pruebas.

El proyecto también plantea tres patrones de integración: **P1**, backend del comercio hacia el SDK; **P2**, frontend del comercio hacia REST hacia el SDK; y **P3**, SDK unificado para tokenización desde el frontend. Según el registro de objetivos (sección 3), P1 y P2 están implementados, y el cliente de P2 es el prototipo C. P3 está implementado en parte: `KitPagosBrowser` tokeniza con Wompi, Mercado Pago y Kushki, y Rapyd no tokeniza en el navegador. Estas diferencias son parte del alcance y no deben ocultarse.

El issue [#115](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/115) transcribe seis objetivos específicos del SPMP. Los cuatro prototipos están en `prototypes/` y los define `thesis-objectives.md` (sección 5.1): A (`checkout-con-sdk-solo-back`), B (`checkout-con-sdk-front-back`, tratamiento), C (`checkout-frontend-rest`, P2) y D (`checkout-sin-solucion`, control). La recolección de las seis variables sobre B y D está en [`docs/evaluation/`](../evaluation/) (28 de octubre de 2026), y el informe comparativo de la Fase 5, en [`informe-comparativo-fase-5.md`](../evaluation/informe-comparativo-fase-5.md) (9 de noviembre de 2026, #204). OE-06 está implementado, y sus cifras se presentan en el capítulo VII.

## 3. Estructura de capítulos e inventario de fuentes

| Parte de la memoria | Contenido y función | Material existente que la alimenta | Pendientes y dependencias |
|---|---|---|---|
| Preliminares | Portadas, autoría, director, jurados, resolución, agradecimientos, resumen y abstract | [`memoria/sections/covers/`](memoria/sections/covers/) | Confirmar título oficial, código, nombres y cargos. Abstract y resumen deben redactarse al final y respetar el límite indicado por la plantilla. |
| I. Introducción | Presentar problema, propósito, alcance, método, contribución y recorrido del documento | [`docs/01-producto/4-por-que-kit-pagos.md`](../01-producto/4-por-que-kit-pagos.md), [`docs/project-management/methodology.md`](../project-management/methodology.md), objetivos del SPMP | Escribir como memoria del trabajo realizado; separar motivación de resultados y no anticipar conclusiones experimentales. |
| II. Descripción del proyecto y formulación del problema | Contexto colombiano, problema de integrar varias pasarelas, solución, justificación, objetivos, alcance, metodología y entregables | [`docs/01-producto/`](../01-producto/), [`docs/project-management/thesis-objectives.md`](../project-management/thesis-objectives.md), [`docs/project-management/methodology.md`](../project-management/methodology.md), el SPMP ([`spmp/SPMP-original.pdf`](spmp/SPMP-original.pdf)) | Escrito en el #175. Los objetivos van literales; las ampliaciones de alcance son las del SPMP 2.0 (sección 1.2.2). |
| III. Contexto: marco conceptual y estado del arte | Conceptos de pagos, seguridad y pasarelas; antecedentes y soluciones relacionadas | [`docs/01-producto/1-que-es-una-pasarela-de-pago.md`](../01-producto/1-que-es-una-pasarela-de-pago.md), [`2-conceptos-tecnicos.md`](../01-producto/2-conceptos-tecnicos.md), [`3-las-cuatro-pasarelas.md`](../01-producto/3-las-cuatro-pasarelas.md), fuentes oficiales citadas allí | Escrito en el #175, con la comparación de soluciones relacionadas por criterios explícitos y fecha de consulta. Mantener las referencias al día. |
| IV. Análisis de requisitos y alcance | Requisitos funcionales y restricciones, especificación de alto nivel, casos de uso y trazabilidad | [`docs/02-arquitectura/layers-and-components.md`](../02-arquitectura/layers-and-components.md) §5, [`docs/project-management/traceability-matrix.md`](../project-management/traceability-matrix.md), los originales del SPMP y del SRS ([`spmp/SPMP-original.pdf`](spmp/SPMP-original.pdf), [`srs/SRS-original.pdf`](srs/SRS-original.pdf)), issues y pruebas enlazados por la matriz | Escrito en el #175 contra el SRS 2.0 y la matriz. Si cambia un RF, actualizar primero el SRS y la matriz. La matriz es evidencia de proceso; no sustituye la explicación académica de requisitos. |
| V. Diseño arquitectónico del Kit Pagos Colombia | Arquitectura, dominio, componentes, decisiones, patrones, seguridad y tecnologías | [`docs/02-arquitectura/1-arquitectura-hexagonal.md`](../02-arquitectura/1-arquitectura-hexagonal.md), [`2-hexagonal-en-kit-pagos.md`](../02-arquitectura/2-hexagonal-en-kit-pagos.md), [`layers-and-components.md`](../02-arquitectura/layers-and-components.md), [`ubiquitous-language.md`](../02-arquitectura/ubiquitous-language.md), [`docs/architecture/architecture-log.md`](../architecture/architecture-log.md), diagramas C4 | Contrastar el diseño con el SAD 2.0 y explicar discrepancias relevantes. Seleccionar diagramas legibles y sincronizados con el código. |
| VI. Construcción e implementación del artefacto | Proceso DSR e iterativo; SDK, simulador, datos de prueba, patrones de integración y prototipos | [`docs/03-sdk/`](../03-sdk/), [`docs/02-arquitectura/3-api-de-simulacion.md`](../02-arquitectura/3-api-de-simulacion.md), [`docs/testing-data/`](../testing-data/), [`examples/`](../../examples/), código en `sdk/` y `simulator-api/` | Anclar las afirmaciones de implementación al código y a pruebas actuales. Los cuatro prototipos (A a D) existen; documentarlos con su estado verificable. |
| VII. Validación y resultados | Pruebas, calidad del SDK, demostración, resultados de la evaluación y discusión de validez | [`docs/04-metricas-y-pruebas/`](../04-metricas-y-pruebas/), [`docs/project-management/prototypes-evaluation-plan.md`](../project-management/prototypes-evaluation-plan.md), [`docs/04-metricas-y-pruebas/4-medir-los-prototipos.md`](../04-metricas-y-pruebas/4-medir-los-prototipos.md), reportes de CI y pruebas | **Fase 5:** el plan define seis variables y amenazas a la validez, y el informe comparativo sobre B y D está en [`informe-comparativo-fase-5.md`](../evaluation/informe-comparativo-fase-5.md). No incluir cifras que no salgan de ese informe y de su evidencia reproducible. |
| VIII. Conclusiones, impacto y trabajo futuro | Respuesta a objetivos, contribuciones, límites, impacto y siguientes pasos | Objetivos, matriz, resultados validados, [`docs/03-sdk/6-tokenizacion-frontend.md`](../03-sdk/6-tokenizacion-frontend.md), arquitectura y plan de evaluación | Depende del cierre de resultados y de contrastar cada objetivo con evidencia final. P3 y requisitos pendientes se reportan como límites/trabajo futuro, no como logros implementados. |
| Referencias | Fuentes académicas, documentación de pasarelas, SPMP, SAD, estándares y bibliotecas | Referencias dispersas en documentos de `docs/`, en el SPMP ([`spmp/SPMP-original.pdf`](spmp/SPMP-original.pdf)) y en el SAD externo | La memoria usa APA, con citas autor-año en el texto. Normalizar cada entrada nueva y confirmar que las fuentes externas sean consultables. |
| Anexos | Material que complementa la memoria sin interrumpir el argumento | Diagramas fuente, matrices, contratos, evidencia de pruebas, manuales y artefactos publicados | Acordar qué se adjunta, qué se enlaza y qué debe quedar disponible desde la página/repositorio institucional. No duplicar capítulos enteros. |

### I. Introducción

1. Contexto y motivación del problema.
2. Propósito y contribución de la memoria.
3. Alcance y límites del proyecto.
4. Enfoque metodológico, en síntesis.
5. Guía de lectura por capítulos.

La introducción orienta al lector; la formulación detallada del problema, los objetivos y el estado del arte se desarrollan después. Redactarla al final, cuando se conozca el resultado real.

### II. Descripción del proyecto y formulación del problema

1. Contexto y oportunidad: comercio electrónico y pluralidad de pasarelas en Colombia.
2. Formulación del problema: diferencias de contratos, autenticación, formatos, estados y webhooks, con citas a evidencia/documentación.
3. Propuesta y justificación: unificar la integración sin afirmar beneficios cuantitativos aún no medidos.
4. Objetivo general y objetivos específicos, con el texto aprobado del SPMP.
5. Alcance, exclusiones y entregables.
6. Design Science Research (DSR), fases pertinentes y relación entre artefacto y evaluación.
7. Entregables, criterios/estándares aplicados y justificación.

La metodología de referencia es DSR; Scrum se describe como práctica interna de desarrollo iterativo, no como el método de investigación principal. No reescribir objetivos para que coincidan con lo implementado.

### III. Contexto: marco conceptual y estado del arte

1. Ecosistema y roles en un pago, con foco en Colombia.
2. Conceptos relevantes: tokenización, PCI DSS y límites de alcance, firmas, HMAC, webhooks, idempotencia, reintentos, unidades monetarias y estados.
3. Características verificadas de Wompi, Mercado Pago, Kushki y Rapyd.
4. Soluciones y enfoques relacionados, comparados con criterios explícitos y referencias; no limitarse a repetir documentación del proveedor.
5. Síntesis de la brecha que aborda el proyecto.

Separar lo medido en sandbox de lo afirmado por documentación oficial. El [`architecture-log.md`](../architecture/architecture-log.md) conserva decisiones y discrepancias, pero la memoria debe explicar la evidencia pertinente y no trasladar el registro completo.

### IV. Análisis de requisitos y alcance

1. Requisitos funcionales RF-01 a RF-19 y su contexto.
2. Requisitos no funcionales y criterios de calidad, según la fuente aprobada.
3. Restricciones: credenciales, seguridad, alcance de los sandboxes, límites de PCI DSS y exclusiones del SPMP.
4. Especificación funcional: flujos de creación/consulta de pagos, webhooks, errores y simulación.
5. Casos de uso o diagramas apropiados.
6. Trazabilidad entre requisitos, componentes, pruebas y objetivos.
7. Límites de alcance y cambios respecto al SPMP.

La matriz [`traceability-matrix.md`](../project-management/traceability-matrix.md) separa deliberadamente objetivos y RF: cada OE referencia los RF que aportan evidencia; la matriz mantiene su contrato de proceso (estado, issue, PR y pruebas).

### V. Diseño arquitectónico

1. Criterios y decisiones de diseño, distinguiendo diseño aprobado de evolución posterior.
2. Arquitectura hexagonal y modelo de dominio unificado.
3. Puertos, adaptadores, fachada, normalización de respuestas, errores y resiliencia.
4. SDK, API de Simulación (rutas `/v1/sim` y API propia `/v1/api`) y documentación de datos como componentes.
5. Patrones P1/P2/P3 y fronteras cliente-servidor.
6. Seguridad: tratamiento de credenciales, firmas y webhooks; declarar los límites del simulador.
7. Tecnologías y herramientas, justificadas con criterios de selección.
8. Diagramas C4 y decisiones importantes del SAD/architecture log.

No describir la API simulada como si fuera una pasarela real ni asumir que una respuesta del simulador prueba conformidad de un proveedor.

### VI. Construcción e implementación

1. Proceso de construcción organizado según las fases DSR y las iteraciones de desarrollo.
2. SDK: API pública, adaptadores, normalización y capacidades verificables.
3. API de Simulación: endpoints, escenarios y fidelidad respecto de los sandboxes.
4. Documentación de datos de prueba como parte del artefacto.
5. Ejemplos de integración y pruebas de contrato.
6. Prototipos (`thesis-objectives.md`, sección 5.1):
   - **A:** checkout con el SDK solo en el servidor (`checkout-con-sdk-solo-back`); no participa del experimento.
   - **B — tratamiento:** checkout con el SDK y el módulo de navegador (`checkout-con-sdk-front-back`).
   - **C — demostración P2:** frontend hacia `/v1/api` (`checkout-frontend-rest`); evidencia de alcance, no parte del experimento.
   - **D — control:** checkout con integración directa de las cuatro pasarelas (`checkout-sin-solucion`).
7. Decisiones de implementación que afectaron el diseño, con referencias a puntos pertinentes del architecture log.

B y D son funcionalmente equivalentes y comparten el esqueleto no relacionado con pagos; C demuestra P2. P3 está implementado en parte, sin prototipo propio ni objetivo específico nuevo, según #115 y el análisis de tokenización frontend.

### VII. Validación y resultados

1. Estrategia de validación y relación con criterios de aceptación.
2. Resultados de pruebas unitarias, de integración, contrato y CI, indicando alcance y entorno.
3. Métricas CK WMC, CBO, RFC y MAX_CC: explicar fórmulas y presentar resultados solo desde reportes verificables.
4. Demostración funcional del artefacto.
5. Evaluación formal de Fase 5: comparación de B y D con las seis variables del plan (líneas de integración, costo de agregar cada pasarela, métricas CK, conceptos nativos expuestos, pasarelas alcanzables y cobertura de pruebas).
6. Análisis de amenazas a la validez, límites del estudio y resultados que contradigan la hipótesis.

**Dependencia explícita:** el plan sitúa el informe comparativo en `docs/evaluation/`. Ya están ahí la recolección de las seis variables sobre B y D, sus reportes y el informe comparativo ([`informe-comparativo-fase-5.md`](../evaluation/informe-comparativo-fase-5.md)). El capítulo cita el informe en vez de repetirlo. No afirmar ni estimar cifras que no salgan de esa evidencia y no presentar las hipótesis del plan como resultados.

### VIII. Conclusiones, impacto y trabajo futuro

1. Cumplimiento de cada OE, con evidencia y estado actualizado.
2. Respuesta a la pregunta/problema aprobado, sin ir más allá de lo que demuestran los resultados.
3. Contribuciones técnicas y metodológicas.
4. Impactos relevantes para Ingeniería de Sistemas y grupos de interés; impactos globales, económicos, ambientales o sociales solo cuando sean pertinentes y sustentados.
5. Limitaciones, divergencias de alcance y trabajo futuro priorizado.

## 4. Trazabilidad de objetivos específicos

Los seis objetivos que siguen son transcripciones reportadas como literales del SPMP, sección 1.2.3, en [`thesis-objectives.md`](../project-management/thesis-objectives.md). En la memoria deben mantenerse fieles a esa fuente. La evidencia y su estado se actualizarán con la matriz y los artefactos vigentes al momento de la entrega.

| Objetivo | Evidencia prevista/existente | Dónde se demuestra en la memoria | Estado que debe reflejarse |
|---|---|---|---|
| **OE-01.** Analizar las características técnicas, mecanismos de integración y consideraciones de seguridad de las cuatro pasarelas seleccionadas. | Comparación técnica, lenguaje ubicuo y datos por pasarela: [`3-las-cuatro-pasarelas.md`](../01-producto/3-las-cuatro-pasarelas.md), [`ubiquitous-language.md`](../02-arquitectura/ubiquitous-language.md), [`docs/testing-data/`](../testing-data/README.md). | II–III y evidencia aplicada en IV–V. | El registro de objetivos marca la evidencia como implementada; verificar referencias y cobertura al cerrar la memoria. |
| **OE-02.** Diseñar la arquitectura del framework aplicando la arquitectura hexagonal y patrones GoF. | Fundamentos y arquitectura implementada: [`1-arquitectura-hexagonal.md`](../02-arquitectura/1-arquitectura-hexagonal.md), [`2-hexagonal-en-kit-pagos.md`](../02-arquitectura/2-hexagonal-en-kit-pagos.md), [`layers-and-components.md`](../02-arquitectura/layers-and-components.md), [`architecture-log.md`](../architecture/architecture-log.md). | V. | Evidencia documentada; contrastar contra SAD y código final. |
| **OE-03.** Desarrollar un prototipo funcional del framework que implemente la interfaz unificada y los mecanismos de comunicación segura. | SDK, ejemplos, pruebas y documentación: `sdk/`, `examples/`, [`docs/03-sdk/`](../03-sdk/). | V–VI–VII. | La fuente de objetivos marca evidencia implementada; validar con resultados de pruebas de la versión evaluada. |
| **OE-04.** Implementar la API de simulación. | `simulator-api/`, [`3-api-de-simulacion.md`](../02-arquitectura/3-api-de-simulacion.md), RF-09 a RF-13 de la matriz. | V–VII. | Implementado: RF-09 a RF-13 y RF-16 están implementados; RF-13 declara siete operaciones sin esquema (punto 109). |
| **OE-05.** Consolidar los datos de prueba por pasarela para su documentación. | README y documentos de Wompi, Mercado Pago, Kushki y Rapyd en [`docs/testing-data/`](../testing-data/README.md). | III–VI y anexos si procede. | Evidencia documentada; confirmar qué requisitos asociados siguen parciales. |
| **OE-06.** Evaluar el framework mediante su aplicación en proyectos prototípicos usando las métricas WMC, CBO y RFC de Chidamber y Kemerer (1994), comparando los resultados frente a una integración directa con las APIs nativas. | Diseño: [`prototypes-evaluation-plan.md`](../project-management/prototypes-evaluation-plan.md), [`4-medir-los-prototipos.md`](../04-metricas-y-pruebas/4-medir-los-prototipos.md), fórmulas en metodología §6.1 y script `sdk/scripts/ck-metrics.ts`. | VII–VIII. | Implementado: el informe comparativo de la Fase 5 está en [`informe-comparativo-fase-5.md`](../evaluation/informe-comparativo-fase-5.md), con la recolección y los reportes que respaldan cada cifra. |

## 5. Prototipos, patrones y límites que deben quedar explícitos

| Prototipo | Caso, pasarelas y patrón | Propósito | Uso de resultados |
|---|---|---|---|
| A — checkout con el SDK solo en el servidor | El mismo caso, con el SDK solo en el servidor y sin `KitPagosBrowser`; las cuatro pasarelas; P1. | Mostrar el SDK sin su módulo de navegador. | Demostración; no participa del experimento. |
| B — checkout con SDK | Checkout mínimo con las cuatro pasarelas a través del SDK y el módulo de navegador; P1. | Grupo de tratamiento y evaluación del SDK. | Par experimental B/D de Fase 5. |
| C — checkout frontend–REST | Caso de checkout consumiendo `/v1/api`; las cuatro pasarelas; P2. | Demostrar la vía de integración REST/frontend. | Demostración del alcance; no se confunde con la comparación formal. |
| D — checkout directo | El mismo checkout que B, con las cuatro pasarelas integradas a mano. No usa el framework. | Grupo de control y línea base del costo de integración. | Par experimental B/D de Fase 5. |
| P3 — SDK unificado en frontend | `KitPagosBrowser` tokeniza con Wompi, Mercado Pago y Kushki; Rapyd no tokeniza en el navegador. Implementado en parte. | Límite declarado (#110 y punto 106). | No crear un OE-07; presentarlo como patrón implementado en parte. |

Las diferencias entre la versión 1.0 del SPMP y lo construido (Rapyd por PayU, la capa propia `/v1/api`, P2 con el prototipo C y P3 implementado en parte) se presentan sin editar los objetivos. La versión 2.0 del SPMP (sección 1.2.2) y el SRS 2.0 las incorporan, y `thesis-objectives.md` (sección 4) las registra; el capítulo IV de la memoria las explica.

## 6. Referencias, anexos y registro de pendientes

### Fuentes principales

- SPMP 2.0 en [`spmp/`](spmp/), con el original de mayo de 2026 en [`spmp/SPMP-original.pdf`](spmp/SPMP-original.pdf); objetivos en la sección 1.2.3 y alcance en la 1.2.2.
- SRS 2.0 en [`srs/`](srs/) y SAD 2.0 en [`sad/`](sad/); discrepancias y decisiones registradas en [`docs/architecture/architecture-log.md`](../architecture/architecture-log.md).
- [`docs/project-management/methodology.md`](../project-management/methodology.md) y [`thesis-objectives.md`](../project-management/thesis-objectives.md).
- [`docs/project-management/traceability-matrix.md`](../project-management/traceability-matrix.md).
- [`docs/project-management/prototypes-evaluation-plan.md`](../project-management/prototypes-evaluation-plan.md) y [`docs/04-metricas-y-pruebas/4-medir-los-prototipos.md`](../04-metricas-y-pruebas/4-medir-los-prototipos.md).
- Documentación de producto, arquitectura, SDK, pruebas y datos enlazada en el inventario del §3.

### Pendientes que bloquean una versión final

1. Confirmar si la plantilla de `memoria/` es la institucional vigente y si sus encabezados pueden especializarse.
2. Confirmar título oficial, autores, código, director, jurados y autoridades de portada.
3. Verificar el estado vigente de cada RF/OE y enlazar la evidencia final reproducible.
4. Llevar al capítulo VII el informe comparativo de la Fase 5, con sus amenazas a la validez y sus resultados adversos.
5. Definir qué artefactos serán anexos descargables y compilar/revisar el PDF final, dentro de las 80 páginas sin anexos.

## 7. Convención de actualización

Esta estructura es el mapa de la memoria, no una segunda fuente de verdad técnica. Cuando cambie un requisito, objetivo, prototipo o resultado, actualizar primero su fuente normativa (SPMP, matriz, plan experimental o documento técnico) y luego sincronizar la sección afectada de la memoria. Toda afirmación sobre una pasarela debe distinguir medición en sandbox de lectura de documentación oficial; toda comparación formal debe enlazar al informe y al procedimiento que permite reproducirla.
