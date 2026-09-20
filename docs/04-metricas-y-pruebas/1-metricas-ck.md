# Las métricas CK

Cuatro métricas de la suite de Chidamber & Kemerer, calculadas sobre el código del SDK en cada revisión. Este documento explica qué mide cada una, por qué esas cuatro, cómo se calculan y qué reporta el SDK hoy.

> **La fuente normativa es [methodology.md §6.1](../project-management/methodology.md).** Ahí están las fórmulas exactas y los umbrales, y ahí es donde se cambian. Este documento las explica; no las duplica, porque dos definiciones de la misma métrica en dos archivos es exactamente el problema que estas métricas ya tuvieron una vez.

---

## 1. Por qué se miden

Porque el Hito H5 del trabajo de grado lo exige, y porque son el insumo de la variable 3 del experimento de la Fase 5: comparar la complejidad y el acoplamiento del código de pagos de un prototipo que usa el SDK contra uno que integra a mano.

Pero tienen un segundo uso, más cotidiano y más útil: **`npm run metrics` sale con código 1 si alguna clase viola un umbral sin excepción documentada.** Es una guarda sobre el diseño, no un reporte para el informe final.

---

## 2. Las cuatro métricas

| Métrica | Qué mide | Umbral |
|---|---|---|
| **WMC** (*Weighted Methods per Class*) | Suma de la complejidad ciclomática de todos los métodos y constructores. Acota **cuánto hace la clase en total** | ≤ 20 |
| **MAX_CC** | La complejidad ciclomática más alta entre los métodos. Acota **cuánto hace un método** | ≤ 10 |
| **CBO** (*Coupling Between Objects*) | Cuántas clases externas distintas aparecen en las firmas. Acota **con cuántas clases habla** | ≤ 5 |
| **RFC** (*Response For a Class*) | Métodos propios más nombres de método distintos invocados sobre otros objetos. Acota **el tamaño del conjunto de respuesta** | ≤ 20 |

**Por qué hacen falta WMC y MAX_CC juntas**, si las dos hablan de complejidad: responden preguntas distintas. Una clase puede tener un total aceptable y esconder un método ilegible. Y al revés: una clase cohesiva puede tener un total alto compuesto enteramente de métodos triviales. `Amount` es el segundo caso, y por eso la métrica que decide ahí es MAX_CC.

**Una propiedad de WMC que sorprende y conviene saber:** **WMC no baja al extraer métodos.** La complejidad de un método es `1 + D`, donde `D` son sus puntos de decisión. Al partirlo en *k* métodos los puntos se reparten, pero cada método nuevo aporta su propio `1`, así que el total pasa de `1 + D` a `k + D`: sube. Bajar el WMC de una clase exige **eliminar lógica duplicada o dividir la clase**, no reorganizar sus métodos. Eso hace a WMC resistente a la cosmética, que es justo lo que se quiere de una métrica.

---

## 3. El defecto que corrigió la fórmula

Esta es la historia más instructiva del proyecto en materia de métricas, y está en el punto 34 del [architecture-log](../architecture/architecture-log.md).

Durante un tiempo, el script calculó WMC como **conteo de métodos**. Con esa fórmula, una clase con **un único método de 360 líneas** —un `switch` de cuatro ramas con tres `switch` anidados dentro— puntuaba **WMC 1: el mejor valor de todo el SDK.**

O sea que la métrica de complejidad era ciega a la complejidad, y **premiaba concentrar código en un solo método**. El umbral estaba verde en el reporte y rojo en la realidad.

La corrección fue implementar la definición canónica de Chidamber & Kemerer: suma de complejidades ciclomáticas. El método saltó a un valor altísimo, la violación se hizo visible, y eso forzó a dividir el normalizador en una implementación por pasarela, que es la estructura que tiene hoy.

