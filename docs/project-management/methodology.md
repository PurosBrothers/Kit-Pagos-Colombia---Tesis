# Metodología del proyecto: memoria de referencia

Este documento resume la metodología definida en el SPMP (`SPMP - Kit Pagos Colombia.md`) en la forma que necesitamos para el día a día de gestión en GitHub: crear milestones, escribir issues, y decidir en qué fase o iteración cae cada corrección o funcionalidad nueva. No sustituye al SPMP, que sigue siendo el documento formal y la fuente de verdad ante el director del trabajo de grado; esto es una traducción operativa de esa fuente para no tener que releer el documento completo cada vez que hay que abrir un issue.

Si el SPMP cambia (por ejemplo, si se ajustan fechas o el alcance de una iteración), este archivo debe actualizarse para que no quede desalineado, igual que hacemos con `sad-inconsistencies.md` respecto al SAD.

## 1. Modelo de ciclo de vida: Design Science Research (DSR)

El proyecto no sigue Scrum ni cascada como marco principal. Sigue DSR (Peffers et al., 2007), porque el resultado central del trabajo de grado no es solo entregar software funcional, sino construir un artefacto (el framework) y evaluarlo de forma experimental frente a una alternativa (integración directa contra las APIs nativas), usando métricas de ingeniería de software (WMC, CBO, RFC).

Scrum no desaparece: se usa como práctica interna dentro de la Fase 4 (Desarrollo), con sprints semanales, backlog priorizado y revisiones periódicas. Pero el marco que estructura el proyecto completo, y el que hay que respetar al nombrar milestones o fases en GitHub, es DSR.

### Las seis fases DSR

| # | Fase DSR | Semanas (SPMP) | % de esfuerzo | Qué produce |
|---|---|---|---|---|
| 1 | Identificación del problema | 1–3 | 10% | Mapa comparativo del ecosistema de las 4 pasarelas, repositorio de parámetros de prueba |
| 2 | Definición de objetivos | 3–5 | 8% | SRS inicial, criterios de evaluación formalizados, proyectos prototípicos definidos |
| 3 | Diseño | 5–7 | 12% | Modelo de dominio unificado, puertos de la arquitectura hexagonal, especificación de adaptadores, diseño de la API de simulación, ADRs |
| 4 | Desarrollo iterativo | 7–13 | 45% | El framework construido, en tres iteraciones (ver sección 2) |
| 5 | Demostración y evaluación | 13–16 | 15% | Prototipos con y sin el framework, métricas CK calculadas, informe comparativo |
| 6 | Comunicación | 16–18 | 10% | Documento de grado, repositorio público publicado |

La Fase 4 es la única que opera de forma iterativa internamente, y es la única con la que vamos a interactuar constantemente desde GitHub Issues y Milestones mientras estemos en desarrollo.

### Los seis hitos del ciclo de vida (H1 a H6)

Los hitos son la métrica binaria de avance que el coordinador revisa cada jueves. Cada uno se considera cumplido dentro de un rango de fecha comprometida más o menos tres días.

- **H1**: mapa del ecosistema completo y repositorio de parámetros de prueba validado (cierra Fase 1).
- **H2**: arquitectura del framework diseñada con contratos de puerto especificados (cierra Fase 3).
- **H3**: núcleo del SDK funcional con al menos un adaptador operativo (parcial al cierre de Iteración 1, completo al cierre de Iteración 2).
- **H4**: los cuatro adaptadores y la API de simulación completos y con pruebas internas aprobadas (cierra Iteración 3).
- **H5**: los proyectos prototípicos evaluados con las métricas CK registradas (cierra Fase 5).
- **H6**: repositorio público publicado y documento de grado entregado (cierra Fase 6).

## 2. Fase 4 en detalle: las tres iteraciones

Este es el bloque de trabajo donde vamos a vivir la mayoría del tiempo. La arquitectura hexagonal impone el orden: el núcleo y sus contratos de puerto deben existir antes de que cualquier adaptador pueda construirse correctamente, así que estas tres iteraciones son secuenciales y dependientes entre sí, no paralelas.

