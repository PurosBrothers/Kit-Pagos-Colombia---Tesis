# Cómo medir los prototipos

El experimento de la Fase 5 compara dos prototipos funcionalmente idénticos: uno que integra las pasarelas a mano y otro que usa el SDK. Este documento cubre la parte operativa: cómo se recolecta cada variable, incluida la más importante, que hasta el issue #130 no se podía recolectar.

> El diseño experimental está aprobado y vive en [prototypes-evaluation-plan.md](../project-management/prototypes-evaluation-plan.md). Este documento no lo reemplaza: resuelve el cómo.

---

## 1. Los dos prototipos y la regla que hace válida la comparación

| | Prototipo D — control | Prototipo B — tratamiento |
|---|---|---|
| Carpeta | `prototypes/checkout-sin-solucion/` | `prototypes/checkout-con-sdk-front-back/` |
| Cómo cobra | Integración directa contra la API nativa de cada una de las cuatro pasarelas | Las cuatro a través de `kit-pagos-colombia` |
| Qué representa | Lo que hace hoy un desarrollador colombiano | Lo que propone la tesis |

**La regla dura: todo lo que no sea integración de pagos tiene que ser idéntico en los dos.** Misma interfaz, mismo servidor, misma estructura, mismas dependencias, mismo estilo. Si el prototipo B tuviera una interfaz más simple o menos validaciones, la diferencia medida no sería atribuible al framework.

La forma práctica de garantizarlo: construir un **esqueleto común**, copiarlo a las dos carpetas, y de ahí en adelante tocar **únicamente** el módulo de pagos de cada uno. **Ese esqueleto queda fuera del conteo de líneas.**

El esqueleto está en `prototypes/` desde el issue #130 (punto 90 del `architecture-log.md`, y [`prototypes/README.md`](../../prototypes/README.md)):

- **El módulo de pagos de cada prototipo** es `src/payments/` y `test/payments/`. Incluye `src/payments/browser/client.js`, que tokeniza la tarjeta en el navegador.
- **Lo demás es el esqueleto**, incluido el contrato `src/checkout/PaymentsPort.ts`. `prototypes/check-skeleton-parity.sh` comprueba en la CI que sea idéntico en los dos, salvo las vitrinas, «La Candelaria Cómics» en D y «La Bodega de Chapinero» en B (páginas, catálogo, órdenes y sus pruebas). Son una excepción declarada desde el 19 de octubre de 2026 (puntos 110 y 116 del `architecture-log.md`), y no están en `src/payments/`, así que no entran en el conteo.
- **Cambios en los módulos de pagos que no hizo su autor, y que hay que declarar al medir:**
  - **para cobrar en el ambiente del esqueleto:** en el de David (D), 23 líneas agregadas y 2 quitadas en `src/payments/index.ts` (punto 111); en el de Andrés (B), 29 agregadas y 9 quitadas, más sus pruebas (punto 116);
  - **para las cuatro pasarelas** (punto 117): el contrato para varias pasarelas en el commit base, y Mercado Pago, Kushki y Rapyd, que escribe Orduz en B y en D.
- **Los dos `package.json` traen `kit-pagos-colombia`**, para que también las dependencias sean idénticas. El mismo script falla si el módulo de pagos de D menciona el SDK.
- **La línea base del conteo** es el commit que agrega el esqueleto.

Y la otra mitad de la regla, la que es fácil de olvidar: los dos tienen que cubrir la misma funcionalidad, incluidos los tres puntos que un prototipo apurado omitiría —distinguir rechazo de fallo técnico, verificar la firma del webhook, y registrar el estado nativo para auditoría—. Un prototipo D que solo llame al endpoint de cobro no es una integración real: es la mitad de una, y compararla contra el framework completo **infla artificialmente la diferencia** a favor de la tesis.

---

## 2. Cómo se recolecta cada variable

