# Informe comparativo de la Fase 5: prototipos B y D

**Issue:** [#135](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/135) — entregable de la Fase 5, Hito H5.
**Datos de origen:** [#134](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134), comentario de resultados del 28 de octubre de 2026: [issuecomment-6478277137](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134#issuecomment-6478277137).
**Fecha del informe:** 8 de noviembre de 2026.
**Commit medido:** [`eabba18`](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/commit/eabba18).
**Sujetos:** prototipo **D** (control, integración directa) y prototipo **B** (tratamiento, integración con `kit-pagos-colombia`).

> **Qué es y qué no es este documento.** Es la redacción del entregable que pide la §6 del [plan de evaluación](../project-management/prototypes-evaluation-plan.md). Transcribe las cifras ya medidas y versionadas en el #134, sin volver a medirlas, sin redondearlas y sin reinterpretarlas. El código de los módulos de pagos no cambió entre `eabba18` y la fecha de este informe; la comprobación está en la §7.3. La medición nueva que sí se agrega es el corte por clase de las métricas CK, que el plan pide y el #134 no incluía; se declara en la §4.2 y su alcance está acotado.

---

## 1. Diseño experimental, resumido

El experimento compara dos implementaciones del mismo checkout mínimo de comercio electrónico: mostrar un producto, cobrarlo, informar el resultado, recibir la notificación asíncrona y permitir consultar el estado. Las dos cubren las cuatro pasarelas —Wompi, Mercado Pago, Kushki y Rapyd— desde el 22 de octubre de 2026, cuando entraron los commits de cada pasarela; la decisión de medir así es del 20 de octubre (punto 117 del [`architecture-log.md`](../architecture/architecture-log.md)).

| | Prototipo D — control | Prototipo B — tratamiento |
|---|---|---|
| **Carpeta** | [`prototypes/checkout-sin-solucion/`](../../prototypes/checkout-sin-solucion/) | [`prototypes/checkout-con-sdk-front-back/`](../../prototypes/checkout-con-sdk-front-back/) |
| **Cómo cobra** | Integración directa contra la API nativa de cada pasarela, con `fetch` y los formatos de cada una | Las cuatro a través de `kit-pagos-colombia` v0.7.0-rc.2, con tokenización en el navegador |
| **Qué representa** | Lo que hace hoy un desarrollador colombiano | Lo que propone la tesis |

**La regla que hace válida la comparación.** Todo lo que no es integración de pagos es idéntico en los dos prototipos: mismo esqueleto, mismo servidor, mismo contrato `PaymentsPort`, mismas rutas, mismas dependencias. Las vitrinas sí difieren —D vende cómics y B vinos—, y esa es una excepción declarada que se discute en la §5.5. Las variables 1 y 2 se cuentan solo sobre `src/payments/` y `test/payments/`, que la excepción no toca.

**El experimento central.** Un commit base introduce el contrato para varias pasarelas con Wompi como única pasarela registrada. Después, Mercado Pago, Kushki y Rapyd se agregan en ese orden, una por commit, en los dos prototipos. La variable 2 mide el diff de cada uno de esos commits. La disciplina de commits es lo que hace auditable el costo (punto 117 del `architecture-log.md`).

**Las seis variables.** Líneas de código de integración, costo de agregar cada pasarela, métricas CK, conceptos nativos expuestos, pasarelas alcanzables y cobertura de pruebas. Ninguna es una apreciación: las seis se obtienen con un script o con un comando de Git reproducible.

**La hipótesis, escrita antes de medir** (20 de octubre de 2026, antes del primer commit de pasarela; [plan de evaluación](../project-management/prototypes-evaluation-plan.md), §3):

> - **En el prototipo B, agregar una pasarela es configuración:** leer sus credenciales y registrarla, sin escribir su mapeo de monto, su traducción de estados, su verificación de firma ni su flujo de consulta, y sin tocar el esqueleto ni el modelo de datos.
> - **En el prototipo D, cada pasarela obliga a escribir todo eso,** y además su tokenización en el navegador en Mercado Pago y Kushki.

**Lo que queda fuera como evidencia principal.** El tiempo de implementación, porque quien construye el segundo prototipo ya aprendió el dominio en el primero. Se declara en la §5.8. Tampoco se mide el costo interno del SDK: las variables 1 y 2 cuentan lo que escribe el comercio en su módulo de pagos, no lo que costó construir el framework. Ese perímetro se declara en la §5.9.

---

## 2. Las seis variables medidas

Las cifras de esta tabla son las del #134, sin cambios. La columna **Fuente** enlaza al comentario del #134 que contiene la fila; GitHub no ofrece un ancla por fila de tabla, así que el enlace apunta al comentario completo y la §7 identifica la fila exacta.

| # | Variable | Prototipo D (control) | Prototipo B (tratamiento) | Diferencia / efecto | Fuente |
|---|---|---|---|---|---|
| **1** | **Líneas de código de integración (LOC)** | **1 308** LOC<br>(TS: 1 191, JS: 117)<br>(374 comentarios, 172 blancos) | **310** LOC<br>(TS: 298, JS: 12)<br>(91 comentarios, 30 blancos) | **-76.30 %** (-998 LOC de integración) | [#134, variable 1](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134#issuecomment-6478277137) |
| **2** | **Costo de agregar cada pasarela** | «Líneas agregadas» del diff en `src/payments`:<br>MP (`f335296`): +385 / −2<br>Kushki (`ad917db`): +338 / −2<br>Rapyd (`ccd54dd`): +319 / −1<br>**Total 3 nuevas: +1 042 / −5** | «Líneas agregadas» del diff en `src/payments`:<br>MP (`7b00381`): +18 / −1<br>Kushki (`2466495`): +20 / −5<br>Rapyd (`daad2aa`): +29 / −8<br>**Total 3 nuevas: +67 / −14** | **-93.57 %** de líneas agregadas en `src/payments/` para sumar 3 pasarelas (+1 042 vs +67) | [#134, variable 2](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134#issuecomment-6478277137) |
| **3** | **Métricas CK por archivo** | **Total WMC: 375** (prom. 62.5)<br>WMC máx: 94 (`wompi.ts`)<br>**MAX_CC: 19** (`wompi.ts`, `mercadopago.ts`)<br>CBO prom: 5.67 (máx 8)<br>**Total RFC: 217** (prom. 36.17, máx 48)<br>Violaciones: 5/6 archivos | **Total WMC: 66** (prom. 33.0)<br>WMC máx: 47 (`index.ts`)<br>**MAX_CC: 10** (`index.ts`, cumple umbral DoD)<br>CBO prom: 7.0 (máx 14)<br>**Total RFC: 44** (prom. 22.0, máx 38)<br>Violaciones: 1/2 archivos | **-82.40 %** en WMC total<br>**-47.37 %** en MAX_CC (10 ≤ 10 cumple umbral DoD)<br>**-39.17 %** en RFC promedio (36.17 vs 22.00)<br>**+23.53 %** en CBO promedio (7.0 vs 5.67: B acopla más tipos por archivo) | [#134, variable 3](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134#issuecomment-6478277137) |
| **4** | **Conceptos nativos expuestos** | **10 identificadores distintos** y **18 ocurrencias** en código (sin comentarios)<br>(Rapyd: 8 ocur. / 3 dist.; Kushki: 4 ocur. / 3 dist.; Wompi: 4 ocur. / 2 dist.; MP: 2 ocur. / 2 dist.) | **0 identificadores distintos** y **0 ocurrencias**<br>(Verificado con `--assert-zero`) | Ninguno de los 14 identificadores del catálogo aparece en el código de pagos de B | [#134, variable 4](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134#issuecomment-6478277137) |
| **5** | **Pasarelas alcanzables** | **4 de 4** (100 %)<br>Tarjeta y PSE en las cuatro | **4 de 4** (100 %)<br>Tarjeta y PSE en las cuatro | **Paridad funcional completa.** Cada cobro tiene su identificador, salvo el PSE de Kushki: UAT lo deja en `initializedTransaction` y el simulador lo aprueba por el webhook firmado (`approvedTransaction`) | [#134, variable 5](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134#issuecomment-6478277137) |
| **6** | **Cobertura de pruebas** | **90.03 %** Sentencias<br>**81.08 %** Ramas<br>**83.18 %** Funciones<br>**96.19 %** Líneas<br>(239 pruebas en 10 suites) | **100 %** Sentencias<br>**97.59 %** Ramas<br>**100 %** Funciones<br>**100 %** Líneas<br>(165 pruebas en 6 suites) | **+9.97 puntos porcentuales** en Sentencias<br>**+16.51 puntos porcentuales** en Ramas<br>(B tiene 165 pruebas y D 239, el 69 %) | [#134, variable 6](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134#issuecomment-6478277137) |

### 2.1. Lectura de la variable 1

`cloc@2.10.0` cuenta solo la columna `code` de `src/payments/`, sin comentarios ni líneas en blanco. El prototipo D escribe 1 308 líneas de integración; el B, 310. La diferencia de **-998 líneas** y el **-76.30 %** son los del #134. Es el costo de la integración completa en el módulo de pagos, no el costo de construir el SDK.

### 2.2. Lectura de la variable 2

El detalle por pasarela está en la §3. Los totales de las tres pasarelas nuevas son **+1 042 / −5** en D y **+67 / −14** en B, y la diferencia es **-93.57 %** de líneas agregadas. La cifra mide líneas del diff, con comentarios y blancos del commit, y por eso no coincide con las LOC netas de `cloc` de la variable 1.

### 2.3. Lectura de la variable 3

La cifra normativa del #134 es la medición por archivo, adoptada porque el módulo de pagos de B no contiene clases (issue #134; §3 de [Cómo medir los prototipos](../04-metricas-y-pruebas/4-medir-los-prototipos.md)). El WMC total de D es 375 y el de B 66; el **-82.40 %** es el del #134. El RFC promedio baja de 36.17 a 22.00 (**-39.17 %**), y el MAX_CC baja de 19 a 10 (**-47.37 %**), que es el umbral del DoD. En cambio, el CBO promedio sube de 5.67 a 7.0 (**+23.53 %**): B acopla más tipos externos por archivo, y eso se reporta como salió. El detalle por archivo y por clase está en la §4.

### 2.4. Lectura de la variable 4

El script versionado `sdk/scripts/native-concepts.ts` busca 14 identificadores nativos con fronteras de palabra y excluye comentarios. En D aparecen **10 identificadores distintos en 18 ocurrencias**; en B, **0 y 0**, verificado con `--assert-zero`. El resultado era el exigido por el plan: si aparecía un solo identificador en B, la abstracción tenía una fuga y había que reportarlo. No apareció ninguno.

### 2.5. Lectura de la variable 5

Los dos prototipos alcanzan **4 de 4 pasarelas (100 %)**, con tarjeta y PSE. La única casilla sin identificador es el PSE de Kushki, y no es una diferencia entre B y D: el UAT de Kushki no cierra transferencias y deja `initializedTransaction`; el simulador local la aprueba por el webhook firmado y deja `approvedTransaction` (punto 121 del `architecture-log.md`). La tabla con las transacciones y sus identificadores está en la §4 de [la recolección de las seis variables](recoleccion-seis-variables.md).

### 2.6. Lectura de la variable 6

Jest con `collectCoverageFrom: ["src/payments/**"]` da, en D, **90.03 %** de sentencias y **81.08 %** de ramas con 239 pruebas en 10 suites; en B, **100 %** y **97.59 %** con 165 pruebas en 6 suites. La diferencia es de **+9.97 puntos porcentuales** en sentencias y **+16.51** en ramas. B queda mejor cubierto con menos pruebas porque la lógica compleja de las pasarelas vive en el SDK, no en su módulo de pagos.

---

## 3. El costo de agregar cada pasarela, contra la hipótesis

### 3.1. Los diffs, citados textualmente del #134

**Fuente:** [fila de la variable 2 del #134](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134#issuecomment-6478277137). Las cifras de `src/payments` y `test/payments` son las del #134. La columna «Fuera de pagos» también.

| Pasarela | Prototipo | Commit | `src/payments` | `test/payments` | Fuera de pagos |
|---|---|---|---|---|---|
| Mercado Pago | D | [`f335296`](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/commit/f335296) | +385 −2 | +373 −1 | Ninguno |
| Mercado Pago | B | [`7b00381`](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/commit/7b00381) | +18 −1 | +51 −0 | Ninguno |
| Kushki | D | [`ad917db`](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/commit/ad917db) | +338 −2 | +296 −1 | Ninguno |
| Kushki | B | [`2466495`](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/commit/2466495) | +20 −5 | +65 −0 | `package.json` (+1 −1) y `package-lock.json` (+4 −4), en B y también en D, por la versión 0.7.0-rc.1 del SDK |
| Rapyd | D | [`ccd54dd`](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/commit/ccd54dd) | +319 −1 | +287 −1 | Ninguno |
| Rapyd | B | [`daad2aa`](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/commit/daad2aa) | +29 −8 | +121 −0 | Ninguno |

Los totales de las tres pasarelas nuevas son **+1 042 / −5** en D y **+67 / −14** en B, con una reducción de **93.57 %** en líneas agregadas. En B, las 67 líneas agregadas se reparten así: **58 en `gateways.ts`**, la configuración de cada pasarela, y **9 en `index.ts`**, el módulo común; la descomposición es la del #134. Esas 9 líneas no son configuración. En Kushki (`2466495`), el webhook pasa a guardar el estado nativo (`event.rawStatus`). En Rapyd (`daad2aa`), `publicConfig` deja de entregar la llave pública cuando la pasarela cobra en su página, y el webhook pasa `orderReference`. El estado nativo y la referencia de la orden llegaron con la 0.7.0-rc.1 del SDK (punto 118).

### 3.2. La hipótesis, punto por punto

La hipótesis se escribió antes de medir y decía que en B agregar una pasarela es **configuración**, sin escribir mapeo de monto, traducción de estados, verificación de firma ni flujo de consulta, y sin tocar el esqueleto ni el modelo de datos. En D, cada pasarela obliga a escribir todo eso.

**Mercado Pago.** En D costó **+385** líneas en `src/payments` y **+373** en pruebas: autenticación, mapeo de monto, traducción de estados, verificación de firma y consulta. En B costó **+18 / −1** en `src/payments` y **+51** en pruebas. Las 18 líneas de B son configuración de credenciales y registro; el mapeo, la firma y la consulta viven en el SDK. La parte de la hipótesis que dice que B no escribe ese mapeo **se cumple**.

**Kushki.** En D costó **+338** en `src/payments` y **+296** en pruebas. En B costó **+20 / −5** en `src/payments` y **+65** en pruebas, más el cambio de versión del SDK en `package.json` y `package-lock.json`, que también hizo D. Ese cambio de versión es un costo real **fuera** de `src/payments` y el informe no lo esconde: la hipótesis hablaba del módulo de pagos y del esqueleto, y el `package.json` no es ninguna de las dos cosas, pero es parte del costo de agregar la pasarela. Dentro de `src/payments`, 18 de las 20 líneas son configuración en `gateways.ts`; las otras 2 cambian el webhook de `index.ts` para guardar el estado nativo.

**Rapyd.** En D costó **+319** en `src/payments` y **+287** en pruebas. En B costó **+29 / −8** en `src/payments` y **+121** en pruebas. Rapyd cobra la tarjeta en su página alojada y firma cada petición con HMAC; nada de eso lo reescribe B en su módulo, lo absorbe el SDK. La parte de la hipótesis sobre el mapeo y la firma **se cumple**. Pero 7 de sus 29 líneas cambian `index.ts`: la llave pública no se entrega cuando la tarjeta se cobra en la página de Rapyd, y el webhook pasa la referencia de la orden.

### 3.3. Veredicto sobre la hipótesis

**La hipótesis se confirma casi entera en el eje que mide el experimento.** De las 67 líneas que B agrega en `src/payments` para las tres pasarelas, 58 son configuración en `gateways.ts`. Ningún commit de pasarela de B toca el esqueleto ni el modelo de datos, ni escribe mapeo de monto, traducción de estados, verificación de firma o flujo de consulta. Las otras 9 líneas no son configuración: Kushki y Rapyd obligaron a ajustar el módulo común (`index.ts`), como detalla la §3.1. El diff de las tres pasarelas es **+67 / −14** frente a **+1 042 / −5** de D.

**Pero «configuración» no significa «gratis».** Cada pasarela de B trae además su propia suite: **51**, **65** y **121** líneas en `test/payments`. Esas pruebas no contradicen la hipótesis —la hipótesis hablaba de lo que hay que escribir para integrar, no de lo que hay que probar—, pero sí acotan la lectura: B no paga el mapeo ni la firma, y sí paga la verificación de que su configuración funciona. Además, el costo de construir y mantener el SDK queda fuera del perímetro de esta medición (§5.9). Presentar el **-93.57 %** como si fuera el costo total del sistema sería una reinterpretación que este informe no hace.

---

## 4. Métricas CK por archivo y por clase

### 4.1. La adaptación que hace comparables los dos módulos

El módulo de pagos de B no tiene clases: son funciones de módulo en `src/payments/index.ts` y configuración en `src/payments/gateways.ts`. En D, cada pasarela tiene una clase y entre 6 y 12 funciones de módulo auxiliares. Medir solo clases habría reportado cero en B y habría dejado fuera parte de la lógica de D, así que el #134 adoptó la unidad de archivo (`--unit file`) siguiendo `methodology.md` §6.1.1. **La cifra normativa de la variable 3 es la de archivo.** El corte por clase de la §4.2 es complementario y se generó aparte con `--unit all`.

### 4.2. Métricas CK por archivo (cifra normativa del #134)

**Prototipo D — `prototypes/checkout-sin-solucion/src/payments`**

| Archivo | WMC | CBO | RFC | MAX_CC | Peor función | Violaciones |
|---|---:|---:|---:|---:|---|---|
| `gateway.ts` | 19 | 2 | 15 | 7 | `fetchWithRetry()` | Ninguna |
| `index.ts` | 14 | 3 | 23 | 6 | `createPayments()` | RFC 23 > 20 |
| `kushki.ts` | 89 | 7 | 43 | 13 | `chargeCard()` | WMC, CBO, RFC y MAX_CC |
| `mercadopago.ts` | 82 | 7 | 48 | 19 | `verifyWebhook()` | WMC, CBO, RFC y MAX_CC |
| `rapyd.ts` | 77 | 8 | 48 | 13 | `verifyWebhook()` | WMC, CBO, RFC y MAX_CC |
| `wompi.ts` | 94 | 7 | 40 | 19 | `constructor()` | WMC, CBO, RFC y MAX_CC |

Totales del #134 para D: **WMC 375**, **CBO promedio 5.67** (máximo 8), **RFC 217**, **5 de 6 archivos** con al menos una violación.

**Prototipo B — `prototypes/checkout-con-sdk-front-back/src/payments`**

| Archivo | WMC | CBO | RFC | MAX_CC | Peor función | Violaciones |
|---|---:|---:|---:|---:|---|---|
| `gateways.ts` | 19 | 0 | 6 | 5 | `credentials()` | Ninguna |
| `index.ts` | 47 | 14 | 38 | 10 | `createPayments()` | WMC, CBO y RFC |

Totales del #134 para B: **WMC 66**, **CBO promedio 7.0** (máximo 14), **RFC 44**, **1 de 2 archivos** con al menos una violación.

Los umbrales aplicados son los del DoD: **WMC ≤ 20, CBO ≤ 5, RFC ≤ 20, MAX_CC ≤ 10**. En B, los dos archivos cumplen el umbral de MAX_CC (5 en `gateways.ts` y 10 en `index.ts`); en D, la lógica de las cuatro pasarelas tiene MAX_CC 13 o 19, y solo los archivos de soporte `gateway.ts` (7) e `index.ts` (6) quedan por debajo. Las métricas se corren en modo medición, donde una violación se reporta y no cambia el código de salida, porque en este experimento el valor alto es el dato.

### 4.3. Métricas CK por clase (medición complementaria)

El plan pide «las métricas CK de las clases de pago de cada uno» (§6). Para cumplirlo sin alterar la cifra normativa, se generaron dos reportes complementarios con `--unit all`:

- [`ck-class-checkout-sin-solucion.json`](ck-class-checkout-sin-solucion.json)
- [`ck-class-checkout-con-sdk-front-back.json`](ck-class-checkout-con-sdk-front-back.json)

**Prototipo D — clases de pago**

| Archivo | Clase | WMC | CBO | RFC | MAX_CC | Peor método | Violaciones |
|---|---|---:|---:|---:|---:|---|---|
| `kushki.ts` | `KushkiPayments` | 65 | 5 | 23 | 13 | `chargeCard` | WMC, RFC y MAX_CC |
| `mercadopago.ts` | `MercadoPagoPayments` | 57 | 5 | 28 | 19 | `verifyWebhook` | WMC, RFC y MAX_CC |
| `rapyd.ts` | `RapydPayments` | 46 | 5 | 24 | 13 | `verifyWebhook` | WMC, RFC y MAX_CC |
| `wompi.ts` | `WompiPaymentsAdapter` | 81 | 5 | 27 | 19 | `constructor` | WMC, RFC y MAX_CC |

Las cuatro clases de D superan al menos un umbral: **4 de 4**. Ninguna viola CBO a nivel de clase (las cuatro tienen CBO 5), aunque el archivo que las contiene sí lo supera cuando se suman los tipos de sus funciones de módulo.

**Prototipo B — clases de pago**

| Archivo | Clase | WMC | CBO | RFC | MAX_CC | Violaciones |
|---|---|---:|---:|---:|---:|---|
| — | — | — | — | — | — | El reporte tiene `totalClasses: 0` |

B no tiene clases en `src/payments/`; su unidad de diseño es el archivo y las funciones de módulo. Por eso el corte por clase **no tiene contraparte en B** y no se usa para comparar: la comparación válida es la de archivo de la §4.2. El reporte por clase se conserva porque el plan lo pide y porque documenta el patrón que el #134 describió: la integración directa de D concentra la lógica en clases grandes, y el módulo de B no necesita esa estructura.

**Por qué el WMC por clase de D no suma el WMC por archivo.** El WMC por archivo suma todas las funciones y métodos del archivo; el WMC por clase cuenta solo los métodos de la clase. Las funciones de módulo auxiliares que el #134 menciona —entre 6 y 12 por pasarela— quedan fuera del corte por clase. Por eso el WMC de `wompi.ts` es 94 por archivo y 81 en su clase, y el de `kushki.ts` es 89 por archivo y 65 en su clase. No es una contradicción: son dos unidades de análisis distintas, y la normativa es la de archivo.

### 4.4. Reproducción

Desde `sdk/`:

```bash
# Cifra normativa por archivo (la del #134)
npm run metrics -- --root ../prototypes/checkout-sin-solucion/src/payments --tsconfig ../prototypes/checkout-sin-solucion/tsconfig.json --unit file --json ../docs/evaluation/ck-checkout-sin-solucion.json
npm run metrics -- --root ../prototypes/checkout-con-sdk-front-back/src/payments --tsconfig ../prototypes/checkout-con-sdk-front-back/tsconfig.json --unit file --json ../docs/evaluation/ck-checkout-con-sdk-front-back.json

# Corte complementario por clase y por archivo
npm run metrics -- --root ../prototypes/checkout-sin-solucion/src/payments --tsconfig ../prototypes/checkout-sin-solucion/tsconfig.json --unit all --json ../docs/evaluation/ck-class-checkout-sin-solucion.json
npm run metrics -- --root ../prototypes/checkout-con-sdk-front-back/src/payments --tsconfig ../prototypes/checkout-con-sdk-front-back/tsconfig.json --unit all --json ../docs/evaluation/ck-class-checkout-con-sdk-front-back.json
```

---

## 5. Amenazas a la validez, una por una

### 5.1. Somos autores e intérpretes

El mismo equipo que construyó el framework mide si el framework sirve. El sesgo es inevitable y no se neutraliza con una nota. La defensa es que cinco de las seis variables son contables por script o por `git show` y auditables por un tercero: `cloc`, `ck-metrics.ts`, `native-concepts.ts`, los diffs de commit y Jest con cobertura. La sexta —pasarelas alcanzables— se apoya en identificadores emitidos por los sandboxes, que están en la tabla de la §4 de [la recolección](recoleccion-seis-variables.md). El informe no pide que se confíe en la interpretación del equipo: pide que se recalculen las cifras.

### 5.2. El prototipo D puede estar peor hecho de lo que lo haría un experto

Es la amenaza más difícil de descartar. Sin querer, es fácil escribir la integración directa de forma más torpe de lo que la escribiría alguien que conoce la pasarela. La defensa es que D sigue la documentación oficial y sus ejemplos, y que el DoD exige que lo revise alguien que no lo escribió. El informe no afirma que D sea el mejor D posible: afirma que es un D construido con la documentación oficial y con las mismas seis funciones que B. Si D estuviera subóptimo, la diferencia a favor de B estaría inflada, y eso se declara.

### 5.3. Un solo autor escribió las pasarelas nuevas en B y en D

Orduz escribió Mercado Pago, Kushki y Rapyd en los dos prototipos y es autor de buena parte de los adaptadores del SDK (punto 117). La mitigación de asignación del plan —que D lo construya alguien distinto de quien construye B— **no se cumplió**. Hay dos riesgos, y los dos van en direcciones distintas:

- **D puede heredar lo que el SDK ya resolvió** y quedar más simple de lo que lo escribiría alguien que lee la documentación de cero. Eso **achica** la diferencia a favor de la tesis.
- **El orden de construcción favorece al segundo prototipo** en el tiempo. Por eso el tiempo de implementación no es evidencia principal (§5.8).

La defensa es la misma de la §5.2: seguir y citar la documentación oficial, y que David y Andrés revisen sus módulos. El sesgo no se elimina; se declara.

### 5.4. Los módulos de pagos tienen cambios que no hizo su autor

En los dos módulos hay cambios ajenos a quien los escribió (puntos 111, 116 y 117):

- **Para cobrar en el ambiente del esqueleto:** 23 líneas agregadas y 2 quitadas en el módulo de David (D), y 29 agregadas y 9 quitadas en el de Andrés (B), más sus pruebas.
- **Para el contrato de varias pasarelas:** el commit base y las tres pasarelas nuevas, que escribe Orduz en B y en D.

Esos cambios se declaran al medir y cada autor revisa los suyos. No se restan de las cifras: forman parte del código que la medición encuentra. La amenaza es que parte de las líneas contadas no sean atribuibles a la decisión de usar o no el SDK, y por eso se nombran.

### 5.5. Las vitrinas no son idénticas

D vende cómics («La Candelaria Cómics») y B vinos («La Bodega de Chapinero»), con catálogo, marca y estilos distintos (puntos 110 y 116). Tienen la misma estructura, las mismas rutas y el mismo flujo, pero no el mismo contenido. Las variables 1 y 2 no las tocan, porque se cuentan sobre `src/payments/` y `test/payments/`; la variable 6 también se limita a `src/payments/**`. La diferencia de vitrina sí limitaría una prueba de usabilidad o una comparación de experiencia de compra, y este informe no hace ninguna de las dos. Que el comprador no vea la misma tienda queda declarado como límite de alcance, no como variable medida.

### 5.6. Nada se cobró en producción

Desde el punto 111, B y D cobran por omisión en el sandbox oficial de cada pasarela, y las pruebas automáticas corren contra la API de Simulación. La evidencia de la variable 5 se tomó el 22 de octubre de 2026 en los sandboxes de Wompi, Mercado Pago, Rapyd y Kushki (tarjeta), y en el simulador local para el PSE de Kushki, porque el UAT de Kushki no transiciona transferencias a estado final (punto 121). Hay dos límites adicionales que conviene dejar escritos: los webhooks reales de Kushki no se midieron —su consola UAT no dejaba entrar— y las notificaciones reales de Mercado Pago en modo de prueba no verificaban hasta que se identificó que las firma la aplicación del vendedor de prueba (punto 121). Ningún cobro fue en producción. Es una limitación honesta del alcance y no se presenta como si los sandboxes fueran producción.

### 5.7. Dos prototipos no son una muestra

No hay significancia estadística ni pretensión de tenerla. Es un estudio de caso comparativo, que es lo que el Design Science Research admite para evaluar un artefacto. Las cifras describen estos dos prototipos, con estas cuatro pasarelas y este equipo; no se generalizan a cualquier framework ni a cualquier comercio. La conclusión se formula en ese alcance.

### 5.8. El tiempo de implementación queda fuera como evidencia principal

Es la métrica más intuitiva y la más contaminada: quien implementa el segundo prototipo ya aprendió el dominio en el primero, así que siempre va a ser más rápido, independientemente del framework. Ese efecto de orden no se puede eliminar con cuatro personas y dos prototipos. Se puede registrar como dato secundario declarando el sesgo; presentarlo como evidencia principal sería metodológicamente indefendible. En este informe no se usa para sostener la conclusión.

### 5.9. El costo del SDK queda fuera del perímetro

Las variables 1 y 2 cuentan lo que escribe el comercio en su módulo de pagos. El código del SDK —adaptadores, normalizadores, manejadores de webhook y sus pruebas— no entra en esas cifras, y el esfuerzo de construirlo tampoco. La comparación, por tanto, mide **lo que le cuesta al comercio integrar y mantener sus pasarelas**, no el costo total del sistema. Es la lectura correcta para el problema de la tesis —el *vendor lock-in* del comercio—, pero no autoriza a decir que el framework sea más barato de construir que la integración directa. Esa frase no está en la conclusión.

---

## 6. Conclusión, tal como salió

**La hipótesis se confirma casi entera en el eje medido, con dos matices que hay que decir en la misma frase.** Todas las cifras de esta conclusión son las de la §2; su fila del #134 y su artefacto local están en la §7.1.

En el módulo de pagos del comercio, el prototipo B escribe **310 LOC** frente a **1 308** de D (**-76.30 %**), agrega **+67 / −14** líneas para sumar las tres pasarelas nuevas frente a **+1 042 / −5** de D (**-93.57 %**), tiene un WMC total de **66** frente a **375** (**-82.40 %**), un RFC promedio de **22.00** frente a **36.17** (**-39.17 %**) y un MAX_CC de **10** frente a **19** (**-47.37 %**, dentro del umbral del DoD). No expone **ningún** concepto nativo de pasarela (**0** identificadores y **0** ocurrencias frente a **10** y **18**), alcanza **4 de 4** pasarelas igual que D, y cubre **100 %** de sentencias y **97.59 %** de ramas con **165** pruebas, frente a **90.03 %** y **81.08 %** con **239** pruebas (**+9.97** y **+16.51** puntos porcentuales).

Los dos matices:

1. **El CBO promedio de B es mayor:** **7.0** frente a **5.67** (**+23.53 %**). B concentra más tipos externos por archivo, sobre todo en `index.ts`, que declara 14 tipos importados en sus firmas. La abstracción reduce complejidad y tamaño, pero no reduce el acoplamiento por archivo; lo redistribuye. Presentar la variable 3 como una victoria completa sería ocultar ese dato.
2. **La reducción de esfuerzo es del código del comercio, no del sistema completo.** B no reescribe el mapeo, la firma ni la consulta de cada pasarela, pero sí escribe la configuración, ajusta en 9 líneas su módulo común para Kushki y Rapyd, sí escribe sus pruebas (**51**, **65** y **121** líneas en `test/payments` para las tres pasarelas) y depende de un SDK cuyo costo de construcción queda fuera de la medición (§5.9).

**En una frase:** para un comercio que integra cuatro pasarelas colombianas, usar el framework redujo drásticamente el código de integración, la complejidad, la exposición a conceptos nativos y el esfuerzo de agregar pasarelas, y aumentó la cobertura de pruebas con menos pruebas; no redujo el acoplamiento por archivo y no incluye en la cifra el costo de construir el framework. La conclusión es un resultado de estudio de caso, no una ley general (§5.7).

---

## 7. Trazabilidad y verificación

### 7.1. De cada cifra a su fila del #134

GitHub no expone un ancla por fila de una tabla Markdown. Por eso la columna **Fuente** de la §2 enlaza al comentario del #134 que contiene la tabla, y esta tabla identifica la fila y el artefacto local que la respalda. Ninguna cifra de comparación de este informe sale de otro sitio. Las dos cifras de la §5.4 —23 líneas agregadas y 2 quitadas en D, y 29 y 9 en B— no son resultados del experimento: son cambios declarados en los puntos 111 y 116 del `architecture-log.md` y se citan como tales, con su fuente.

| Cifra | Fila del #134 | Artefacto local | Comando / commit / fecha |
|---|---|---|---|
| 1 308 y 310 LOC; -76.30 % | Variable 1 | — | `npx cloc@2.10.0 prototypes/<carpeta>/src/payments`; `eabba18`; 28 oct. 2026 |
| +385/−2, +338/−2, +319/−1; +1 042/−5 | Variable 2 | — | `git show --numstat` de `f335296`, `ad917db`, `ccd54dd`; 22 oct. 2026 |
| +18/−1, +20/−5, +29/−8; +67/−14; 93.57 % | Variable 2 | — | `git show --numstat` de `7b00381`, `2466495`, `daad2aa`; 22 oct. 2026 |
| WMC 375/66, RFC 217/44, CBO 5.67/7.0, MAX_CC 19/10, violaciones 5/6 y 1/2 | Variable 3 | [`ck-checkout-sin-solucion.json`](ck-checkout-sin-solucion.json), [`ck-checkout-con-sdk-front-back.json`](ck-checkout-con-sdk-front-back.json) | `npm run metrics -- … --unit file`; `eabba18`; 28 oct. 2026 |
| 10 identificadores / 18 ocurrencias; 0 / 0 | Variable 4 | [`native-concepts-report.json`](native-concepts-report.json) | `npm run metrics:concepts -- … [--assert-zero]`; `eabba18`; 28 oct. 2026 |
| 4 de 4; 14 transacciones con identificador; PSE Kushki sin identificador | Variable 5 | §4 de [`recoleccion-seis-variables.md`](recoleccion-seis-variables.md) | Sandboxes y simulador; `daad2aa`; 22 oct. 2026 |
| 90.03 / 81.08 / 83.18 / 96.19; 100 / 97.59 / 100 / 100; 239/10 y 165/6 | Variable 6 | — | `npm test -- --coverage --collectCoverageFrom="src/payments/**"`; `eabba18`; 28 oct. 2026 |
| WMC/CBO/RFC/MAX_CC por clase: 65/5/23/13, 57/5/28/19, 46/5/24/13, 81/5/27/19 | Variable 3, corte por clase | [`ck-class-checkout-sin-solucion.json`](ck-class-checkout-sin-solucion.json) | `npm run metrics -- … --unit all`; `eabba18`; 8 nov. 2026 |
| B sin clases (`totalClasses: 0`) | Variable 3, corte por clase | [`ck-class-checkout-con-sdk-front-back.json`](ck-class-checkout-con-sdk-front-back.json) | `npm run metrics -- … --unit all`; `eabba18`; 8 nov. 2026 |

### 7.2. Cómo se reproduce el informe

```bash
# Variables 1 y 4
npx cloc@2.10.0 prototypes/checkout-sin-solucion/src/payments
npx cloc@2.10.0 prototypes/checkout-con-sdk-front-back/src/payments
cd sdk
npm run metrics:concepts -- --target ../prototypes/checkout-sin-solucion/src/payments
npm run metrics:concepts -- --target ../prototypes/checkout-con-sdk-front-back/src/payments --assert-zero

# Variable 3, cifra normativa por archivo
npm run metrics -- --root ../prototypes/checkout-sin-solucion/src/payments --tsconfig ../prototypes/checkout-sin-solucion/tsconfig.json --unit file --json ../docs/evaluation/ck-checkout-sin-solucion.json
npm run metrics -- --root ../prototypes/checkout-con-sdk-front-back/src/payments --tsconfig ../prototypes/checkout-con-sdk-front-back/tsconfig.json --unit file --json ../docs/evaluation/ck-checkout-con-sdk-front-back.json

# Variable 2
cd ..
git show --numstat --format= f335296 ad917db ccd54dd -- prototypes/checkout-directo/src/payments
git show --numstat --format= 7b00381 2466495 daad2aa -- prototypes/checkout-con-sdk-front-back/src/payments

# Variable 6
cd prototypes/checkout-sin-solucion
npm test -- --coverage --collectCoverageFrom="src/payments/**"
cd ../checkout-con-sdk-front-back
npm test -- --coverage --collectCoverageFrom="src/payments/**"
```

La variable 5 no se reproduce con un comando: se consulta la tabla de transacciones de la §4 de [la recolección](recoleccion-seis-variables.md), que cita el sandbox o el simulador de cada una.

### 7.3. Comprobación de que el código no cambió desde la medición

El informe no vuelve a medir. Para verificarlo, desde la raíz:

```bash
git diff --stat eabba18 HEAD -- \
  prototypes/checkout-sin-solucion/src/payments \
  prototypes/checkout-con-sdk-front-back/src/payments \
  prototypes/checkout-sin-solucion/test/payments \
  prototypes/checkout-con-sdk-front-back/test/payments
```

El comando no produce salida a la fecha de este informe. Los únicos archivos nuevos son los dos reportes `ck-class-*.json` de esta entrega. Por eso las cifras del #134 se transcriben y no se recalculan.

---

## 8. Artefactos de la Fase 5

| Artefacto | Qué contiene |
|---|---|
| [`recoleccion-seis-variables.md`](recoleccion-seis-variables.md) | La recolección original de las seis variables, con la tabla de transacciones de la variable 5 y la trazabilidad de commits |
| [`ck-checkout-sin-solucion.json`](ck-checkout-sin-solucion.json) | CK por archivo de D, cifra normativa del #134 |
| [`ck-checkout-con-sdk-front-back.json`](ck-checkout-con-sdk-front-back.json) | CK por archivo de B, cifra normativa del #134 |
| [`ck-class-checkout-sin-solucion.json`](ck-class-checkout-sin-solucion.json) | CK por clase de D, corte complementario de esta entrega |
| [`ck-class-checkout-con-sdk-front-back.json`](ck-class-checkout-con-sdk-front-back.json) | CK por clase de B, corte complementario: no hay clases |
| [`native-concepts-report.json`](native-concepts-report.json) | Evidencia de la variable 4 |
| Este informe | El entregable de la §6 del [plan de evaluación](../project-management/prototypes-evaluation-plan.md) |
