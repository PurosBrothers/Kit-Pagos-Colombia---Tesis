# Cómo medir los prototipos

El experimento de la Fase 5 compara dos prototipos funcionalmente idénticos: uno que integra las pasarelas a mano y otro que usa el SDK. Este documento cubre la parte operativa: cómo se recolecta cada variable, incluida la más importante, que hasta el issue #130 no se podía recolectar.

> El diseño experimental está aprobado y vive en [prototypes-evaluation-plan.md](../project-management/prototypes-evaluation-plan.md). Este documento no lo reemplaza: resuelve el cómo.

---

## 1. Los dos prototipos y la regla que hace válida la comparación

| | Prototipo A — control | Prototipo B — tratamiento |
|---|---|---|
| Carpeta | `prototypes/checkout-directo/` | `prototypes/checkout-con-sdk/` |
| Cómo cobra | Integración directa contra las APIs nativas | A través de `kit-pagos-colombia` |
| Qué representa | Lo que hace hoy un desarrollador colombiano | Lo que propone la tesis |

**La regla dura: todo lo que no sea integración de pagos tiene que ser idéntico en los dos.** Misma interfaz, mismo servidor, misma estructura, mismas dependencias, mismo estilo. Si el prototipo B tuviera una interfaz más simple o menos validaciones, la diferencia medida no sería atribuible al framework.

La forma práctica de garantizarlo: construir un **esqueleto común**, copiarlo a las dos carpetas, y de ahí en adelante tocar **únicamente** el módulo de pagos de cada uno. **Ese esqueleto queda fuera del conteo de líneas.**

Y la otra mitad de la regla, la que es fácil de olvidar: los dos tienen que cubrir la misma funcionalidad, incluidos los tres puntos que un prototipo apurado omitiría —distinguir rechazo de fallo técnico, verificar la firma del webhook, y registrar el estado nativo para auditoría—. Un prototipo A que solo llame al endpoint de cobro no es una integración real: es la mitad de una, y compararla contra el framework completo **infla artificialmente la diferencia** a favor de la tesis.

---

## 2. Cómo se recolecta cada variable

| # | Variable | Cómo |
|---|---|---|
| 1 | Líneas de integración | Conteo sobre el módulo de pagos de cada prototipo, excluyendo el esqueleto común |
| 2 | Diff de migración | `git diff --stat` entre el commit de Wompi y el de Mercado Pago |
| 3 | **Métricas CK** | `npm run metrics -- --root <prototipo>/src --tsconfig <prototipo>/tsconfig.json --json <archivo>` sobre las clases de pago de cada prototipo — ver §3 |
| 4 | Conceptos nativos expuestos | Conteo de identificadores propios de pasarela en el código del prototipo |
| 5 | Pasarelas alcanzables | Cuántas de las cuatro puede usar sin escribir código nuevo |
| 6 | Cobertura de pruebas | Jest, con el mismo esfuerzo de pruebas en ambos |

### La variable 2 es la que más vale, y es la más fácil de recolectar

`git diff --stat` entre dos commits. Es **auditable por cualquiera** y no depende de quién lo cuente, que es exactamente lo que se quiere en un experimento donde los autores también son los evaluadores.

El procedimiento exige disciplina de commits: los dos prototipos se implementan con Wompi, se cierra ese estado con un commit en cada uno, y **solo después** se migran a Mercado Pago. Si la migración se mezcla con otros cambios en el mismo commit, la medición se contamina y no hay forma de limpiarla después.

### La variable 4 se puede automatizar, y conviene

Es un conteo de identificadores nativos en el código del prototipo:

```bash
# Sobre el módulo de pagos de cada prototipo
grep -rcoE "amount_in_cents|transaction_amount|acceptance_token|integrity|APPROVAL|CLO|x-signature|x-event-checksum|Private-Merchant-Id|access_key" \
  prototypes/checkout-directo/src/pagos/
```

**En el prototipo B ese conteo debería ser cero**, y si no lo es, la abstracción tiene una fuga. El plan de evaluación es explícito: eso sería un hallazgo negativo y hay que reportarlo igual.

---

## 3. Cómo se corre `ck-metrics.ts` sobre un prototipo

La variable 3 es la que el Hito H5 exige literalmente. Hasta el issue #130 no se podía recolectar: el script resolvía de forma fija contra `sdk/` la raíz de las fuentes, el `tsconfig.json` y los patrones de exclusión, y correrlo sobre `prototypes/checkout-directo/` analizaba el SDK otra vez. El plan de evaluación lo lista como prerrequisito 3 de la Fase 5 y dice, textualmente, que es **"el más fácil de pasar por alto y el que puede costar más caro, porque es el que sostiene el Hito H5"**. El cambio está registrado en el punto 87 del `architecture-log.md`.

Desde `sdk/`, para cada prototipo:

```bash
npm run metrics -- --root ../prototypes/checkout-directo/src --tsconfig ../prototypes/checkout-directo/tsconfig.json --json ../docs/evaluation/ck-checkout-directo.json
npm run metrics -- --root ../prototypes/checkout-con-sdk/src --tsconfig ../prototypes/checkout-con-sdk/tsconfig.json --json ../docs/evaluation/ck-checkout-con-sdk.json
```