| Iteración | Nombre exacto (usar tal cual en milestones de GitHub) | Contenido (WBS) | Hito | Responsable primario | Herramientas |
|---|---|---|---|---|---|
| 1 | `Iteración 1 – Núcleo del SDK` | Implementación del modelo de dominio y contratos de puerto; pruebas unitarias del núcleo (cobertura ≥80%); revisión técnica grupal | H3 parcial | Líder de arquitectura (Joshua) | TypeScript, Jest, GitHub (PR + CI), VS Code |
| 2 | `Iteración 2 – Adaptadores de pasarela` | Adaptadores de Wompi, PayU, Mercado Pago y Kushki, cada uno con pruebas de integración; validación cruzada de los cuatro | H3 completo | Líder de integración (David); cada adaptador en par con otro integrante | TypeScript, Jest, sandboxes de las 4 pasarelas, GitHub |
| 3 | `Iteración 3 – API de simulación y soporte de validación` | Escenarios de prueba de las pasarelas soportadas; despliegue en Render; documentación centralizada de datos de prueba; colección Postman versionada | H4 | Líder de integración (David); líder de arquitectura apoya en diseño de contratos | Fastify, TypeScript, Render, Postman, GitHub |

Importante: la revisión grupal obligatoria al cierre de la Iteración 1 es una condición explícita del SPMP antes de empezar la Iteración 2 ("revisión obligatoria de todos antes de iniciar Iter 2"). No es opcional saltarla aunque el equipo sienta presión de tiempo.

## 3. Convención de nombres para Milestones de GitHub

Usar exactamente los nombres del WBS y de la tabla anterior, para que el tablero de GitHub sea trazable 1:1 contra el SPMP sin traducción mental. No inventar nombres de iteraciones que no existen en el documento aprobado (por ejemplo, evitar términos como "Iteración 0"): si un bloque de trabajo no es código de una de las tres iteraciones de Fase 4, probablemente es el cierre de una fase anterior (típicamente Fase 3, cerrando el Hito H2) y el milestone debe nombrarse en función de esa fase, no de una iteración inexistente.

| Milestone (nombre base) | Cuándo usarlo |
|---|---|
| `Fase 3 – Diseño (cierre)` | Correcciones sobre artefactos de diseño ya producidos (SAD, ADRs, diagramas) antes de que el equipo empiece a escribir código de comportamiento. Hito H2. |
| `Iteración 1 – Núcleo del SDK` | Todo lo que sea dominio, puertos, y los servicios de aplicación agnósticos de pasarela (Configurator, Factory, Normalizer, Retry, ErrorHandler). Hito H3 parcial. |
| `Iteración 2 – Adaptadores de pasarela` | Los cuatro adaptadores y su validación cruzada. Hito H3 completo. |
| `Iteración 3 – API de simulación y soporte de validación` | Escenarios del simulador, despliegue, documentación de datos de prueba, colección Postman. Hito H4. |
| `Fase 5 – Demostración y evaluación` | Prototipos comparativos y métricas CK. Hito H5. Crear cuando se llegue a esa fase, no antes. |
| `Fase 6 – Comunicación` | Documento de grado y publicación del repositorio. Hito H6. Crear cuando se llegue a esa fase, no antes. |

Las fechas de vencimiento de cada milestone son un estimado nuestro basado en el rango de semanas del SPMP (Fase 4 = semanas 7 a 13, es decir, seis semanas para tres iteraciones, aproximadamente dos semanas cada una); el SPMP no fija una fecha calendario exacta de inicio, así que estas fechas se ajustan sobre la marcha sin que eso cuente como un cambio de alcance que requiera aprobación del director (el propio SPMP excluye del control de cambios los "ajustes al cronograma que no afecten los hitos principales").

### 3.1. Granularidad semanal dentro de cada iteración

