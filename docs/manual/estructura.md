# Cómo está organizada la documentación oficial

Este documento no es para quien va a usar Kit Pagos: es para quien va a **escribir** en `docs/manual/`. Responde tres preguntas que, si quedan sin responder, hacen que la documentación se desincronice sola: qué estándar se sigue, dónde va cada cosa y cómo se evita que envejezca.

---

## 1. El problema que resuelve

En `docs/` conviven hoy dos cosas sin frontera declarada:

- la **documentación de la tesis**, que le sirve al director y al jurado: el SAD, la metodología, el plan de evaluación, la matriz de trazabilidad y el [`architecture-log`](../architecture/architecture-log.md);
- la **documentación del producto**, que le sirve a un desarrollador que quiere cobrar y no le interesa que esto sea un trabajo de grado.

Esa convivencia ya cobró dos veces. La [guarda de compilación](../../sdk/scripts/check-readme.ts) existe porque diez fragmentos del README del SDK llegaron a estar publicados sin compilar, y la documentación de arquitectura llegó a describir clases que no existían, métodos «sin implementar» que ya estaban completos y un adaptador cuando había cuatro (issues #66 y #112).

Ninguno de los dos problemas fue de redacción. Fueron problemas de **estructura**: no había un lugar correcto donde escribir cada cosa, ni nada que impidiera que lo escrito se separara del código.

---

## 2. El estándar: Diátaxis

Se adopta [Diátaxis](https://diataxis.fr/), que clasifica la documentación en cuatro tipos según lo que el lector intenta hacer, y no según el tema del que trata:

| Tipo | Pregunta del lector | Criterio para decidir si algo va acá |
|---|---|---|
| **Tutorial** | «Enséñeme» | El lector no sabe nada del tema y necesita una secuencia que funcione de principio a fin. Se puede seguir sin entender |
| **Guía** | «Necesito resolver esto» | El lector ya sabe lo básico y viene con un objetivo concreto. Es una receta, no una clase |
| **Referencia** | «¿Qué acepta?» | El lector ya está trabajando y necesita el dato exacto. Sin prosa, sin adornos, completo |
| **Explicación** | «¿Por qué así?» | El lector quiere entender el criterio para poder decidir por su cuenta |

**Por qué se eligió.** El repositorio ya tiene material de los cuatro tipos mezclado: un tutorial de instalación metido en un README de 688 líneas que también es referencia de los trece códigos de error, y una explicación extensa del porqué en documentos pensados para el jurado. Clasificar el material existente es lo que revela qué falta, y lo que mostró es que falta casi todo lo que no sea referencia.

**Por qué no es suficiente.** Diátaxis dice cómo clasificar, y no dice dónde vive el material ni cómo se mantiene vigente. Eso son las secciones 3 y 5.

**Por qué se puede abandonar sin costo.** Es un estándar de estructura, no una herramienta: no exige un generador de sitios, ni un formato, ni una dependencia. Si mañana se genera un sitio, la clasificación se reusa tal cual.

---

## 3. Dónde vive, y por qué acá

Se evaluaron cuatro lugares. La decisión es la opción C; las otras quedan descartadas por la razón que se indica.

| # | Alternativa | Veredicto |
|---|---|---|
| **A** | Una sección más dentro del camino de lectura `00`–`06` de [`docs/`](../README.md) | **Descartada.** Ese camino está numerado para leerse en orden y termina en la landing; su audiencia es la tesis. Meter documentación de producto ahí es exactamente la confusión que este issue existe para eliminar |
| **B** | Solo el `README.md` de cada paquete | **Descartada como hogar único.** El producto no es solo el SDK: la capa REST, el simulador y los datos de prueba no tienen paquete propio, así que quedan cuatro READMEs sin un índice común que los una. Se conservan como puerta de entrada, porque es donde llega quien viene de npm, y el manual los enlaza |
| **C** | Un directorio propio, `docs/manual/` | **Elegida.** Queda fuera del camino numerado, no colisiona con ninguna ruta que el código cite y permite un índice único de las cuatro formas de consumo |
| **D** | Un sitio generado (Docusaurus o similar) | **Pospuesta, no descartada.** No cambia una sola palabra del contenido y agrega una dependencia, un despliegue y una configuración que hoy no se justifican. La estructura de `manual/` es la que un generador consumiría sin cambios |

**Por qué `manual/` y no `producto/`.** `docs/01-producto/` ya existe y significa otra cosa: la explicación del dominio de pagos dentro del camino de la tesis. Reusar la palabra «producto» para dos directorios distintos reintroduce la ambigüedad que se está resolviendo.

**Lo que no se mueve.** [`architecture/`](../architecture/) y [`testing-data/`](../testing-data/) no se reubican: hay comentarios de código y documentos que los citan por ruta completa, y un enlace roto en un comentario no falla ninguna prueba. El manual los enlaza donde están.

---

## 4. La frontera, para que nadie tenga que adivinar

| Si va a escribir sobre… | Va en |
|---|---|
| Cómo instalar y usar el SDK, sus operaciones, sus errores, sus webhooks | `docs/manual/` |
| Cómo consumir la capa REST, sin instalar la librería | `docs/manual/` |
| Cómo levantar el simulador y qué simula | `docs/manual/` |
| Qué tarjeta, banco o documento usar para probar | `docs/manual/`, enlazando [`testing-data/`](../testing-data/) como fuente |
| Los límites del producto: qué no hace y por qué no lo va a hacer | `docs/manual/`, y visibles, no en nota al pie |
| El SAD, los diagramas C4, [`layers-and-components.md`](../02-arquitectura/layers-and-components.md) | `docs/02-arquitectura/` |
| Por qué se tomó una decisión técnica y qué alternativa se descartó | [`architecture-log.md`](../architecture/architecture-log.md) |
| La metodología DSR, los objetivos, la matriz de trazabilidad, el plan de evaluación de la Fase 5 | `docs/project-management/` |
| Las métricas CK del SDK y las pruebas de contrato | `docs/04-metricas-y-pruebas/` |
| El SRS, el SAD, el plan de pruebas y la memoria, en LaTeX | `docs/final-doc/` |

**La regla, en una línea:** si para entender el documento hace falta saber que esto es un trabajo de grado, es documentación de tesis.

**Y una regla de convivencia:** el manual enlaza a la tesis para profundizar, pero no la copia. Dos copias del mismo párrafo se desincronizan, y la que se queda vieja es siempre la que nadie abre.

---

## 5. Cómo se evita que se desactualice

Este es el problema central, no un detalle. Hoy la única defensa que el repositorio tiene contra la deriva es `npm run check:readme` en [`sdk/`](../../sdk/): extrae los bloques ```typescript del README, los concatena y los compila con `tsc --noEmit` **contra el paquete construido**, no contra el código fuente. Verifica que compilen, no que funcionen, y con eso alcanzó para que los diez errores que lo motivaron no volvieran.

Tres reglas para el material nuevo:

1. **Todo bloque de código compila o se justifica.** El script hoy lee un solo archivo, `sdk/README.md`. Cuando el manual tenga ejemplos ejecutables, la guarda se extiende para recorrer también `docs/manual/`, y un bloque que no pueda compilar se marca en el documento con el motivo. Esto no es opcional: un ejemplo de la documentación de producto es lo primero que copia un lector, y es el que más caro sale si está mal.
2. **Toda afirmación sobre el comportamiento del código se verifica abriéndolo o corriéndolo.** No se hereda de otro documento, ni de la documentación oficial de la pasarela, ni de un issue. Varias afirmaciones que parecían obvias se cayeron al medirlas contra los sandboxes reales (punto 50 del `architecture-log.md`), y la sección 7 de este documento lista tres del propio issue #112 que no coinciden con el código.
3. **Toda medición lleva fecha y, si existe, el punto del architecture-log.** Los números de este repositorio nunca se citan de memoria: el documento de arquitectura registra qué se midió, contra qué y qué resultó falso.

**Lo que la guarda no cubre:** los enlaces relativos. Un enlace que apunta a un archivo movido no falla ninguna prueba, ni en el CI ni en el editor de quien lo escribió. Por eso los directorios de la sección 3 no se mueven, y por eso quien mueva un archivo de `docs/` tiene que buscar sus referencias a mano.

---

## 6. En qué orden se escribió

| Orden | Tema | Por qué en ese orden |
|---|---|---|
| 1 | **La API REST** | Era el hueco más grande: solo existía el OpenAPI generado, que dice qué campos acepta pero no cómo se usa. Es también lo que hace que el producto sirva fuera de Node.js |
| 2 | **La API de Simulación** | Sin esto, quien integra no puede probar nada antes de tener credenciales de sandbox, y no había ningún documento de producto que lo explicara |
| 3 | **El SDK** | Había material y era bueno: [`sdk/README.md`](../../sdk/README.md) cubría instalación, las cuatro operaciones, los errores y los webhooks. Lo que faltaba era clasificarlo y sacarlo de las 688 líneas que mezclaban todo |
| 4 | **Los datos de prueba** | La fuente ya existía y estaba medida; faltaba la vista de producto sobre ella |

Los cinco documentos —incluido el tutorial— están escritos. Cuando se agregue uno nuevo, el orden de la tabla sigue sirviendo como criterio: primero lo que nadie puede deducir del código, después lo que reescribe material que ya existe.

**Todo lo que se agregue con código entra en la guarda.** `npm run check:readme` recorre el README del SDK y todos los `.md` de este directorio, y compila sus bloques TypeScript contra el paquete construido; el `CI` lo ejecuta en cada pull request.

---

## 7. Lo que el issue afirma y el código no

Estas tres afirmaciones del issue #112 quedaron verificadas contra el código al escribir este documento. Se corrigen acá para que no se propaguen al manual.

| El issue dice | El código dice |
|---|---|
| «los doce códigos» de error | Son **trece**: [`KitPagosErrorCode.ts`](../../sdk/src/domain/value-objects/KitPagosErrorCode.ts) declara `INVALID_CREDENTIALS`, `GATEWAY_TIMEOUT`, `CONNECTION_FAILED`, `RATE_LIMIT_EXCEEDED`, `INVALID_REQUEST`, `RESOURCE_NOT_FOUND`, `RESOURCE_LOCKED`, `GATEWAY_SERVER_ERROR`, `MALFORMED_RESPONSE`, `WEBHOOK_SIGNATURE_INVALID`, `UNSUPPORTED_OPERATION`, `MAX_RETRIES_EXCEEDED` y `UNKNOWN_ERROR` |
| «los códigos de banco de PSE no son portables» | **Sí lo son**, con el código de compensación de ACH Colombia que el SDK expone como `PseBankCode` (Bancolombia es `1007` en las cuatro, y el SDK traduce el que Rapyd necesita). La excepción son los bancos ficticios de los sandboxes de Wompi y Kushki |
| «cómo usar `x-simulate-scenario` para probar escenarios» | La cabecera existe y el simulador la lee —junto con `x-simulator-scenario`, que es equivalente—, pero **solo cuando se llama a `/v1/sim` directamente**. El SDK no la envía, así que un comercio que integra con el SDK no tiene cómo agregarla: elige el desenlace con los datos de prueba, el monto y la credencial |

Las tres están corregidas en [`README.md`](README.md) §4, que es donde el lector las va a encontrar.
