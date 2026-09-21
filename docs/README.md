# Documentación de Kit Pagos Colombia

Esta carpeta está organizada como un **camino de lectura**: si la recorrés en orden, de la sección 00 a la 06, entendés el proyecto de punta a punta sin necesitar contexto previo. Cada sección responde una pregunta distinta, y las secciones están numeradas porque el orden importa: la arquitectura no se entiende sin saber qué problema resuelve, y el SDK no se entiende sin la arquitectura.

Si ya conocés el proyecto y venís a buscar algo puntual, la tabla de la sección "Índice completo" te lleva directo.

---

## Qué es Kit Pagos Colombia

Un artefacto de **tres componentes** que resuelve el mismo problema desde tres lados:

| # | Componente | Dónde vive | Qué aporta |
|---|---|---|---|
| 1 | **El SDK** | [`sdk/`](../sdk/) — publicado en npm como [`kit-pagos-colombia`](https://www.npmjs.com/package/kit-pagos-colombia) | Una sola API para cobrar por Wompi, Mercado Pago, Kushki o Rapyd, con arquitectura hexagonal, para que cambiar de pasarela sea configuración y no reescritura |
| 2 | **La API de Simulación** | [`simulator-api/`](../simulator-api/) | Un servidor que imita a las cuatro pasarelas, para integrar y probar sin credenciales, sin dinero y de forma determinista |
| 3 | **La documentación de datos** | [`docs/testing-data/`](testing-data/) | Las tarjetas, bancos, documentos y escenarios reales de cada pasarela, que es lo que vuelve ejecutables a los otros dos |

El tercero no es un anexo: sin saber qué tarjeta aprueba en Wompi, qué `bankId` acepta Kushki o qué documento exige el PSE de Rapyd, ni el SDK ni el simulador se pueden ejercitar contra nada.

---

## El camino de lectura

### [00 — Entorno de desarrollo](00-entorno-de-desarrollo.md)

Cómo se instala, se levanta y se verifica el repositorio. Empezá acá si querés ejecutar algo hoy.

### [01 — Producto y lógica de negocio](01-producto/)

El dominio, sin código. Qué es una pasarela de pago, qué conceptos técnicos hay que manejar antes de integrar una, cómo funciona cada una de las cuatro, y por qué este proyecto existe.

| Documento | Responde |
|---|---|
| [1-que-es-una-pasarela-de-pago.md](01-producto/1-que-es-una-pasarela-de-pago.md) | Quién es quién en un pago con tarjeta, qué hace y qué no hace una pasarela, y cómo es el ecosistema colombiano |
| [2-conceptos-tecnicos.md](01-producto/2-conceptos-tecnicos.md) | Tokenización, PCI DSS, hash contra HMAC, firmas, webhooks, anti-replay, idempotencia, unidades menores, 3DS |
| [3-las-cuatro-pasarelas.md](01-producto/3-las-cuatro-pasarelas.md) | Cómo cobra, cómo autentica, cómo firma y qué exige cada una de Wompi, Mercado Pago, Kushki y Rapyd |
| [4-por-que-kit-pagos.md](01-producto/4-por-que-kit-pagos.md) | Cuánto cuesta integrar las cuatro a mano, qué resuelve Kit Pagos y qué **no** resuelve |

### [02 — Arquitectura](02-arquitectura/)

Por qué el sistema está construido así y cómo verificarlo en el código.

| Documento | Responde |
|---|---|
| [1-arquitectura-hexagonal.md](02-arquitectura/1-arquitectura-hexagonal.md) | Qué es la arquitectura hexagonal, qué patrones de DDD y GoF se usan, y por qué encaja en este problema |
| [2-hexagonal-en-kit-pagos.md](02-arquitectura/2-hexagonal-en-kit-pagos.md) | Dónde está cada capa en el código real, con los comandos para comprobar que la regla de dependencia se cumple |
| [3-api-de-simulacion.md](02-arquitectura/3-api-de-simulacion.md) | Qué hace el segundo componente, sus rutas, sus escenarios y hasta dónde llega su fidelidad |
| [layers-and-components.md](02-arquitectura/layers-and-components.md) | Especificación oficial de cada componente (nivel 3 del modelo C4). Es la referencia normativa |
| [ubiquitous-language.md](02-arquitectura/ubiquitous-language.md) | La matriz campo por campo entre el modelo del SDK y el formato nativo de cada pasarela |

### [03 — El SDK](03-sdk/)

El componente 1, por dentro y por fuera.

| Documento | Responde |
|---|---|
| [1-recorrido-de-una-llamada.md](03-sdk/1-recorrido-de-una-llamada.md) | Qué pasa exactamente entre `createPayment()` y la respuesta, pieza por pieza |
| [2-clase-por-clase.md](03-sdk/2-clase-por-clase.md) | Qué hace cada clase y cada módulo del SDK, y por qué está hecho así |
| [3-las-pasarelas-por-dentro.md](03-sdk/3-las-pasarelas-por-dentro.md) | Qué HTTP manda cada adaptador, cuántos viajes de red necesita y qué defecto medido justifica cada rareza |
| [4-guia-de-implementacion.md](03-sdk/4-guia-de-implementacion.md) | Cómo integra un comercio, desde el `.env` hasta el endpoint de webhook |
| [5-comparacion-con-integracion-directa.md](03-sdk/5-comparacion-con-integracion-directa.md) | Qué mejora de verdad frente a integrar a mano, contado con números y no con adjetivos |

### [04 — Métricas y pruebas](04-metricas-y-pruebas/)

Cómo se sabe que el proyecto cumple sus propios criterios de calidad.

| Documento | Responde |
|---|---|
| [1-metricas-ck.md](04-metricas-y-pruebas/1-metricas-ck.md) | Qué son WMC, CBO, RFC y MAX_CC, por qué se miden, cómo se calculan y qué reporta el SDK hoy |
| [2-pruebas-del-sdk.md](04-metricas-y-pruebas/2-pruebas-del-sdk.md) | Qué cubren las pruebas unitarias, qué corre en CI y qué no |
| [3-pruebas-de-contrato.md](04-metricas-y-pruebas/3-pruebas-de-contrato.md) | Las pruebas contra los sandboxes reales y los defectos que encontraron |
| [4-medir-los-prototipos.md](04-metricas-y-pruebas/4-medir-los-prototipos.md) | Cómo se van a medir los dos prototipos de la Fase 5 y qué falta para poder hacerlo |

### [05 — Ejemplos](05-ejemplos/)

Los diez programas ejecutables que demuestran el SDK funcionando.

| Documento | Responde |
|---|---|
| [README.md](05-ejemplos/README.md) | Qué demuestra cada ejemplo, cómo lo hace y con qué comando se corre |
| [pago-simulado-wompi.md](05-ejemplos/pago-simulado-wompi.md) | Recorrido detallado del primer ejemplo, de punta a punta |
| [intercambiabilidad.md](05-ejemplos/intercambiabilidad.md) | El ejemplo que cobra el mismo pago por las cuatro pasarelas y verifica que coincidan |

### [06 — Landing page](06-landing/)

El alcance de la página pública del proyecto, que se construye en la Iteración 3.

---

## Carpetas de referencia

No son parte del camino de lectura: son artefactos que se consultan.

| Carpeta | Qué contiene | Por qué está aparte |
|---|---|---|
| [`architecture/`](architecture/) | El [architecture-log](architecture/architecture-log.md) con las 58 decisiones del proyecto, el [análisis de representación de dinero](architecture/money-representation-analysis.md) y los diagramas C4 en PNG y PlantUML | **Su ruta no se puede mover:** hay comentarios en `sdk/src` y en `simulator-api/src` que citan `docs/architecture/architecture-log.md` por ruta completa |
| [`testing-data/`](testing-data/) | El componente 3: datos de prueba de las cuatro pasarelas | Misma razón: el código y las pruebas citan estas rutas |
| [`project-management/`](project-management/) | La [metodología DSR](project-management/methodology.md) con las fórmulas normativas de las métricas, el [plan de evaluación](project-management/prototypes-evaluation-plan.md) de la Fase 5 y las [áreas de enfoque](project-management/team-focus-areas.md) del equipo | Es gestión del trabajo de grado, no documentación del artefacto |
| `evaluation/` | Reservada para el informe comparativo de la Fase 5 | Todavía no existe; la crea la fase que la escribe |

**El architecture-log merece un párrafo aparte.** Es el documento más valioso del repositorio y el más difícil de reemplazar: registra 58 decisiones con su contexto, sus alternativas y, sobre todo, lo que resultó falso al medirlo. Varias afirmaciones que parecían obvias se cayeron al probarlas contra los sandboxes reales, y eso quedó escrito ahí en lugar de corregirse en silencio. Cuando cualquier documento de este camino de lectura dice "medido el tal día", el detalle está en ese archivo.

---

## Lo que viene: los cuatro entregables de la Iteración 3

La Iteración 3 (22 de septiembre – 5 de octubre) cierra con cuatro cosas terminadas. Este es el mapa de dónde se escribe cada una, para que nadie tenga que preguntarlo:

| Entregable | Código | Documentación |
|---|---|---|
| **API de Simulación completa**, con los escenarios de rechazo, timeout y error de red, y desplegada | `simulator-api/` | [02-arquitectura/3-api-de-simulacion.md](02-arquitectura/3-api-de-simulacion.md) |
| **Documentación de datos completa**, como tercer componente | — | [testing-data/README.md](testing-data/README.md) y los cuatro documentos por pasarela |
| **Landing page** | `landing/` (por crear) | [06-landing/1-alcance-y-contenido.md](06-landing/1-alcance-y-contenido.md) |
| **Proyectos prototípicos completos**, los dos | `prototypes/checkout-directo/` y `prototypes/checkout-con-sdk/` (por crear) | [project-management/prototypes-evaluation-plan.md](project-management/prototypes-evaluation-plan.md) y [04-metricas-y-pruebas/4-medir-los-prototipos.md](04-metricas-y-pruebas/4-medir-los-prototipos.md) |

**El orden dentro de la iteración no es libre.** Los prototipos necesitan los escenarios de fallo del simulador, porque una de las seis variables que se miden es si el prototipo distingue un rechazo de negocio de un fallo técnico y reintenta solo el segundo, y eso no se puede implementar ni medir contra un simulador que solo sabe aprobar. Y medir los prototipos necesita que `ck-metrics.ts` acepte una ruta, porque hoy la tiene fija contra `sdk/src`. La secuencia forzada es: **escenarios del simulador → prototipos → métricas.** La landing y la documentación de datos no dependen de nada de eso y pueden ir en paralelo.

Hay una decisión abierta que afecta al primer entregable: si la API de Simulación sigue replicando el comportamiento medido de cada sandbox o si se conecta directamente a ellos. Está planteada con sus tres opciones y sus costos en el punto 59 del [architecture-log](architecture/architecture-log.md), y resumida en [02-arquitectura/3-api-de-simulacion.md](02-arquitectura/3-api-de-simulacion.md).

---

## Convenciones de esta documentación

- **Todo está en español**, igual que los comentarios del código. Los identificadores, los nombres de archivo y los mensajes de commit van en inglés; la regla completa está en las reglas del repositorio.
- **Cuando un documento afirma un comportamiento de una pasarela, cita dónde se midió.** Si no hay cita, es una lectura de la documentación oficial y no una medición, y eso se dice explícitamente. La diferencia importa: varias veces la documentación oficial y el sandbox no coincidieron.
- **Los puntos numerados** (`punto 43`, `punto 57`) son entradas del [architecture-log](architecture/architecture-log.md). Sus números nunca se reordenan, justamente para que estas citas no se rompan.