**La lección, que vale más allá de este proyecto: una métrica mal definida es peor que ninguna**, porque da una falsa sensación de control. Y tiene una consecuencia directa sobre la validez del experimento de la Fase 5: el patrón "todo el mapeo concentrado en un método gigante" es exactamente el que se espera encontrar en el prototipo de integración directa. Con la fórmula vieja, el prototipo más complejo habría reportado el mejor WMC y la comparación habría dicho lo contrario de lo que ocurre en el código.

Dos ajustes acompañaron la corrección:

- **El umbral de WMC subió de 15 a 20.** No es un relajamiento: son escalas distintas y el 15 no era comparable. El 20 es el valor que reporta el SATC de NASA para el WMC canónico.
- **MAX_CC se agregó**, con el umbral clásico de McCabe en 10. Es una restricción nueva que antes no existía, y es más estricta en lo que importa.

---

## 4. Cómo las calcula el script

[sdk/scripts/ck-metrics.ts](../../sdk/scripts/ck-metrics.ts), 516 líneas, con `ts-morph` para analizar el árbol sintáctico. No usa expresiones regulares ni cuenta líneas: recorre nodos.

La complejidad ciclomática de un método es `1 + puntos de decisión`, y qué cuenta como punto de decisión está fijado en la metodología. Dos decisiones que vale la pena conocer porque no son obvias:

- **`default` no cuenta.** Es el camino que ya existía si ningún `case` coincide, no una rama adicional.
- **El encadenamiento opcional `?.` no cuenta.** Cortocircuita un acceso a propiedad, no una rama que el lector tenga que seguir mentalmente. Sí cuentan `&&`, `||` y `??`.

**RFC usa el conteo de métodos, no el WMC.** Alimentarlo con el WMC ponderado lo haría crecer con cada `if` agregado dentro de un método existente, y eso no es lo que mide el tamaño de un conjunto de respuesta.

---

## 5. Lo que reporta el SDK hoy

31 clases analizadas, **todas dentro de los umbrales**. Los valores más altos:

| Clase | WMC | CBO | RFC | MAX_CC |
|---|---|---|---|---|
| `Amount` | **23** | 1 | 18 | 4 |
| `RapydAdapter` | 20 | **6** | 14 | 4 |
| `KushkiAdapter` | 19 | **6** | 12 | 8 |
| `ErrorHandler` | 17 | 2 | 6 | 7 |
| `WompiAdapter` | 15 | **6** | 15 | 6 |
| `MercadoPagoAdapter` | 15 | **6** | 11 | 7 |
| `KitPagos` | 15 | **6** | 10 | 9 |
| `SdkConfigurator` | 15 | 2 | 8 | 6 |
| `Transaction` | 5 | **7** | 5 | 1 |
| `RapydResponseNormalizer` | 15 | 2 | 4 | 10 |

Los valores en negrita superan su umbral y están cubiertos por una **excepción documentada**. El reporte los muestra en rojo igual, a propósito: una excepción no borra el número, solo explica por qué se acepta.

---

## 6. Las tres excepciones, y por qué son legítimas

La regla de admisión, fijada en [methodology.md §6.2](../project-management/methodology.md): **cada excepción tiene que enlazar al punto del architecture-log que la justifica.** Agregar una clase al registro sin ese respaldo no es una resolución válida, porque deja el umbral verde en el reporte y rojo en la realidad.

### `Amount` — WMC 23 (punto 34)

WMC 23 es la suma de 12 métodos cuya complejidad máxima es **4**. No hay ningún método complejo: hay muchas operaciones pequeñas, y esas operaciones son la superficie que un objeto de valor de dinero con aritmética exacta necesita tener.

Partirla para bajar la suma separaría las operaciones de dinero de su invariante de escala, que es justamente lo que la clase existe para garantizar. **La señal que sí aplica acá es MAX_CC, y está en 4 de 10.**

### `Transaction` — CBO 7 (punto 22)

Es la única entidad del dominio, y se construye a partir de los objetos de valor del modelo unificado. Su CBO es una consecuencia directa de eso: siete tipos del dominio en el constructor.