El equipo se reúne semanalmente, así que un milestone de dos semanas completo (una iteración entera) es una unidad demasiado grande para revisar avance cada semana: para el jueves de la primera semana no hay nada que "cerrar" todavía. Por eso, **cada iteración de Fase 4 se divide en milestones semanales**, uno por semana de trabajo, y cada milestone semanal declara explícitamente a qué iteración pertenece en su propio nombre. Esto no reemplaza la tabla anterior, la complementa: la tabla define el nombre base y el alcance de contenido de cada iteración; esta sección define cómo se corta ese mismo contenido en checkpoints semanales.

Convención de nombre: `<Nombre base de la iteración> · Semana N (dd–dd mes)`, donde `N` reinicia en 1 al comenzar cada iteración (no es un contador global de todo el proyecto). Ejemplo con la Iteración 1, que ya está en curso:

- `Iteración 1 – Núcleo del SDK · Semana 1 (20–24 ago)`
- `Iteración 1 – Núcleo del SDK · Semana 2 (25–31 ago)`
- `Iteración 1 – Núcleo del SDK · Semana 3 (1–4 sep)` (si el núcleo no queda cerrado en la semana 2)

El número de semanas por iteración no está fijado de antemano: si una iteración se atrasa, simplemente se agrega el siguiente milestone semanal bajo el mismo prefijo, en vez de forzar que quepa en las dos semanas que el SPMP estimó. Esto es consistente con el principio del SPMP de no forzar que todo el trabajo dure exactamente lo mismo.

**Excepción explícita: el milestone `Fase 3 – Diseño (cierre)` no se divide por semana.** No es una iteración de desarrollo con checkpoints de avance de código; es un cierre puntual de documentación con una sola fecha de entrega, así que se queda como un único milestone.

Cuando una iteración completa ya cerró (todas sus semanas terminaron y el Hito correspondiente se cumplió), el nombre base de la iteración en la tabla de la sección 2 sigue sirviendo como referencia de agrupación conceptual, pero el trabajo real siempre vivió en los milestones semanales, no en un milestone único de dos semanas.

## 4. Convención de estructura para Issues de GitHub

Todo issue de código, sin excepción, debe responder no solo qué hay que hacer sino por qué y para qué dentro del sistema completo. Esta estructura mínima es la que se acordó como obligatoria:

1. **Título**: corto, claro, orientado a la acción.
2. **Responsable**: David, Joan, Henao o Joshua. La asignación se hace según complejidad, dependencias, carga de trabajo y necesidad de paralelización, no por rotación fija ni por buscar el mismo número de issues por persona.
3. **Duración estimada**: fecha de inicio y de cierre. No todos los issues duran una semana; la duración depende de la complejidad real.
4. **Ubicación**: la ruta o módulo exacto donde se hace el trabajo (por ejemplo `sdk/src/application/GatewayFactory.ts`), no solo "backend" o "SDK".
5. **Objetivo**: qué se pretende conseguir.
6. **Contexto y justificación**: por qué se necesita, qué problema resuelve, qué componente habilita, qué dependencia tiene con otras partes.
7. **Implementación**: qué debe hacer el desarrollador, con suficiente detalle para empezar sin tener que adivinar.
8. **Justificación arquitectónica**: por qué esta implementación tiene sentido dado el diseño (por ejemplo, por qué una responsabilidad debe vivir en una capa y no en otra según la arquitectura hexagonal).
9. **Resultado esperado**: qué debería ser posible verificar una vez cerrado el issue.

Además, todo issue debe declarar explícitamente sus dependencias con otros issues cuando existan, y el mentor/arquitecto debe señalar cuando: un issue está mal ubicado en la capa que le corresponde, dos issues deberían fusionarse, uno debería partirse en varios, se está ignorando una dependencia, o se está intentando implementar algo antes de que sus prerrequisitos existan (como intentar programar un adaptador antes de que el `GatewayFactory` que lo va a invocar tenga siquiera un esqueleto).

## 5. Roles del equipo