| # | Variable | Cómo |
|---|---|---|
| 1 | Líneas de integración | `npx cloc@2.10.0` sobre el módulo de pagos de cada prototipo (`src/payments/`), contando solo líneas de código (`code`), excluyendo el esqueleto común |
| 2 | Costo de agregar cada pasarela | `git show --stat` de cada commit de pasarela, sobre `src/payments/` y `test/payments/` |
| 3 | **Métricas CK** | `npm run metrics -- --root <prototipo>/src/payments --tsconfig <prototipo>/tsconfig.json --unit file --json <archivo>` sobre los archivos de pago de cada prototipo — ver §3 |
| 4 | Conceptos nativos expuestos | Script versionado `sdk/scripts/native-concepts.ts` con catálogo de identificadores propios de pasarela y fronteras de palabra |
| 5 | Pasarelas alcanzables | Cuántas de las cuatro cobran de punta a punta, con tarjeta y con PSE, en el sandbox oficial y, donde el sandbox no deja, en el simulador |
| 6 | Cobertura de pruebas | Jest con `collectCoverageFrom: ["src/payments/**"]`, con el mismo esfuerzo de pruebas en ambos |

### La variable 1 cuenta líneas de código sin ruido

Se recolecta con `cloc` (versión 2.10.0) sobre `src/payments/` de cada prototipo:

```bash
npx cloc@2.10.0 prototypes/checkout-sin-solucion/src/payments
npx cloc@2.10.0 prototypes/checkout-con-sdk-front-back/src/payments
```

Se toma únicamente la columna `code` del resumen total (excluyendo líneas en blanco y comentarios). De este modo, commits que solo ajusten comentarios, documentación o formatos (como `44a897d`) no mueven la cifra de integración.

### La variable 2 es la que más vale, y es la más fácil de recolectar

`git show --stat` de un commit. Es **auditable por cualquiera** y no depende de quién lo cuente, que es exactamente lo que se quiere en un experimento donde los autores también son los evaluadores.

El procedimiento exige disciplina de commits (punto 117):

1. Un **commit base** en los dos prototipos, con el contrato para varias pasarelas y Wompi como única pasarela registrada.
2. **Un commit por pasarela, en el mismo orden en los dos**: Mercado Pago, Kushki y Rapyd. Cada uno contiene solo esa pasarela.

Si una pasarela se mezcla con otros cambios en el mismo commit, la medición se contamina y no hay forma de limpiarla después.

```bash
# Por cada commit de pasarela, en cada prototipo
git show --stat <commit> -- prototypes/checkout-sin-solucion/src/payments prototypes/checkout-sin-solucion/test/payments
```

Hasta el commit `d3ada47`, las carpetas de D y B se llamaban `checkout-directo` y `checkout-con-sdk` (punto 119). En un commit anterior, el filtro usa el nombre de entonces; si no, `git show --stat` sale vacío.

Si un commit de pasarela toca algo fuera de `src/payments/` y `test/payments/` (el esqueleto o la vitrina), eso también se registra: es un costo de la pasarela que la hipótesis dice que B no debería pagar.

