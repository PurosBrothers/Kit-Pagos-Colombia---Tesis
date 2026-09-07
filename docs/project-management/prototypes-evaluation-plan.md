# Plan de evaluación experimental: proyectos prototípicos (Fase 5, Hito H5)

Este documento define los proyectos prototípicos y el diseño de medición con el que se evalúa el framework frente a la integración directa contra las APIs nativas.

**Por qué existe y por qué ahora.** La Fase 2 del SPMP debía entregar, entre otras cosas, *"proyectos prototípicos definidos"* y *"criterios de evaluación formalizados"*. Ese entregable nunca se produjo como artefacto. Al mismo tiempo, `methodology.md` (sección 3) es explícita en que el milestone `Fase 5 – Demostración y evaluación` se crea *"cuando se llegue a esa fase, no antes"*. Este documento resuelve las dos cosas a la vez: cierra el entregable de Fase 2 sin abrir issues de Fase 5 antes de tiempo.

**Advertencia de cronograma.** La Fase 5 está comprimida de 3 a 2 semanas (5–19 oct) y `methodology.md` (sección 10.3) advierte que eso solo funciona si el tooling de métricas queda probado **antes** de entrar a la fase. Con el script de métricas CK (issue #19, PR #41) ya funcionando, esa condición está en camino de cumplirse. Lo que este documento agrega es la otra mitad: si los prototipos no están *definidos* antes de entrar a la Fase 5, las dos semanas se consumen discutiendo qué medir en vez de midiendo.

---

## 1. Qué exige el marco metodológico

El proyecto sigue Design Science Research, cuyo requisito central no es entregar software que funcione, sino **evaluar un artefacto frente a una alternativa de forma objetiva**. El Hito H5 se cumple cuando *"los proyectos prototípicos son evaluados con las métricas CK registradas"*.

Eso impone tres condiciones que el diseño tiene que respetar:

1. **Tiene que haber un grupo de control.** No basta mostrar que el framework funciona; hay que compararlo contra no usarlo.
2. **Las variables tienen que ser contables, no apreciaciones.** "Es más fácil de usar" no es evidencia. "Migrar de pasarela costó 1 línea contra 214" sí lo es.
3. **La medición tiene que ser reproducible.** Cualquiera con el repositorio debe poder recalcular los números.

---

## 2. Los dos prototipos

Un mismo caso de uso, implementado dos veces. El caso de uso es un **checkout mínimo de comercio electrónico**: mostrar un producto, cobrarlo, informar el resultado, recibir la notificación asíncrona y permitir consultar el estado.

| | Prototipo A — control | Prototipo B — tratamiento |
|---|---|---|
| **Carpeta** | `prototypes/checkout-directo/` | `prototypes/checkout-con-sdk/` |
| **Cómo cobra** | Integración directa contra las APIs nativas, con `fetch` y los formatos de cada pasarela | A través de `kit-pagos-colombia` |
| **Qué representa** | Lo que hace hoy un desarrollador colombiano | Lo que propone la tesis |

### La regla que hace válida la comparación

**Todo lo que no es integración de pagos debe ser idéntico en los dos prototipos.** Misma interfaz, mismo servidor, misma estructura de carpetas, mismas dependencias, mismo estilo. Si el prototipo B tuviera una interfaz más simple o menos validaciones, la diferencia medida no sería atribuible al framework.

La forma práctica de garantizarlo: construir primero un esqueleto común, copiarlo a las dos carpetas, y a partir de ahí tocar **únicamente** el módulo de pagos en cada uno. Ese esqueleto compartido queda fuera del conteo de líneas.

### Qué debe hacer cada prototipo, exactamente igual

Para que la comparación sea justa, los dos tienen que cubrir la misma funcionalidad. Si el prototipo A omite algo que el B trae gratis por el framework, hay que implementarlo en A también; de lo contrario el conteo premia al B por hacer menos.

1. Crear un pago por un monto en pesos con referencia de orden y datos del pagador.
2. Traducir el resultado a un estado propio del comercio (aprobado, rechazado, pendiente).
3. Distinguir un rechazo de negocio de un fallo técnico, y reintentar solo el segundo.
4. Verificar la firma de un webhook y actualizar el estado de la orden.
5. Consultar el estado de una transacción por su identificador.
6. Registrar el estado nativo original de la pasarela para auditoría.

Los puntos 3, 4 y 6 son los que hacen honesta la comparación. Un prototipo A que solo llame al endpoint de cobro y muestre el resultado no es una integración real: es la mitad de una, y compararla contra el framework completo infla artificialmente la diferencia.

---

## 3. El experimento central: el costo de migrar

Es la medición más valiosa del proyecto y conviene diseñarla primero, porque es la que responde directamente al problema de negocio que motiva la tesis (el *vendor lock-in*).

**Procedimiento:**

1. Ambos prototipos se implementan integrando **Wompi**.
2. Se hace un commit que cierre ese estado en los dos.
3. Se les pide a ambos **migrar a Mercado Pago**, manteniendo toda la funcionalidad.
4. Se mide el diff de esa migración en cada uno.

**Por qué Wompi → Mercado Pago y no otra pareja:** son las dos que más se diferencian en los tres ejes que importan. Wompi pide centavos enteros y Mercado Pago decimales; Wompi usa estados en mayúsculas y Mercado Pago en minúsculas; el webhook de Wompi trae el pago completo y el de Mercado Pago solo trae un identificador que obliga a una segunda petición. Una migración entre dos pasarelas parecidas subestimaría el costo real.

**Lo que se mide:** líneas agregadas y eliminadas, archivos tocados, y si la migración exigió cambiar el modelo de datos del comercio. Se obtiene con `git diff --stat` entre los dos commits, así que es verificable por cualquiera y no depende de quién lo cuente.

**La hipótesis, escrita antes de medir:** en el prototipo B la migración es un cambio de configuración de una línea, sin tocar el modelo de datos. En el prototipo A obliga a reescribir el mapeo de monto, la traducción de estados, la verificación de firma y el flujo de consulta.

Escribir la hipótesis antes de medir importa: si el resultado la contradice, eso también es un hallazgo válido de la tesis y hay que reportarlo, no ajustar el experimento hasta que salga el número esperado.

---

## 4. Variables medidas

Todas contables por script, ninguna por apreciación.

| # | Variable | Cómo se mide | Qué demuestra |
|---|---|---|---|
| 1 | **Líneas de código de integración** | Conteo sobre el módulo de pagos de cada prototipo, excluyendo el esqueleto común | El costo de la integración inicial |
| 2 | **Diff de migración** | `git diff --stat` entre el commit de Wompi y el de Mercado Pago | El costo del *vendor lock-in*, que es el problema de la tesis |
| 3 | **Métricas CK (WMC, CBO, RFC)** | El script de `ts-morph` del issue #19, corrido sobre las clases de pago de cada prototipo | Lo que exige literalmente el Hito H5 |
| 4 | **Conceptos nativos expuestos** | Conteo de identificadores propios de pasarela (`amount_in_cents`, `transaction_amount`, `APPROVAL`, `CLO`...) presentes en el código del prototipo | Cuánta documentación de pasarela tiene que leer el desarrollador |
| 5 | **Pasarelas alcanzables** | Cuántas de las cuatro puede usar el prototipo sin escribir código nuevo | La capacidad que el framework agrega |
| 6 | **Cobertura de pruebas** | Jest, con el mismo esfuerzo de pruebas en ambos | Si la abstracción hace el código más fácil de probar |

La variable 4 es más interesante de lo que parece. En el prototipo B el conteo debería ser **cero**: si aparece un solo `amount_in_cents` en el código del comercio, significa que la abstracción tiene una fuga, y eso sería un hallazgo negativo que hay que reportar igual.

### Lo que no se va a medir como evidencia principal

**El tiempo de implementación.** Es la métrica más intuitiva y la más contaminada: quien implementa el segundo prototipo ya aprendió el dominio en el primero, así que siempre va a ser más rápido, independientemente del framework. Ese es un efecto de orden clásico y no se puede eliminar con cuatro personas y dos prototipos.

Se puede registrar como dato secundario, declarando el sesgo de forma explícita. Presentarlo como evidencia principal sería metodológicamente indefendible, y es exactamente el tipo de cosa que un jurado pregunta.

**Mitigación parcial:** que el prototipo A (integración directa) lo construya una persona distinta de quien construye el B, y que ninguna de las dos sea quien escribió el adaptador de la pasarela en cuestión. No elimina el sesgo, pero lo reduce y deja constancia de que se consideró.

---

## 5. Amenazas a la validez, declaradas

Un informe comparativo que no discute sus propias debilidades es más fácil de refutar que uno que las anticipa.

**Somos autores e intérpretes.** El mismo equipo que construyó el framework mide si el framework sirve. El sesgo es inevitable; la defensa es que las variables 1 a 5 son contables por script y auditables por terceros, no juicios nuestros.

**El prototipo A puede estar mal hecho a propósito.** Sin querer, es fácil escribir la integración directa de forma más torpe de lo que la escribiría alguien experto. La defensa es seguir la documentación oficial de cada pasarela y sus ejemplos, y dejar el código de A revisado por alguien que no lo escribió, igual que exige el DoD.

**Nada se probó contra pasarelas reales.** Los prototipos corren contra la API de Simulación. Eso es una limitación honesta del alcance y debe quedar escrita en el informe. Lo que sí puede afirmarse es que la forma de las respuestas se derivó de la documentación oficial y está registrada campo por campo en `ubiquitous-language.md`.

**Dos prototipos no son una muestra.** No hay significancia estadística ni pretensión de tenerla. Es un estudio de caso comparativo, que es lo que DSR admite para evaluar un artefacto, y así debe presentarse.

---

## 6. Entregable de la Fase 5

Un informe comparativo, en `docs/evaluation/`, que contenga:

- El diseño experimental (esta sección, resumida).
- Una tabla con las seis variables medidas para ambos prototipos.
- El diff de migración de cada prototipo, citado textualmente.
- Las métricas CK de las clases de pago de cada uno.
- La discusión de amenazas a la validez.
- La conclusión, con el resultado tal como salió, incluso si contradice la hipótesis.

Los números de ese informe son el material de la sustentación, y la tabla de la variable 2 (el costo de migrar) es la que conviene proyectar primero.

---

## 7. Prerrequisitos antes de entrar a la Fase 5

La fase comprimida de dos semanas solo cabe si al llegar el 5 de octubre ya es cierto todo esto:

1. Los cuatro adaptadores implementados y probados (cierra al final de la Iteración 2).
2. La API de Simulación con los escenarios de rechazo, timeout y error de red (Iteración 3). Sin ellos no se puede medir la variable 3 del checklist funcional, que es la distinción entre rechazo de negocio y fallo técnico.
3. El script de métricas CK funcionando y aplicable a un proyecto externo, no solo a `sdk/`. Hoy resuelve las rutas contra `sdk/src` de forma fija; habrá que parametrizarlo para poder correrlo sobre `prototypes/`.
4. Este documento revisado y aprobado por el equipo, para no discutir el diseño durante la fase.

El punto 3 es el más fácil de pasar por alto y el que puede costar más caro, porque es el que sostiene el Hito H5.

---

## 8. Cuándo crear los issues

Al cerrar la Iteración 3 (Hito H4, ~5 de octubre), crear el milestone `Fase 5 – Demostración y evaluación` sin sufijo semanal, según la sección 3 de `methodology.md`, y abrir los issues correspondientes a: el esqueleto común, cada prototipo, el experimento de migración, la recolección de métricas, y el informe comparativo.

Responsable primario de la fase: Joan, por rol de líder de evaluación y documentación. Pero la regla de `methodology.md` de que *"todos los integrantes deben aportar a todos los entregables durante la Fase 4"* aplica con más razón acá: el prototipo A y el prototipo B deben construirlos personas distintas, por la mitigación de sesgo de la sección 4.