| Integrante | Rol (SPMP) | Frente principal | Nota |
|---|---|---|---|
| Andrés Henao Niño | Coordinador del equipo | Gestión operativa: backlog, calendario, comunicación con el director, actas | Referido como "Henao" en la documentación de arquitectura del repositorio |
| Joshua Prieto Zambrano | Líder de arquitectura y núcleo SDK | Modelo de dominio, puertos, implementación del núcleo | Revisa que los adaptadores cumplan los contratos de puerto |
| David Estevan Rodríguez Jurado | Líder de integración | Los cuatro adaptadores y la API de simulación | También consolida la documentación de datos de prueba |
| Joan Emmanuel Orduz Chía | Líder de evaluación y documentación | Métricas CK, proyectos prototípicos, documento de grado | Autor de este repositorio en GitHub (`joan-orduz`) |

La jerarquía operativa es plana: el coordinador no tiene autoridad técnica sobre los demás, solo responsabilidad de gestión. Las decisiones técnicas se toman por consenso entre quienes estén involucrados en el frente correspondiente. Todos los integrantes deben aportar a todos los entregables durante la Fase 4, no solo a su frente principal.

## 6. Definición de "terminado" (Definition of Done)

Un requerimiento se considera implementado exitosamente solo cuando se cumplen **simultáneamente** estas condiciones:

1. El pull request asociado fue aprobado por al menos un integrante distinto al autor.
2. Las pruebas automatizadas relevantes pasan en el pipeline de CI con cobertura igual o superior al 80%.
3. El ítem en el tablero de seguimiento está en estado completado.
4. Los valores de WMC, CBO y RFC de las clases modificadas están dentro de los umbrales definidos (WMC ≤ 15, CBO ≤ 5, RFC ≤ 20).
5. La Matriz de Trazabilidad ha sido actualizada para reflejar el requerimiento como implementado.

Si un valor de WMC, CBO o RFC supera su umbral durante la revisión de un pull request, se registra como defecto y el código no se aprueba hasta resolver la violación. Si la violación persiste dos iteraciones consecutivas sobre la misma clase, se convoca una sesión técnica de refactorización.

Si la tasa de completitud al cierre de una semana es inferior al 60% de las tareas planificadas, el coordinador convoca una reunión extraordinaria dentro de las siguientes 24 horas para un análisis de causa raíz.

## 7. Control de cambios de requerimientos

Cualquier integrante o el director puede proponer un cambio a los requerimientos. Se registra la propuesta con descripción, justificación e impacto estimado sobre cronograma y entregables; el equipo la evalúa en la reunión semanal y decide por consenso (aprobar, rechazar o posponer). Si el cambio lo pidió el director, su aprobación es obligatoria antes de proceder. Un cambio aprobado actualiza, en este orden: el SRS, la Matriz de Trazabilidad, y el backlog de GitHub Projects. Ningún cambio sobre la rama principal se acepta sin que el SRS esté actualizado primero.

No requieren aprobación del director: ajustes al cronograma que no afecten los hitos principales, actualización de la tabla de riesgos, correcciones menores de redacción, actualización de métricas de progreso. Sí requieren su alineación: cambios en la metodología de evaluación, y en general cualquier cambio que toque alcance o hitos.

## 8. Plantilla para issues

Copiar el bloque siguiente en el cuerpo de un issue nuevo y rellenar cada campo. No eliminar ningún campo aunque parezca trivial para un issue pequeño; si de verdad no aplica, escribir "No aplica" explícitamente en vez de borrarlo, para que quede constancia de que se consideró.

Convención de título: `<área>: <acción concreta>`, donde `<área>` es `SAD` (correcciones de documentación de arquitectura), `sdk`, `simulator-api`, `docs`, o `repo` (tareas de higiene que no caben en ninguna de las anteriores). Ejemplos ya usados: `SAD: unificar la plataforma de despliegue de la API de Simulación en Render`, `sdk: configurar ESLint con flat config`.

