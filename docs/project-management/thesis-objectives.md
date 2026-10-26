# Objetivos específicos de la tesis y proyectos prototípicos

Este documento escribe por primera vez en el repositorio los objetivos específicos del trabajo de grado, conecta cada uno con la evidencia que lo demuestra y define los proyectos prototípicos que lo van a demostrar. Es el artefacto que cierra el entregable de la Fase 2 del SPMP (*"SRS inicial, criterios de evaluación formalizados, proyectos prototípicos definidos"*) que nunca se produjo: hasta la creación de este archivo los objetivos solo existían en el SPMP, fuera del repositorio, y la única mención dentro de `docs/` era una pregunta de pasada en `6-tokenizacion-frontend.md` (si el trabajo del issue #110 debía convertirse en un objetivo), sin lista ni rastreo del resto.

**Fuente de los objetivos:** `SPMP - Kit Pagos Colombia.md`, sección 1.2.3 (documento fuera del repositorio, en Google Drive/Downloads, versión consultada el 28 de septiembre de 2026). Este documento transcribe el texto literal y no lo reescribe; si el texto aprobado difiere de lo que el proyecto terminó haciendo, esa diferencia se nombra en la [sección de divergencias](#4-divergencias-nombradas-entre-el-spmp-aprobado-y-lo-ejecutado), no se disimula.

---

## 1. Objetivo general

> Desarrollar el Kit Pagos Colombia para simplificar la integración de múltiples pasarelas de pago en el contexto colombiano.

(SPMP, sección 1.2.3.)

---

## 2. Objetivos específicos

Los objetivos específicos son seis, según el SPMP. Cada fila incluye el texto aprobado, el estado de la evidencia que lo demuestra hoy, las rutas del repositorio donde esa evidencia vive y los requisitos funcionales de la [matriz de trazabilidad](traceability-matrix.md) que aportan evidencia.

| # | Objetivo específico (texto del SPMP) | Estado de la evidencia | Evidencia en el repositorio | RFs que aportan evidencia |
|---|---|---|---|---|
| **OE-01** | *Analizar las características técnicas, mecanismos de integración y consideraciones de seguridad de las cuatro pasarelas seleccionadas.* | Implementado | [`docs/01-producto/3-las-cuatro-pasarelas.md`](../01-producto/3-las-cuatro-pasarelas.md) (cómo cobra, autentica, firma y qué exige cada una); [`docs/02-arquitectura/ubiquitous-language.md`](../02-arquitectura/ubiquitous-language.md) (matriz campo por campo entre el modelo del SDK y el formato nativo); [`docs/testing-data/`](../testing-data/README.md) (datos de prueba con su nivel de evidencia medido) | RF-01, RF-02, RF-03, RF-11, RF-14 |
| **OE-02** | *Diseñar la arquitectura del framework aplicando la arquitectura hexagonal y patrones GoF.* | Implementado | [`docs/02-arquitectura/1-arquitectura-hexagonal.md`](../02-arquitectura/1-arquitectura-hexagonal.md) y [`2-hexagonal-en-kit-pagos.md`](../02-arquitectura/2-hexagonal-en-kit-pagos.md); [`docs/02-arquitectura/layers-and-components.md`](../02-arquitectura/layers-and-components.md) (sección 5, vista de arquitectura de los RF); registro de decisiones en [`docs/architecture/architecture-log.md`](../architecture/architecture-log.md) | RF-01 a RF-08 |
| **OE-03** | *Desarrollar un prototipo funcional del framework que implemente la interfaz unificada y los mecanismos de comunicación segura.* | Implementado | [`sdk/`](../../sdk/) (facade `KitPagos`, `GatewayFactory`, los cuatro adaptadores, `WebhookVerifier`, `RetryHandler`, `ErrorHandler`); [`examples/`](../../examples/) (integración desde afuera contra el paquete publicado); [`docs/03-sdk/`](../03-sdk/) | RF-01 a RF-08 |
| **OE-04** | *Implementar la API de simulación.* | En curso (Iteración 3) | [`simulator-api/`](../../simulator-api/) (rutas `/v1/sim/*` de las cuatro pasarelas, `TransactionStore`, escenarios, más el módulo REST propio `/v1/api`); [`docs/02-arquitectura/3-api-de-simulacion.md`](../02-arquitectura/3-api-de-simulacion.md) | RF-09, RF-10 y RF-12 implementados; RF-13 parcial: OpenAPI y schemas de `/v1/api` implementados, schemas de `/v1/sim` pendientes en #106 y #107 (ver matriz) |
| **OE-05** | *Consolidar los datos de prueba por pasarela para su documentación.* | Implementado | [`docs/testing-data/`](../testing-data/README.md) (README + un documento por pasarela, con nivel de evidencia declarado por dato) | RF-14 y RF-15 implementados (RF-15 con un límite declarado en la matriz) |
| **OE-06** | *Evaluar el framework mediante su aplicación en proyectos prototípicos usando las métricas WMC, CBO y RFC de Chidamber y Kemerer (1994), comparando los resultados frente a una integración directa con las APIs nativas.* | Pendiente — la ejecución es la Fase 5 | Diseño listo: [`docs/project-management/prototypes-evaluation-plan.md`](prototypes-evaluation-plan.md) y [`docs/04-metricas-y-pruebas/4-medir-los-prototipos.md`](../04-metricas-y-pruebas/4-medir-los-prototipos.md); fórmulas en [`docs/project-management/methodology.md`](methodology.md) sección 6; script [`sdk/scripts/ck-metrics.ts`](../../sdk/scripts/ck-metrics.ts) | Sin RF directo: lo exige el Hito H5 y la metodología (§1 y §6) |

**Cómo se lee el estado:** `Implementado` significa que la evidencia existe en el repositorio y se puede verificar; **no** significa que el objetivo esté "cerrado" ante el director (esa verificación es la sustentación). `En curso (Iteración 3)` significa que la implementación avanza en la iteración vigente y la evidencia crecerá antes del Hito H4 (5 de octubre). `Pendiente` significa que la ejecución pertenece a la Fase 5 y hoy solo existe el diseño.

---

## 3. Los tres patrones de integración

Con la capa REST de esta iteración, el proyecto pasa a contemplar tres formas de integración. Esta sección fija por primera vez en el repositorio qué es cada una y su estado real. La descripción normativa del componente REST (frontera con `/v1/sim`, autorreferencia en el mismo proceso, modelo de credenciales) la registra el issue #108 en el SAD y el `architecture-log.md`; este documento las describe desde el punto de vista de **qué demuestra cada patrón**, no desde la arquitectura interna.

| # | Patrón | Qué es | Estado real | Evidencia |
|---|---|---|---|---|
| **P1** | **Backend hacia SDK** | El comercio integra `kit-pagos-colombia` desde su servidor: `createPayment()`, `getPaymentStatus()`, `getPseBanks()`, `validateWebhook()`. Es el patrón que el proyecto contemplaba desde el inicio. | Implementado | Los [ejemplos](../../examples/) y [`docs/03-sdk/4-guia-de-implementacion.md`](../03-sdk/4-guia-de-implementacion.md) |
| **P2** | **Frontend hacia REST hacia SDK** | Un cliente de navegador consume la capa REST propia (`/v1/api`) sin instalar el SDK ni conocer la pasarela: elige pasarela y completa el cobro por HTTP. Lo construye esta iteración. | Implementado: la capa REST y su cliente, el prototipo C | [`simulator-api/src/kit-pagos-api/`](../../simulator-api/src/kit-pagos-api/) y [`docs/02-arquitectura/3-api-de-simulacion.md`](../02-arquitectura/3-api-de-simulacion.md) §/v1/api; el cliente es [`prototypes/checkout-frontend-rest/`](../../prototypes/checkout-frontend-rest/) y [`docs/05-ejemplos/checkout-frontend-rest.md`](../05-ejemplos/checkout-frontend-rest.md) (issue **#109**, puntos 91 a 106 del `architecture-log.md`) |
| **P3** | **Frontend hacia SDK unificado de pasarelas** | Encapsular también las librerías de tokenización del navegador de las cuatro pasarelas para ofrecer una interfaz unificada también en frontend. | Implementado **en parte**: `KitPagosBrowser` tokeniza con Wompi, Mercado Pago y Kushki; Rapyd no tokeniza en el navegador | [`docs/03-sdk/6-tokenizacion-frontend.md`](../03-sdk/6-tokenizacion-frontend.md) (cierra el issue **#110**, que recomendó solo Wompi y Mercado Pago como valor agregado) y el punto 106 del `architecture-log.md` (Kushki, desde la 0.6.0-rc.4) |

**Hasta dónde llega P3:** la investigación de #110 (`6-tokenizacion-frontend.md`, secciones 6 y 7) recomendó implementar solo Wompi y Mercado Pago, porque Kushki parecía exigir campos alojados en iframes y Rapyd no ofrece tokenización inline. El 17 de octubre de 2026 se midió que la ruta REST de tokenización de Kushki acepta llamadas desde el navegador, y la 0.6.0-rc.4 la agregó al módulo (punto 106). Rapyd sigue fuera: no hay forma de tokenizar su tarjeta en el navegador, y se cobra en su página alojada, que el prototipo C sigue como un PSE porque `/v1/api/gateways` le dice cómo recibe la tarjeta cada pasarela (`cardCapture`). La interfaz de frontend no puede ser idéntica para las cuatro —tres tokenizan y una redirige—, y ese es el límite declarado, no un hueco olvidado.

---

## 4. Divergencias nombradas entre el SPMP aprobado y lo ejecutado

El issue exige que toda diferencia entre el texto aprobado y lo que el proyecto terminó haciendo quede **nombrada, no disimulada**, y que se discuta con el director en vez de resolverse reescribiendo el objetivo.

1. **La capa REST propia (`/v1/api`) no existe en el SPMP.** El SPMP describe la API de simulación como un servidor que *"replica el comportamiento de las cuatro pasarelas"* (sección 1.2.2); esta iteración sumó la cara opuesta —exponer nuestras propias capacidades bajo `/v1/api`— y convierte al simulador en un servidor con dos caras contrarias (ver issue #108). Es una ampliación del alcance aprobado que no se declara en el SPMP.
2. **El patrón P2 (frontend → REST → SDK) no está contemplado en los objetivos.** El SPMP solo describe la integración backend (`SDK hacia pasarela`). El alcance aprobado además *excluye explícitamente* las *"interfaces de usuario para flujos de pago"* (sección 1.2.2). P2 implica un cliente de navegador (aunque sea el del comercio consumiendo nuestra REST, no una IU nuestra), así que merece nombrarse frente al director antes de que el experimento lo use como evidencia.
3. **P3 (SDK unificado de frontend) quedó como valor agregado, no como objetivo.** #110 la evaluó y recomendó no convertirla en entregable; el SPMP nunca la contempló. Lo que existe de ella (`KitPagosBrowser`, con Wompi, Mercado Pago y, desde el punto 106, Kushki) es valor agregado del prototipo C, no evidencia de un objetivo. **No se agrega un objetivo OE-07**: eso reescribiría el alcance aprobado sin pasar por el director. Esta sección es el registro de que se evaluó y se decidió no incluirla (método DSR: el límite es un resultado de diseño, no una omisión).
4. **Los estados de la evidencia (sección 2) son una fotografía del 28 de septiembre de 2026.** OE-04 y OE-06 cambiarán de estado al cerrar la Iteración 3 y la Fase 5; este documento se actualizará en el PR que cierre cada uno, no al margen.

Ninguna de estas divergencias se resuelve en este documento: se declaran para discutirlas con el director en la próxima revisión.

---

## 5. Proyectos prototípicos

Este documento define **cuáles** son los prototipos y **qué** demuestra cada uno. El **cómo** se miden (diseño experimental, variables, amenazas a la validez) está aprobado en [`prototypes-evaluation-plan.md`](prototypes-evaluation-plan.md) y el **cómo operativo** de la recolección en [`4-medir-los-prototipos.md`](../04-metricas-y-pruebas/4-medir-los-prototipos.md). Este documento no los reemplaza.

### 5.1. Los cuatro prototipos

| Prototipo | Carpeta | Caso de comercio | Pasarelas | Patrón de integración | Objetivo que demuestra |
|---|---|---|---|---|---|
| **A — checkout con el SDK solo en el servidor (Joshua)** | `prototypes/checkout-con-sdk-solo-back/` | El mismo caso, con el SDK solo en el servidor: la página tokeniza la tarjeta con `fetch` contra la API de cada pasarela, sin `KitPagosBrowser`. Se presenta como la tienda de yerba mate «Austral Mate» (punto 123 del `architecture-log.md`) | Las cuatro: con tarjeta, Wompi, Mercado Pago y Kushki tokenizan en el navegador y Rapyd cobra en su página alojada | **P1** sin el módulo de navegador del SDK | OE-03 |
| **B — checkout con SDK (tratamiento)** | `prototypes/checkout-con-sdk-front-back/` | El mismo checkout mínimo, con las mismas seis funciones que D. Desde el 19 de octubre de 2026 se presenta como la tienda de vinos «La Bodega de Chapinero», con la misma estructura de vitrina que D (puntos 110 y 116 del `architecture-log.md`) | Las cuatro a través del SDK, en el mismo orden de commits que D (punto 117) | **P1** — backend hacia SDK | OE-03 y OE-06 |
| **C — checkout frontend → REST** | `prototypes/checkout-frontend-rest/` | El mismo caso, pero el cobro se completa desde un navegador contra `/v1/api` | Las cuatro con PSE y con tarjeta, cambiando solo el valor de `gateway`: con tarjeta, Wompi, Mercado Pago y Kushki tokenizan en el navegador y Rapyd cobra en su página alojada (issue #109, puntos 91, 92 y 106 del `architecture-log.md`) | **P2** — frontend hacia REST hacia SDK | OE-03 y OE-04 |
| **D — checkout directo (control)** | `prototypes/checkout-sin-solucion/` | Checkout mínimo de comercio electrónico: mostrar un producto, cobrarlo, informar el resultado, recibir la notificación asíncrona y consultar el estado. Desde el 19 de octubre de 2026 se presenta como la tienda «La Candelaria Cómics», con catálogo y carrito (punto 110 del `architecture-log.md`) | Las cuatro, integradas a mano: Wompi en el commit base, y Mercado Pago, Kushki y Rapyd en un commit cada una (punto 117) | Ninguno del framework: integración directa contra las APIs nativas | OE-06 (baseline de la comparación) |

### 5.2. Cómo se leen las filas

- **B y D son el par de medición del experimento central de la Fase 5** (el costo de agregar cada pasarela, variable 2 del plan de evaluación; hasta el 20 de octubre de 2026 era el costo de migrar Wompi → Mercado Pago, punto 117). Todo lo que no es integración de pagos es idéntico entre los dos (esqueleto común fuera del conteo), según la regla dura de la sección 2 del plan de evaluación, salvo las vitrinas de B y D, que son una excepción declarada (puntos 110 y 116).
- **C ejercita el patrón P2 y amplía el alcance que la tesis declara**: con B y D el proyecto solo demostraría el patrón uno, y el issue #115 pide que el conjunto de prototipos ejercite al menos dos de los tres patrones. C no participa del experimento formal con métricas CK: es demostración de alcance, y es el mismo cliente del issue #109 (decisión del 5 de octubre de 2026 en ese issue), construido en la Iteración 3 (entregable 4).
- **A muestra el SDK sin su módulo de navegador**: el caso de un comercio que ya usa el formulario o el widget de su pasarela. Como C, no participa del experimento.
- **P3 no tiene prototipo asignado**: es el límite declarado de la sección 3. Lo que existe de él, `KitPagosBrowser`, lo usa el prototipo C para tokenizar la tarjeta; no se fuerza un prototipo propio para un patrón implementado solo en parte.

### 5.3. Qué mide la Fase 5 y qué no — descargo

**Este documento no produce ni anticipa ninguna cifra.** Los prototipos son el insumo del experimento de la Fase 5; las únicas cifras formales de comparación son las seis variables del [`prototypes-evaluation-plan.md`](prototypes-evaluation-plan.md) medidas sobre B y D (líneas de integración, costo de agregar cada pasarela, métricas CK, conceptos nativos expuestos, pasarelas alcanzables, cobertura de pruebas), y **hoy no existen**. Cualquier afirmación cuantitativa sobre los beneficios del framework en este repositorio (como [`docs/03-sdk/5-comparacion-con-integracion-directa.md`](../03-sdk/5-comparacion-con-integracion-directa.md)) es comparación cualitativa o de alcance, no evidencia experimental, y así se presenta.

---

## 6. Relación con la matriz de trazabilidad

Los objetivos específicos **viven en este documento aparte** y se **referencian desde la matriz de trazabilidad**, en vez de integrarse en ella. La razón es el contrato de la matriz: `traceability-matrix.md` es el artefacto del DoD (condición 5) con columnas fijas (RF, requisito, componentes, estado, issue, PR, pruebas) y `CONTRIBUTING.md` exige actualizarla en cada PR de requisitos. Los objetivos no tienen issue, PR ni pruebas por fila —el nivel de evidencia de un objetivo es el conjunto de RFs que lo sustentan, no una fila propia—, así que integrarlos cambiaría el contrato sin aportar verificabilidad. La relación queda así:

- **De objetivos a matriz:** cada OE de la sección 2 lista los RFs que aportan evidencia (columna *RFs que aportan evidencia*).
- **De matriz a objetivos:** la matriz ganó una nota en su sección 4 apuntando a este documento, para que quien lea una fila sepa que el requisito responde a un objetivo específico que vive aquí.
- **Regla de mantenimiento:** cuando un RF cambie de estado en la matriz, el PR que lo cambia debe verificar si el OE correspondiente de la sección 2 necesita actualizar su columna de evidencia.

---

## Referencias

- `SPMP - Kit Pagos Colombia.md` (fuera del repositorio), sección 1.2.3 — fuente de los objetivos.
- [`docs/project-management/traceability-matrix.md`](traceability-matrix.md) — matriz de requisitos funcionales (artefacto del DoD).
- [`docs/project-management/prototypes-evaluation-plan.md`](prototypes-evaluation-plan.md) — diseño experimental aprobado de la Fase 5.
- [`docs/04-metricas-y-pruebas/4-medir-los-prototipos.md`](../04-metricas-y-pruebas/4-medir-los-prototipos.md) — cómo se recolecta cada variable.
- [`docs/02-arquitectura/layers-and-components.md`](../02-arquitectura/layers-and-components.md) — vista de arquitectura de los RF (sección 5).
- [`docs/03-sdk/6-tokenizacion-frontend.md`](../03-sdk/6-tokenizacion-frontend.md) — investigación de P3 (issue #110).
- Issues relacionados: #108 (componente REST y patrones en el SAD), #109 (cliente frontend de P2), #110 (investigación de P3), #67 (matriz de trazabilidad), #114 (documento final, que consume este archivo).