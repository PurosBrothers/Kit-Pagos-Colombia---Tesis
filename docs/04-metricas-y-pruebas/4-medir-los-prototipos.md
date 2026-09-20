# Cómo medir los prototipos

El experimento de la Fase 5 compara dos prototipos funcionalmente idénticos: uno que integra las pasarelas a mano y otro que usa el SDK. Este documento cubre la parte operativa —cómo se recolecta cada variable— y el bloqueo técnico que hay que resolver antes de poder recolectar la más importante.

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
| 3 | **Métricas CK** | `npm run metrics` sobre las clases de pago de cada prototipo — **bloqueado, ver §3** |
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

## 3. El bloqueo: `ck-metrics.ts` no acepta una ruta

La variable 3 es la que el Hito H5 exige literalmente, y hoy **no se puede recolectar**.

El script resuelve sus rutas de forma fija contra el propio SDK:

```423:436:sdk/scripts/ck-metrics.ts
  const sdkRoot = path.resolve(__dirname, '..', 'src');

  const project = new Project({
    tsConfigFilePath: path.resolve(__dirname, '..', 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths([
    `${sdkRoot}/**/*.ts`,
    `!${sdkRoot}/**/*.test.ts`,
    `!${sdkRoot}/**/*.spec.ts`,
  ]);
```

Son tres cosas atadas a `sdk/`: la raíz de las fuentes, el `tsconfig.json` y los patrones de exclusión. Correrlo sobre `prototypes/checkout-directo/` hoy analizaría el SDK otra vez.

### Qué hay que cambiar

1. **Aceptar la raíz de fuentes como argumento**, con `sdk/src` por defecto para no romper `npm run metrics`.
2. **Aceptar el `tsconfig.json` del proyecto analizado**, porque `ts-morph` necesita resolver los tipos del proyecto que está leyendo. Un prototipo con otro `target` o otras rutas de módulos no se resuelve con el `tsconfig` del SDK.
3. **Mantener las exclusiones de pruebas** relativas a la raíz que se pase.
4. **Decidir qué pasa con las excepciones documentadas.** El registro `KNOWN_EXCEPTIONS` está indexado por nombre de clase, y una clase del prototipo que se llame igual que una del SDK heredaría su excepción. Sería un defecto silencioso: un umbral verde en el reporte y rojo en la realidad, que es justamente lo que la regla de excepciones existe para impedir. Lo razonable es que **las excepciones no apliquen cuando se analiza un proyecto externo**.
5. **Decidir el criterio de salida.** Para el SDK, violar un umbral tiene que fallar con código 1. Para medir un prototipo, **el valor alto es el dato**: el prototipo de integración directa probablemente viole umbrales, y eso es el hallazgo, no un error. El modo de medición debería reportar sin fallar.

El punto 4 y el punto 5 son los que hacen que esto no sea solo "agregarle un parámetro": hay que distinguir **modo guarda** de **modo medición**, porque tienen criterios de éxito opuestos.

### Por qué esto es urgente y no un detalle

El plan de evaluación lo lista como prerrequisito 3 de la Fase 5 y dice, textualmente, que es **"el más fácil de pasar por alto y el que puede costar más caro, porque es el que sostiene el Hito H5"**.

Y hay una razón de secuencia: los prototipos se construyen en la Iteración 3, y medirlos es lo primero que hace la Fase 5. Si el script se parametriza recién cuando haya que medir, se descubre en ese momento que la decisión sobre las excepciones y el código de salida no está tomada, en la fase que tiene dos semanas para medir, correr el experimento de migración y escribir el informe.

---

## 4. El otro prerrequisito: los escenarios del simulador

La variable 3 del checklist funcional es que el prototipo **distinga un rechazo de negocio de un fallo técnico y reintente solo el segundo.**

Eso no se puede implementar ni medir contra un simulador que solo sabe aprobar, que es lo que hay hoy: el motor de escenarios resuelve `APPROVED` y solo para Wompi, y cualquier otro escenario devuelve `501`.

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