Bajarlo exigiría agrupar objetos de valor en estructuras intermedias sin significado de negocio, o aceptar primitivos en lugar de objetos de valor. Las dos opciones empeoran el diseño para mejorar un número.

### Los cuatro adaptadores y la fachada — CBO 6 (punto 47)

Esta es la más interesante, porque **es una métrica cobrando una decisión en el momento exacto en que se tomó.**

Al completar el soporte de PSE se agregó `getPseBanks(): Promise<PseBank[]>` al puerto. Eso subió el CBO de 5 a 6 en las cinco clases que tienen que nombrar ese tipo de retorno, **todas de golpe y todas por la misma razón**: estaban exactamente en el umbral, y el puerto creció.

No es que el diseño se acoplara más de lo debido. Es que **crecer no es gratis**, y la métrica lo cobró: el issue lo afirmó en prosa y el número lo confirmó.

Tampoco es el acoplamiento que CBO quiere detectar: `PseBank` es una interfaz de dos cadenas sin comportamiento, y CBO la cuenta igual que a un colaborador que se inyecta y se invoca. La señal que sí discrimina eso es WMC, y las cinco clases están por debajo del umbral.

**Y lo más importante: las violaciones de WMC del mismo cambio se corrigieron en vez de declararse.** Rapyd estaba en 23 y Kushki en 22, y bajaron moviendo lógica de traducción a funciones de módulo. Solo se declaró excepción para lo que no era reorganizable sin empeorar el diseño.

Las dos formas de bajar ese CBO 6 se evaluaron y se descartaron con razones:

- **Devolver un tipo estructural en línea** (`Promise<{ code: string; name: string }[]>`) esquiva el conteo sin cambiar el diseño, y empeora lo que importa: el tipo pierde su nombre y su documentación. Es manipular la métrica.
- **Sacar la lista de bancos a un puerto aparte** implementado por cuatro clases nuevas mueve el acoplamiento sin reducirlo, y le devuelve al comercio la pregunta de si su pasarela sabe responder, que es justo la que el SDK existe para que no tenga que hacerse.

> Nota de consistencia: `methodology.md` §6.2 enumera las dos primeras excepciones. La tercera, del punto 47, está implementada en el script y documentada en el architecture-log.

---

## 7. Qué pasa cuando una métrica se viola

Según la metodología: si un valor supera su umbral durante la revisión de un pull request y no está cubierto por una excepción documentada, **se registra como defecto y el código no se aprueba** hasta resolver la violación. Si la violación persiste dos iteraciones consecutivas sobre la misma clase, se convoca una sesión técnica de refactorización.

**Y hay algo que conviene saber sobre esto: `npm run metrics` no corre en CI.** Es uno de los cuatro comandos que quedan fuera, así que un pull request puede estar verde en GitHub y violar un umbral igual. Hay que correrlo a mano, y está en el bloque de verificación de [00-entorno-de-desarrollo.md](../00-entorno-de-desarrollo.md).

---

## 8. Cómo alimentan el experimento de la Fase 5

Son la variable 3 de las seis que mide el experimento, y la que el Hito H5 exige literalmente. Se corren sobre las clases de pago de cada prototipo y se comparan.

**Hay un bloqueo concreto antes de poder hacerlo**, y está en [4-medir-los-prototipos.md](4-medir-los-prototipos.md): el script resuelve sus rutas de forma fija contra `sdk/src`, así que hoy no se puede correr sobre `prototypes/`. Es el prerrequisito 3 del plan de evaluación, el que ese plan señala como el más fácil de pasar por alto y el que sostiene el Hito H5.

---

## 9. Qué sigue

- Las pruebas: [2-pruebas-del-sdk.md](2-pruebas-del-sdk.md).
- El bloqueo para medir los prototipos: [4-medir-los-prototipos.md](4-medir-los-prototipos.md).
