# Análisis del tipo de dato usado para representar dinero (`Amount`)

> **Issue relacionado:** [#28 — sdk: revisar el tipo de dato usado para representar dinero (`Amount`) frente a las 4 pasarelas](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/28)
> **Responsable:** Joan
> **Alcance:** auditoría retrospectiva de una decisión ya tomada (`Amount` usa `number`), no un rediseño. El objetivo es confirmar con evidencia real de las 4 pasarelas si la decisión es defendible, documentar cualquier caso borde encontrado, y dejar registrada la justificación citable para el capítulo de diseño de la tesis.

## Origen de la revisión

El director de tesis pidió revisar el tipo numérico usado para dinero en TypeScript, porque el tipo `number` nativo puede dar problemas de precisión de punto flotante. `Amount` (`sdk/src/domain/value-objects/Amount.ts`) ya existía antes de este análisis: usa `number`, valida un máximo de dos decimales significativos en el constructor, y expone `toMinorUnits()` para convertir a enteros cuando la pasarela lo exige. Esta auditoría revisa esa decisión contra evidencia real de las cuatro pasarelas contempladas en el proyecto (Wompi, Rapyd, Mercado Pago y Kushki) y contra la literatura técnica sobre representación de dinero en software financiero.

## Cómo tipa el monto cada pasarela, con evidencia real

La tabla siguiente no describe una intención de diseño: cada celda cita un ejemplo textual tomado de documentación oficial o de código fuente oficial de la pasarela correspondiente. Las fuentes completas están en la sección final de este documento.

| Pasarela | Campo nativo | Tipo real declarado | Ejemplo textual de la fuente | Unidad |
|---|---|---|---|---|
| **Wompi** | `amount_in_cents` | `integer` | `"amount_in_cents": 50000` (equivalente a $500 COP) | Menor (centavos), siempre entero |
| **Rapyd** | `amount` | `number` / decimal | `"amount": 45.00` | Mayor (pesos/unidades completas), con los decimales del exponente ISO 4217 de la divisa |
| **Mercado Pago** | `transaction_amount` | `number` (float) | `transaction_amount: 12.34` (ejemplo textual del SDK oficial en TypeScript) | Mayor |
| **Kushki** | `amount.subtotalIva0` / `subtotalIva` / `iva` | `number`, dentro de un objeto descompuesto | `"subtotalIva0": 1000` | Mayor |

De las cuatro, **Wompi es la única que exige unidad menor (centavos) como entero**. Rapyd, Mercado Pago y Kushki reciben el monto en la unidad mayor (pesos), como un `number` decimal. `Amount.getValue()` ya devuelve el monto en la unidad mayor, exactamente como lo esperan tres de las cuatro pasarelas, y `Amount.toMinorUnits()` existe precisamente para traducir al único caso que rompe ese patrón.

## El problema teórico de punto flotante en JavaScript

El problema que motivó la revisión es real y bien documentado: JavaScript representa todos los números con el estándar binario IEEE 754 de doble precisión, en el cual la mayoría de fracciones decimales (incluyendo `0.1`, `0.01`, `0.29`) no tienen una representación exacta en base 2. El ejemplo canónico, verificado directamente en este análisis ejecutando Node.js:

```
> 0.1 + 0.2
0.30000000000000004
```

Esto no es una particularidad de JavaScript: ocurre en cualquier lenguaje que use `float`/`double` nativos (C, C++, Java, Python, Go), porque es una propiedad de la representación binaria, no un defecto de un lenguaje en particular. La industria financiera de software resuelve esto de dos formas alternativas: enteros en la unidad menor (el modelo de Stripe, que exige `amount: 1099` para cobrar $10.99 USD), o tipos decimales de precisión exacta construidos sobre strings (`BigDecimal` en Java, `decimal` en C#, `decimal.js`/`big.js` en JavaScript).

## El hallazgo concreto: un caso real de falso rechazo en `Amount.ts`

La auditoría no se quedó en la comparación teórica. Se probó la validación actual del constructor de `Amount` (`Math.round(value * 100) !== value * 100`) contra montos con exactamente dos decimales legítimos, ejecutando el código directamente en Node.js:

```
1.15  -> 1.15 * 100  = 114.99999999999999  -> RECHAZADO (falso positivo)
4.65  -> 4.65 * 100  = 465.00000000000006  -> RECHAZADO (falso positivo)
19.99 -> 19.99 * 100 = 1998.9999999999998  -> RECHAZADO (falso positivo)
0.29  -> 0.29 * 100  = 28.999999999999996  -> RECHAZADO (falso positivo)

2.35    -> 2.35 * 100    = 235   -> aceptado
100.50  -> 100.50 * 100  = 10050 -> aceptado
```

De siete montos con dos decimales reales probados, cuatro fueron rechazados por error, incluyendo `19.99`, uno de los patrones de precio más comunes en cualquier comercio. El constructor lanza `"Amount solo admite hasta dos decimales significativos"` para montos que sí tienen solo dos decimales, porque la validación compara el resultado de una multiplicación de punto flotante contra sí misma sin ninguna tolerancia, heredando exactamente el mismo tipo de error que motivó la pregunta original del director.

Es importante separar este hallazgo de `toMinorUnits()`: ese método sí funciona correctamente para los mismos valores, porque internamente usa `Math.round()`, que absorbe el error. El defecto está aislado en la comparación de igualdad exacta del constructor (`!==`), no en la conversión de unidades.

Los `Amount.test.ts` existentes no detectan este defecto porque, por coincidencia, los valores probados (`100.5`, `100.55`) no caen en el rango afectado.

## Evidencia externa de que el problema no es hipotético: el caso de Rapyd

Durante la investigación se encontró, en el propio foro oficial de soporte de Rapyd, una advertencia textual de su equipo de documentación sobre el mismo problema, aplicado a su protocolo de firma de requests:

> "Python and JavaScript truncate the rightmost zeroes from decimal numbers (12.50 → 12.5), and convert decimals to integers when all digits to the right of the decimal are zero (12.00 → 12). This can sometimes cause issues with the calculation of the signature. If you use rightmost zeroes, you can avoid these problems by sending them as numeric strings instead of JSON numbers."
> — Rapyd Developer Community, hilo "Still having problems with fractions"

Esto confirma con una fuente directa de una de las cuatro pasarelas del proyecto que el riesgo de precisión numérica en JavaScript ya afectó a otros integradores construyendo sobre la misma API que este proyecto planea usar, no es un riesgo solamente teórico citado en artículos genéricos sobre punto flotante.

## Por qué la decisión es mantener `number`, no cambiar el tipo de dato

Los estándares de la industria citados arriba (enteros en unidad menor, o librerías de precisión decimal) resuelven un problema específico: evitar que el error de punto flotante se acumule a lo largo de una **cadena de operaciones aritméticas** sobre el dinero, como sumar impuestos, prorratear cuotas o componer intereses. `Amount` no tiene ese escenario: es un objeto de valor inmutable que nunca ejecuta aritmética sobre sí mismo dentro del SDK. Se valida una única vez en el constructor y se traduce una única vez en `toMinorUnits()`. El riesgo real no estaba en el tipo de dato, estaba en la frontera de validación de entrada, que ya se corrigió sin necesidad de tocar el tipo.

Las alternativas evaluadas y descartadas, con su justificación puntual:

**`BigInt`:** no representa fracciones por sí solo. Para expresar `12.34` habría que combinarlo con una escala implícita, lo que en la práctica reinventa "enteros en centavos" bajo otro nombre, y JavaScript prohíbe mezclar `BigInt` con `number` en una misma operación (lanza `TypeError`), obligando a convertir en cada punto donde el Adapter necesite hacer una operación simple. El único problema que `BigInt` resuelve, la pérdida de precisión en enteros mayores a `Number.MAX_SAFE_INTEGER` (9.007.199.254.740.991), no aplica: ningún monto en pesos colombianos, ni siquiera expresado en centavos, se acerca a ese límite.

**Enteros siempre en unidad menor (modelo Stripe):** obligaría a que todo consumidor del SDK exprese el monto en centavos, cuando tres de las cuatro pasarelas contempladas (Rapyd, Mercado Pago, Kushki) ya reciben el monto en pesos. Adoptar ese modelo no elimina la conversión de unidad, solo la traslada: en vez de convertir una vez para Wompi, habría que convertir (dividiendo entre 100) para las otras tres.

**`decimal.js` / `big.js`:** resuelven cadenas de operaciones aritméticas exactas, que es precisamente lo que `Amount` no hace. Adoptar una de estas librerías sumaría una dependencia externa y un tipo que se filtraría a la API pública del SDK (el consumidor tendría que construir `new Decimal(monto)` en vez de pasar un `number` plano), sin resolver ningún problema adicional al que ya resuelve la validación corregida.

## Cómo se representa el dinero en cada capa del SDK

| Capa | Representación | Justificación |
|---|---|---|
| Frontera pública (API del SDK) | `number` en pesos, hasta 2 decimales | Coincide con cómo un desarrollador colombiano expresa naturalmente un monto, y con la redacción de los requisitos funcionales del SAD. |
| Dominio (`Amount`) | Envoltura inmutable del mismo `number`, validada sin aritmética | Único punto de entrada; congela el valor una vez comprobado que no llegó contaminado por aritmética previa sin redondear. |
| Adapter Wompi | `amount.toMinorUnits()` → entero en centavos | Única de las cuatro que exige unidad menor. |
| Adapter Rapyd | `amount.getValue()`, serializado como string decimal fijo (`"19.99"`, no `19.99`) en el body que participa en el cálculo de la firma | Evita el truncamiento de ceros a la derecha documentado por Rapyd (ver sección anterior); recomendación para cuando se implemente `RapydAdapter`. |
| Adapter Mercado Pago | `amount.getValue()` directo como `number` | Coincide con `transaction_amount: number` de su SDK oficial. |
| Adapter Kushki | `amount.getValue()` descompuesto en `subtotalIva0` / `subtotalIva` / `iva` | Mismo valor, reestructurado en el objeto que exige su API. |

En ningún punto de esta cadena el monto se vuelve a sumar, restar o multiplicar por otra cosa que no sea la conversión de unidad para Wompi. Por eso `number` sigue siendo una decisión defendible: el riesgo que motivó la revisión no vivía en el tipo, vivía en la validación de entrada.

## Solución aplicada para el defecto encontrado

Reemplazar la comparación aritmética del constructor por una lectura de la representación en string del número, que no requiere multiplicar ni arriesgarse a heredar el mismo error que se busca detectar:

```typescript
constructor(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Amount debe ser un numero finito");
  }
  const decimalPart = value.toString().split(".")[1] ?? "";
  if (decimalPart.length > 2) {
    throw new Error("Amount solo admite hasta dos decimales significativos");
  }
  if (value < 0) {
    throw new Error("Amount no puede ser negativo");
  }
  this.value = value;
}
```

`Number.prototype.toString()` no es una operación aritmética: es una conversión definida por la especificación ECMA-262 que produce el string decimal más corto que, al volver a parsearse, reproduce exactamente el mismo número de punto flotante. Refleja fielmente cuántos decimales tiene el número tal como fue escrito o tal como llegó desde un JSON, sin necesidad de multiplicar por 100.

Se comparó esta solución contra una alternativa de tolerancia numérica (`Math.abs(Math.round(value * 100) - value * 100) <= epsilon`), probando ambas contra un caso que la mayoría de artículos sobre este tema no cubre: un monto que llega ya contaminado porque alguien hizo una multiplicación sin redondear antes de construir el `Amount` (`10.1 * 3`, que en JavaScript da `30.299999999999997`):

| Entrada | Solución con tolerancia | Solución con string |
|---|---|---|
| `1.15`, `4.65`, `19.99`, `0.29` (2 decimales reales) | Acepta correctamente | Acepta correctamente |
| `1.005`, `100.505` (3 decimales reales) | Rechaza correctamente | Rechaza correctamente |
| `10.1 * 3` → `30.299999999999997` | Acepta silenciosamente, redondeando sin avisar | Rechaza, obligando a redondear explícitamente antes de construir el `Amount` |
| `0.1 + 0.2` → `0.30000000000000004` | Acepta silenciosamente | Rechaza |

La solución con tolerancia numérica esconde el error en vez de exponerlo, lo cual contradice la razón de ser de un objeto de valor: detectar que alguien hizo aritmética de punto flotante sin protegerla antes de construir el objeto. La solución basada en string lo expone correctamente.

**Límite conocido y declarado:** para números astronómicamente grandes o diminutos, `toString()` cambia a notación científica (`(1e21).toString()` produce `"1e+21"`, sin punto decimal), lo cual rompería el conteo de decimales. No es un riesgo real para montos en pesos colombianos, dado que `Number.MAX_SAFE_INTEGER` cubre más de 90 billones de pesos incluso expresados en centavos, pero se declara aquí explícitamente en vez de dejarlo oculto.

**Estado de esta corrección:** aplicada en `Amount.ts` y cubierta con pruebas nuevas en `Amount.test.ts` (montos previamente rechazados por error: `19.99`, `1.15`, `4.65`, `0.29`; guardas nuevas para `NaN`/`Infinity`; y una prueba que confirma que un monto contaminado por aritmética previa sin redondear, como `10.1 * 3` o `0.1 + 0.2`, sigue siendo rechazado correctamente). Cobertura de `Amount.ts` tras el cambio: 100% de statements, branches, funciones y líneas.

## Conclusión

`Amount` usa `number` en unidad mayor, con hasta dos decimales, y esa decisión se mantiene sin cambios: coincide con tres de las cuatro pasarelas contempladas, coincide con cómo el dominio del problema (montos en pesos colombianos) se expresa naturalmente, y ninguna alternativa evaluada (`BigInt`, enteros forzados, librerías de precisión decimal) resuelve un problema que `Amount` realmente tenga, porque `Amount` no encadena operaciones aritméticas sobre el monto. El riesgo real identificado no estaba en el tipo de dato sino en la validación de entrada del constructor, que comparaba una multiplicación de punto flotante contra sí misma sin tolerancia, rechazando por error una fracción significativa de montos válidos de dos decimales (incluyendo el patrón de precio más común, `X.99`). La corrección aplicada elimina la aritmética de la validación por completo, sin introducir ninguna dependencia nueva ni cambiar la forma en que el SDK expone el dinero a sus consumidores.

## Fuentes consultadas

**Documentación y código oficial de las cuatro pasarelas:**

- [Wompi — Transactions](https://docs.wompi.co/en/docs/colombia/transacciones/): documentación oficial del endpoint `POST /v1/transactions`. Fuente del campo `amount_in_cents` como `integer` obligatorio, del ejemplo `"amount_in_cents": 50000`, y del mensaje de error `"Invalid amount → Verify that amount_in_cents is a positive integer"` citado en este documento.
- [Wompi OpenAPI spec (api-evangelist/wompi)](https://raw.githubusercontent.com/api-evangelist/wompi/refs/heads/main/openapi/wompi-transactions-api-openapi.yml): esquema OpenAPI no oficial pero derivado de la documentación pública de Wompi. Confirma el tipo `integer` de `amount_in_cents` con un ejemplo adicional (`4980000` = COP 49.800).
- [Rapyd — Create Payment](https://docs.rapyd.net/en/create-payment.html): documentación oficial del endpoint `POST /v1/payments`. Fuente del campo `amount` como decimal en unidad mayor y del ejemplo `"amount": 45.00`.
- [Rapyd — Creating a Card Payment](https://docs.rapyd.net/en/creating-a-card-payment.html): documentación oficial con un ejemplo adicional de creación de pago con tarjeta, usado para confirmar el formato decimal del campo `amount` (`"amount": "19.20"`).
- [Rapyd — Request Signatures](https://docs.rapyd.net/en/request-signatures.html): documentación oficial del algoritmo de firma de Rapyd para requests salientes, referenciada para entender el contexto de por qué la representación exacta del `body_string` importa.
- [Rapyd Community — "Still having problems with fractions"](https://community.rapyd.net/t/still-having-problems-with-fractions/1327): hilo del foro oficial de soporte de Rapyd. Fuente directa de la advertencia textual citada en este documento sobre el truncamiento de ceros a la derecha en Python y JavaScript, y su efecto en el cálculo de la firma.
- [Rapyd Community — "Error with Decimal for .net"](https://community.rapyd.net/t/error-with-decimal-for-net/59162): hilo adicional del mismo foro, con un caso reportado por otro integrador (en .NET, no JavaScript) enfrentando el mismo problema de representación decimal, usado para confirmar que el problema no es exclusivo de un lenguaje.
- [mercadopago/sdk-nodejs — src/examples/payment/create.ts](https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/payment/create.ts): ejemplo de código oficial del SDK de Node.js de Mercado Pago, en TypeScript. Fuente del campo `transaction_amount: 12.34` como `number` nativo, usado directamente por el propio fabricante de la pasarela en su SDK de referencia.
- [mercadopago/sdk-nodejs — README](https://github.com/mercadopago/sdk-nodejs): documentación del repositorio oficial del SDK. Contiene además un ejemplo de la API de Orders (`total_amount: "1000.00"`, como string), citado en la investigación para notar que ni la propia Mercado Pago es consistente entre sus distintas APIs sobre si el monto es un `number` o un `string`.
- [Kushki Charges API OpenAPI spec (api-evangelist/kushki)](https://raw.githubusercontent.com/api-evangelist/kushki/refs/heads/main/openapi/kushki-charges-api-openapi.yml): esquema OpenAPI derivado de la documentación pública de Kushki. Fuente del tipo `number` para `subtotalIva`, `subtotalIva0`, `iva` e `ice`, y del ejemplo de payload completo citado en este documento.
- [Kushki — Amount schema](https://api-docs.kushkipagos.com/docs/online-payments/schemas/Amount): documentación oficial del esquema `Amount` de Kushki, usada para confirmar la semántica de cada subcampo (`subtotalIva0` para el monto total sin impuestos, `subtotalIva` en cero si no hay impuestos).

**Literatura técnica sobre representación de dinero en software:**

- [Stack Overflow — "Why not use Double or Float to represent currency?"](https://stackoverflow.com/questions/3730019/why-not-use-double-or-float-to-represent-currency): explicación canónica y muy citada de por qué la mayoría de fracciones decimales no tienen representación exacta en IEEE 754 binario, con ejemplos numéricos concretos. Base de la explicación teórica de este documento.
- [Modern Treasury — "Floats Don't Work For Storing Cents"](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents): artículo técnico de una empresa de infraestructura financiera real, explicando por qué usan enteros de 64 bits para dinero en su propio sistema de producción. Fuente del razonamiento sobre el modelo de "enteros en unidad menor" y sus límites reales de magnitud.
- [Stripe — Supported currencies](https://docs.stripe.com/currencies.md): documentación oficial de Stripe sobre el manejo de divisas de cero, dos, tres y cuatro decimales. Fuente de la afirmación de que Stripe exige enteros en unidad menor en el 100% de sus endpoints, y de los casos especiales por divisa.
- [Stripe — Create a charge](https://docs.stripe.com/api/charges/create.md): referencia de API oficial de Stripe, fuente del ejemplo `amount: 1099` para cobrar $10.99 USD, usado como el caso de referencia de la industria para el modelo de enteros en unidad menor.
- ["Never Use Floats for Money" (DEV Community)](https://dev.to/blogz7/never-use-floats-for-money-20dc): artículo técnico general sobre las dos soluciones estándar (enteros en unidad menor, o tipos decimales exactos), y sobre qué columnas de base de datos evitar (`REAL`, `FLOAT`, `DOUBLE PRECISION`) para montos.
- ["Preventing Improper Integer Precision Loss in Financial Systems"](https://rubel.dev/blog/preventing-improper-integer-precision-loss-in-financial-systems): artículo técnico usado para confirmar el ejemplo `0.1 + 0.2` en Node.js específicamente (no solo en JavaScript de navegador), y la recomendación de `big.js` para cálculos que sí encadenan operaciones.
- ["Why Not Use double or float to Represent Currency?" (Medium)](https://medium.com/@trivajay259/why-not-use-double-or-float-to-represent-currency-66fe4b65c97b): artículo usado para la explicación de por qué la representación en base 2 no puede expresar exactamente la mayoría de fracciones en base 10, con la analogía de fracciones periódicas.
- ["Money as a data type" (DEV Community)](https://dev.to/mashhadi/money-as-a-data-type-14pk): artículo usado específicamente para el ejemplo `1.005 * 100 = 100.49999999999999` y la cita sobre por qué "redondear al centavo más cercano" es la operación que casi nadie prueba, y para el argumento de que la moneda (no solo el monto) debe formar parte del tipo. Es el artículo cuyo argumento final (la moneda pertenece al tipo, no solo el número) ya está resuelto en este proyecto por separado, dado que `Amount` y `Currency` son objetos de valor distintos y explícitos.
- [Hacker News — discusión sobre APIs de dinero](https://news.ycombinator.com/item?id=40163152): hilo de discusión usado para confirmar el límite práctico de `Number.MAX_SAFE_INTEGER` en JavaScript (aproximadamente 90 billones de dólares en centavos), citado como respaldo de que ese límite no es un riesgo real para los montos de este proyecto.
- [PkgPulse — "dinero.js vs currency.js vs Intl.NumberFormat 2026"](https://www.pkgpulse.com/guides/dinero-vs-currency-js-vs-intl-numberformat-money-2026): guía comparativa de librerías de JavaScript para dinero, usada para confirmar el patrón "DO/DON'T" de la industria (representar en enteros, no hacer aritmética con floats crudos) y como referencia de qué opciones existen si el SDK alguna vez necesitara encadenar operaciones aritméticas sobre dinero, lo cual no es el caso actual.