```markdown
**Responsable:** [David / Joan / Henao / Joshua]
**Duración estimada:** [fecha de inicio] → [fecha de cierre]
**Ubicación:** [ruta o módulo exacto, p. ej. `sdk/src/application/GatewayFactory.ts`; nunca solo "backend" o "SDK"]

**Objetivo**
[Qué se pretende conseguir con este issue, en una o dos frases.]

**Contexto y justificación**
[Por qué se necesita, qué problema resuelve, qué componente del sistema habilita, qué dependencia tiene con otras partes. Si depende de otro issue, decirlo explícitamente: "Depende de #N, no puede empezar antes de que ese quede cerrado".]

**Implementación**
[Qué debe hacer el desarrollador. No es necesario escribir todo el código, pero sí suficiente detalle para empezar sin adivinar decisiones que no le corresponden tomar a él.]

**Justificación arquitectónica**
[Por qué esta implementación tiene sentido dado el diseño vigente. Ejemplo: "Esta responsabilidad debe permanecer en esta capa porque la arquitectura hexagonal establece que el dominio no puede conocer ninguna pasarela concreta". Si el issue es de documentación o limpieza de repo sin implicación arquitectónica, escribir "Ninguna, es [tooling / higiene de repositorio / trabajo administrativo]".]

**Resultado esperado**
[Qué debería ser posible hacer o verificar una vez cerrado el issue. Tiene que ser verificable objetivamente, no una apreciación subjetiva.]
```

## 9. Plantilla para milestones

Antes de crear un milestone nuevo, verificar contra la tabla de la sección 3 que el nombre base corresponde exactamente a una fase o iteración real del SPMP. Si no calza con ninguna fila de esa tabla, no crear el milestone todavía: primero decidir a cuál fase o iteración pertenece el trabajo, o si de verdad es necesario ampliar la tabla de la sección 3 (lo cual implicaría revisar si el SPMP también necesita un ajuste).

Recordar la regla de la sección 3.1: si el milestone es de una iteración de Fase 4, va con sufijo semanal (`· Semana N (dd–dd mes)`); si es el cierre de Fase 3 (o de una futura Fase 5/6), va sin sufijo semanal, como milestone único.

**Para un milestone semanal dentro de una iteración:**

```markdown
Título: [Nombre base de la iteración, tal como aparece en la tabla de la sección 3] · Semana [N] ([fecha inicio]–[fecha fin])
Descripción: [Qué parte del contenido de esa iteración se espera cerrar o avanzar en esta semana puntual, y a qué Hito contribuye la iteración completa. Si es la última semana esperada de la iteración, indicarlo.]
Fecha de vencimiento: [el jueves o el día de la reunión semanal que corresponda]
```

**Para el cierre de una fase (sin división semanal):**

```markdown
Título: [Fase N – Nombre (cierre)]
Descripción: [Qué agrupa este milestone en términos del WBS del SPMP, y a qué Hito (H1 a H6) cierra]
Fecha de vencimiento: [fecha única de entrega, sin dividir por semana]
```

Comando de referencia para crearlo con `gh` (los milestones no tienen subcomando propio en `gh`, se crean contra la API REST):

```bash
gh api repos/PurosBrothers/Kit-Pagos-Colombia---Tesis/milestones \
  -f title="<Título>" \
  -f description="<Descripción>" \
  -f due_on="<AAAA-MM-DD>T23:59:59Z"
```

## 10. Documentos relacionados

- `SPMP - Kit Pagos Colombia.md` (fuera del repositorio, en Google Drive/Downloads): el documento formal completo. Este archivo es un resumen operativo, no un remplazo.
- `Descripción de la Arquitectura del Software (SAD).docx.md` (fuera del repositorio): la fuente de verdad de la arquitectura. Ver `docs/architecture/sad-inconsistencies.md` para el registro de discrepancias pendientes de corregir ahí.
- `docs/architecture/layers-and-components.md` y `docs/architecture/ubiquitous-language.md`: la estructura de código vigente, sincronizada con las decisiones tomadas sobre el SAD.
- `CONTRIBUTING.md`: estándares de commits, política de ramas y pull requests.