Hasta el 20 de octubre de 2026, la variable 2 era el diff de migrar de Wompi a Mercado Pago (#133, cerrado).

### La variable 4 se automatiza con script versionado

El conteo se realiza con `sdk/scripts/native-concepts.ts` (ejecutable con `npm run metrics:concepts` desde `sdk/`), el cual implementa búsqueda con fronteras de palabra (`\b<identificador>\b`) sobre el catálogo formal de identificadores nativos de las cuatro pasarelas:

```bash
npm run metrics:concepts -- --target ../prototypes/checkout-sin-solucion/src/payments
npm run metrics:concepts -- --target ../prototypes/checkout-con-sdk-front-back/src/payments --assert-zero
```

La lista catalogada cubre las cuatro pasarelas y se fija antes de medir (#134):
- **Wompi**: `amount_in_cents`, `acceptance_token`, `integrity` y `x-event-checksum`.
- **Mercado Pago**: `transaction_amount`, `total_amount` y `x-signature`.
- **Kushki**: `x-kushki-signature`, `Private-Merchant-Id`, `Public-Merchant-Id` y `APPROVAL`.
- **Rapyd**: `access_key`, `salt` y `CLO`.

El uso de fronteras de palabra es crucial: evita falsos positivos por subcadenas presentes en nombres de variables de entorno o tipos propios del SDK (como `integritySecret` o `RAPYD_API_ACCESS_KEY`).

**Solo se cuenta el código, no los comentarios**, igual que en la variable 1. El script lee cada archivo con el parser de TypeScript (`ts.createSourceFile`, que también lee el `.js` del cliente) y reemplaza por espacios los rangos de comentario antes de buscar. Así cada coincidencia conserva la línea y la columna del archivo original. Se reportan dos cifras: los **identificadores distintos** del catálogo que aparecen y sus **ocurrencias**.

**En el prototipo B ese conteo debe ser estrictamente cero**; si no lo es, la abstracción tiene una fuga. El plan de evaluación es explícito: eso sería un hallazgo negativo y hay que reportarlo igual.

---

## 3. Cómo se corre `ck-metrics.ts` sobre un prototipo

La variable 3 es la que el Hito H5 exige literalmente. Hasta el issue #130 no se podía recolectar: el script resolvía de forma fija contra `sdk/` la raíz de las fuentes, el `tsconfig.json` y los patrones de exclusión, y correrlo sobre la carpeta de un prototipo analizaba el SDK otra vez. El plan de evaluación lo lista como prerrequisito 3 de la Fase 5 y dice, textualmente, que es **"el más fácil de pasar por alto y el que puede costar más caro, porque es el que sostiene el Hito H5"**. El cambio está registrado en el punto 87 del `architecture-log.md`.

### Adaptación a unidad de archivo (`--unit file`, issue #134)

El módulo de pagos de B (`src/payments/`) no tiene ninguna clase: se compone de funciones de módulo en `src/payments/index.ts` y configuración en `src/payments/gateways.ts`. En D, cada pasarela tiene una clase y entre 6 y 12 funciones de módulo auxiliares que el script clásico de clases no veía.

Medir únicamente clases reportaba cero clases en B y dejaba fuera más del 40% de la lógica de D. Por tanto, `ck-metrics.ts` se adaptó para medir cada archivo como unidad (`--unit file` o `--unit all`):
- **WMC por archivo**: suma de la complejidad ciclomática de todas las funciones y métodos declarados en el archivo.
- **MAX_CC por archivo**: la complejidad ciclomática más alta entre las funciones y métodos del archivo.
- **CBO por archivo**: número de tipos externos distintos importados en el archivo que aparecen en las firmas de sus funciones y métodos.
- **RFC por archivo**: suma, sin duplicados en el archivo, de las funciones y métodos declarados localmente más las llamadas a métodos externos (con punto, salvo métodos sobre `this`) y las llamadas directas a funciones no declaradas en el archivo.

Desde `sdk/`, para cada prototipo:

```bash
npm run metrics -- --root ../prototypes/checkout-sin-solucion/src/payments --tsconfig ../prototypes/checkout-sin-solucion/tsconfig.json --unit file --json ../docs/evaluation/ck-checkout-sin-solucion.json
npm run metrics -- --root ../prototypes/checkout-con-sdk-front-back/src/payments --tsconfig ../prototypes/checkout-con-sdk-front-back/tsconfig.json --unit file --json ../docs/evaluation/ck-checkout-con-sdk-front-back.json
```

Las rutas de los prototipos son las de la sección 1; ajústelas si la estructura final es otra. Qué resuelve cada opción:

1. **La raíz de fuentes es un argumento** (`--root`, repetible). Sin argumentos, `npm run metrics` analiza `sdk/src` y `sdk/src-browser` y produce el mismo reporte que antes del cambio.
2. **El `tsconfig.json` del proyecto analizado es un argumento** (`--tsconfig`), porque un prototipo con otro `target` u otras rutas de módulos no se resuelve con el del SDK. Solo se admite junto con `--root`.
3. **La unidad de análisis** (`--unit class|file|all`). `--unit file` activa la medición por archivo para los prototipos. Por omisión es `class`.
4. **Las exclusiones de pruebas** (`*.test.ts`, `*.spec.ts`) se aplican dentro de cada raíz recibida.
5. **Las excepciones documentadas no se aplican a un proyecto externo.** `KNOWN_EXCEPTIONS` está indexado por nombre de clase, y una clase del prototipo que se llamara igual que una del SDK habría heredado su excepción: un umbral verde en el reporte y rojo en la realidad. Con `--root` el script no las aplica, y lo indica al final del reporte. Una prueba con un proyecto de muestra cuya clase se llama `Amount` lo comprueba (`sdk/test/scripts/ck-metrics.test.ts`). Desde el issue #153, un proyecto externo puede traer las suyas con `--exceptions <archivo>`, indexadas por archivo, clase y métrica. Lo usa el simulador; los prototipos no lo necesitan, porque se miden en modo medición y ahí no se exceptúa nada.
6. **El modo guarda y el modo medición están separados** (`--mode guard|measure`). En modo guarda, una violación sale con código 1: es la condición 4 de la Definition of Done y es el modo por omisión del SDK. En modo medición, **el valor alto es el dato**: el script reporta las violaciones y sale con 0. Es el modo por omisión con `--root`. Un argumento inválido sale con código 2.

Con `--json <archivo>`, el script escribe además la tabla completa con la fecha, el modo, las raíces, el `tsconfig`, los umbrales y si se aplicaron las excepciones. Ese archivo es el insumo de la recolección: la tabla de la consola tiene colores ANSI y no conviene copiarla al informe.

---

## 4. El otro prerrequisito: los escenarios del simulador

La variable 3 del checklist funcional es que el prototipo **distinga un rechazo de negocio de un fallo técnico y reintente solo el segundo.**

Eso no se puede implementar ni medir contra un simulador que solo sabe aprobar. Desde el issue #122, el simulador produce rechazos, pendientes, esperas y errores técnicos en las cuatro pasarelas, y un prototipo los provoca solo con el SDK: con los datos de prueba de cada pasarela, los montos reservados y las marcas en la credencial (punto 83 del `architecture-log.md`). Las combinaciones que siguen respondiendo `501` están en la sección 4 de [3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md).

De ahí sale el orden forzado de la Iteración 3: **escenarios del simulador → prototipos → métricas.** No es una preferencia de planificación, es una dependencia técnica.

---

## 5. Dónde va el resultado

En `docs/evaluation/`, que está reservada para eso. El informe tiene que contener, según el plan de evaluación: el diseño resumido, la tabla con las seis variables para ambos prototipos, el costo de agregar cada pasarela citado textualmente, las métricas CK de cada uno, la discusión de amenazas a la validez, y la conclusión **tal como salió, incluso si contradice la hipótesis**.

La tabla de la variable 2 —el costo de agregar cada pasarela— es la que conviene proyectar primero en la sustentación.

---

## 6. Las amenazas a la validez, que también hay que medir con honestidad

El plan las declara, y conviene tenerlas presentes al recolectar:

- **Somos autores e intérpretes.** La defensa es que cinco de las seis variables son contables por script y auditables por terceros.
- **El prototipo D puede quedar mal hecho sin querer.** La defensa es seguir la documentación oficial de cada pasarela y que lo revise alguien que no lo escribió.
- **Un solo autor escribió las pasarelas nuevas en B y en D** (punto 117). La mitigación de asignación del plan no se cumple, y el informe lo declara.
- **Nada se cobró en producción.** Desde los puntos 111 y 117, B y D cobran por omisión en el sandbox oficial de cada pasarela, y las pruebas automáticas corren contra el simulador. Que no haya cobros en producción es una limitación del alcance que va escrita en el informe.
- **Dos prototipos no son una muestra.** Es un estudio de caso comparativo, que es lo que el marco metodológico admite para evaluar un artefacto, y así se presenta.

Y una que no está en la lista de amenazas pero condiciona la recolección: **el tiempo de implementación queda fuera como evidencia principal**, porque quien implementa el segundo prototipo ya aprendió el dominio en el primero. Ese efecto de orden no se puede eliminar con cuatro personas y dos prototipos. Se puede registrar como dato secundario declarando el sesgo; presentarlo como evidencia principal sería indefendible ante un jurado.

---

## 7. Qué sigue

- Qué miden las métricas y por qué esas cuatro: [1-metricas-ck.md](1-metricas-ck.md).
- El diseño experimental completo: [prototypes-evaluation-plan.md](../project-management/prototypes-evaluation-plan.md).
- La comparación cualitativa que sí se puede afirmar hoy: [03-sdk/5-comparacion-con-integracion-directa.md](../03-sdk/5-comparacion-con-integracion-directa.md).