Las rutas de los prototipos son las de la sección 1; ajústelas si la estructura final es otra. Qué resuelve cada opción:

1. **La raíz de fuentes es un argumento** (`--root`, repetible). Sin argumentos, `npm run metrics` analiza `sdk/src` y `sdk/src-browser` y produce el mismo reporte que antes del cambio.
2. **El `tsconfig.json` del proyecto analizado es un argumento** (`--tsconfig`), porque un prototipo con otro `target` u otras rutas de módulos no se resuelve con el del SDK. Solo se admite junto con `--root`.
3. **Las exclusiones de pruebas** (`*.test.ts`, `*.spec.ts`) se aplican dentro de cada raíz recibida.
4. **Las excepciones documentadas no se aplican a un proyecto externo.** `KNOWN_EXCEPTIONS` está indexado por nombre de clase, y una clase del prototipo que se llamara igual que una del SDK habría heredado su excepción: un umbral verde en el reporte y rojo en la realidad. Con `--root` el script no las aplica, y lo indica al final del reporte. Una prueba con un proyecto de muestra cuya clase se llama `Amount` lo comprueba (`sdk/test/scripts/ck-metrics.test.ts`).
5. **El modo guarda y el modo medición están separados** (`--mode guard|measure`). En modo guarda, una violación sale con código 1: es la condición 4 de la Definition of Done y es el modo por omisión del SDK. En modo medición, **el valor alto es el dato**: el script reporta las violaciones y sale con 0. Es el modo por omisión con `--root`. Un argumento inválido sale con código 2.

Con `--json <archivo>`, el script escribe además la tabla completa con la fecha, el modo, las raíces, el `tsconfig`, los umbrales y si se aplicaron las excepciones. Ese archivo es el insumo de la recolección: la tabla de la consola tiene colores ANSI y no conviene copiarla al informe.

---

## 4. El otro prerrequisito: los escenarios del simulador

La variable 3 del checklist funcional es que el prototipo **distinga un rechazo de negocio de un fallo técnico y reintente solo el segundo.**

Eso no se puede implementar ni medir contra un simulador que solo sabe aprobar. Desde el issue #122, el simulador produce rechazos, pendientes, esperas y errores técnicos en las cuatro pasarelas, y un prototipo los provoca solo con el SDK: con los datos de prueba de cada pasarela, los montos reservados y las marcas en la credencial (punto 83 del `architecture-log.md`). Las combinaciones que siguen respondiendo `501` están en la sección 4 de [3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md).

De ahí sale el orden forzado de la Iteración 3: **escenarios del simulador → prototipos → métricas.** No es una preferencia de planificación, es una dependencia técnica.

---

## 5. Dónde va el resultado

En `docs/evaluation/`, que está reservada para eso. El informe tiene que contener, según el plan de evaluación: el diseño resumido, la tabla con las seis variables para ambos prototipos, el diff de migración citado textualmente, las métricas CK de cada uno, la discusión de amenazas a la validez, y la conclusión **tal como salió, incluso si contradice la hipótesis**.

La tabla de la variable 2 —el costo de migrar— es la que conviene proyectar primero en la sustentación.

---

## 6. Las amenazas a la validez, que también hay que medir con honestidad

El plan las declara, y conviene tenerlas presentes al recolectar:

- **Somos autores e intérpretes.** La defensa es que cinco de las seis variables son contables por script y auditables por terceros.
- **El prototipo A puede quedar mal hecho sin querer.** La defensa es seguir la documentación oficial de cada pasarela y que lo revise alguien que no lo escribió.
- **Nada se probó contra pasarelas reales.** Los prototipos corren contra el simulador, y eso es una limitación del alcance que va escrita en el informe. Aunque conviene notar algo que cambió después de que ese plan se escribiera: `baseUrl` admite un mapa por pasarela, así que **si se quiere que los prototipos corran contra los sandboxes reales, técnicamente se puede** (punto 57). Sería una decisión de alcance, no un impedimento.
- **Dos prototipos no son una muestra.** Es un estudio de caso comparativo, que es lo que el marco metodológico admite para evaluar un artefacto, y así se presenta.

Y una que no está en la lista de amenazas pero condiciona la recolección: **el tiempo de implementación queda fuera como evidencia principal**, porque quien implementa el segundo prototipo ya aprendió el dominio en el primero. Ese efecto de orden no se puede eliminar con cuatro personas y dos prototipos. Se puede registrar como dato secundario declarando el sesgo; presentarlo como evidencia principal sería indefendible ante un jurado.

---

## 7. Qué sigue

- Qué miden las métricas y por qué esas cuatro: [1-metricas-ck.md](1-metricas-ck.md).
- El diseño experimental completo: [prototypes-evaluation-plan.md](../project-management/prototypes-evaluation-plan.md).
- La comparación cualitativa que sí se puede afirmar hoy: [03-sdk/5-comparacion-con-integracion-directa.md](../03-sdk/5-comparacion-con-integracion-directa.md).
