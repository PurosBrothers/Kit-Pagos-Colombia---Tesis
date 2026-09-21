# Conceptos técnicos que hay que manejar para integrar una pasarela

Esta es la lista de conceptos que aparecen en cualquier integración de pagos. Cada uno se explica con la razón por la que existe y, cuando aplica, con la fórmula exacta que usa alguna de las cuatro pasarelas del proyecto. No hay nada acá que sea opcional saber: cada concepto de esta lista ya provocó al menos un defecto medido en este repositorio.

---

## 1. El dinero no es un número

### El problema

JavaScript representa todos los números con el formato binario IEEE 754 de doble precisión. En base 2, la mayoría de las fracciones decimales no tienen representación exacta:

```text
> 0.1 + 0.2
0.30000000000000004
```

Esto no es un defecto de JavaScript: pasa en cualquier lenguaje que use `float` o `double` nativos. La industria financiera lo resuelve de dos maneras: enteros en la unidad menor de la divisa, o tipos decimales exactos construidos sobre texto.

Y el problema no es teórico. Validar "máximo dos decimales" con `Math.round(value * 100) !== value * 100` **rechaza montos legítimos**, medido ejecutando Node:

```text
1.15  -> 1.15 * 100  = 114.99999999999999  -> rechazado, y es válido
19.99 -> 19.99 * 100 = 1998.9999999999998  -> rechazado, y es válido
```

### Unidad mayor y unidad menor

Un monto se puede expresar en pesos (`150000.00`) o en centavos (`15000000`). La norma ISO 4217 le asigna a cada divisa un **exponente de unidad menor**: cuántos dígitos decimales tiene. Para el peso colombiano ese exponente es **2**, aunque el centavo colombiano no circule en la práctica. Wompi lo confirma exigiendo el campo `amount_in_cents`.

De las cuatro pasarelas, solo Wompi pide unidad menor. Las otras tres reciben pesos.

### Por qué el SDK guarda el monto como texto

Hay un caso que obliga: **Rapyd firma sus peticiones calculando un HMAC sobre el cuerpo serializado**. En ese cuerpo, `"19.90"` y `"19.9"` son cadenas distintas y producen firmas distintas, de las cuales solo una es válida. Con un `number` el cero final se pierde antes de llegar al adaptador, porque `(19.90).toString()` devuelve `"19.9"` y no hay forma de recuperarlo.

Por eso el objeto de valor `Amount` guarda una cadena decimal canónica y hace la aritmética con `big.js`. La conversión a unidad menor corre el punto decimal sobre el texto en lugar de multiplicar por cien, porque multiplicar reintroduce el error de punto flotante y dividir borra el cero final.

La historia completa de esta decisión, incluida la auditoría que primero concluyó que `number` estaba bien y después se revirtió, está en [money-representation-analysis.md](../architecture/money-representation-analysis.md) y en el punto 25 del [architecture-log](../architecture/architecture-log.md).

---

## 2. Tokenización y el alcance de PCI DSS

**PCI DSS** es la norma de seguridad de la industria de tarjetas. Lo que define su alcance es **por dónde pasan los datos de la tarjeta**, no con quién se integra: si el número, la fecha de expiración o el CVV llegan al servidor del comercio, ese servidor entra en alcance, aunque los reenvíe de inmediato a una pasarela certificada.

La tokenización es la forma de quedarse afuera:

1. El pagador escribe la tarjeta en un formulario que corre en su navegador, usando la librería de la pasarela y la **llave pública**.
2. La pasarela valida la tarjeta y devuelve un **token**: una cadena opaca, de un solo uso o de uso limitado, que representa esa tarjeta.
3. El frontend le manda ese token al servidor del comercio.
4. El servidor cobra con el token y la **llave privada**.

Consecuencias de diseño que esto tiene en el SDK:

- `PaymentMethod.card(token)` recibe un token, nunca un número de tarjeta. No es una limitación: es el punto.
- El token es **opaco y específico de la pasarela que lo emitió**. Un token de Wompi no sirve en Mercado Pago. La intercambiabilidad de pasarelas del SDK no incluye los tokens, y no puede incluirlos.
- Rapyd, para tarjeta, es el caso extremo: el único camino servidor a servidor que funciona exige el número de la tarjeta en la petición, así que el SDK usa su **checkout alojado** y devuelve una redirección. Es la decisión que mantiene al comercio fuera del alcance de PCI DSS, y está en el punto 50 del architecture-log.

---

## 3. Idempotencia

Una operación es **idempotente** si repetirla produce el mismo efecto que hacerla una vez. Consultar un estado es idempotente. **Crear un cobro no lo es**: repetirlo puede debitar dos veces.

Esto tiene dos consecuencias concretas:

**Del lado de la pasarela:** algunas exigen una **llave de idempotencia**, un identificador que el comercio genera y manda en un header, para que la pasarela reconozca un reintento y devuelva el resultado original en lugar de crear un segundo cobro. Mercado Pago lo exige de forma estricta: sin el header `X-Idempotency-Key` la API responde `400 "Header X-Idempotency-Key can't be null"`. Ese defecto vivió un tiempo en el SDK sin que nadie lo viera, porque el simulador no lo pedía; lo encontró medir contra la API real (punto 48).

**Del lado del SDK:** el reintento automático se aplica **solo** a las operaciones idempotentes. `getPaymentStatus()` y `getPseBanks()` se reintentan; `createPayment()` **nunca**. Un timeout no dice si la pasarela recibió la petición o no, así que reintentar un cobro ante timeout es exactamente el escenario del doble débito. La delimitación está escrita en el punto 35 del architecture-log y se puede verificar en tres líneas del código de la fachada.

---

## 4. Hash, HMAC y firma: no son lo mismo

Los tres sirven para responder "¿esto lo mandó quien dice que lo mandó?", pero con garantías distintas.

| Mecanismo | Necesita secreto compartido | Qué garantiza |
|---|---|---|
| **Hash** (SHA-256 a secas) | No, pero se logra metiendo un secreto dentro del texto que se hashea | Integridad. Si además el texto incluye un secreto que solo las dos partes conocen, también autenticidad |
| **HMAC** (HMAC-SHA256) | Sí, como llave del algoritmo | Integridad y autenticidad, con una construcción diseñada para esto |
| **Firma asimétrica** (RSA, ECDSA) | No: llave privada y pública | Integridad, autenticidad y no repudio |

Ninguna de las cuatro pasarelas del proyecto usa firma asimétrica. Usan hash o HMAC con secreto compartido, y cada una con una fórmula distinta. Estas son las cuatro, tal como están implementadas y verificadas:

**Wompi — SHA-256, sin llave.** El secreto viaja dentro del texto:

```text
checksum = SHA256_hex( concat(valores de signature.properties) + timestamp + secreto_de_eventos )
```

Las `properties` son rutas con puntos que el propio webhook declara (por ejemplo `transaction.amount_in_cents`), así que el verificador tiene que resolverlas dinámicamente en lugar de asumir un orden fijo.

**Mercado Pago — HMAC-SHA256 hexadecimal sobre un manifiesto con formato fijo:**

```text
header x-signature: "ts=<timestamp>,v1=<hash>"
manifiesto = "id:<data.id>;request-id:<x-request-id>;ts:<timestamp>;"
v1 = HMAC_SHA256_hex( secreto, manifiesto )
```

**Kushki — HMAC-SHA256 hexadecimal sobre el cuerpo más un identificador:**

```text
firma = HMAC_SHA256_hex( secreto, cuerpo_crudo + "." + header x-kushki-id )
```

**Rapyd — HMAC-SHA256 en base64, y es la más fácil de implementar mal:**

```text
texto = url_del_webhook + salt + timestamp + access_key + secreto + cuerpo_crudo
firma = base64( HMAC_SHA256_hex( secreto, texto ) )
```

Tres detalles de Rapyd que arruinan la verificación si se pasan por alto: el digest se serializa a hexadecimal y **ese texto hex** es lo que se codifica en base64 (pedirle `digest("base64")` directo produce otra firma); el secreto aparece **dos veces**, dentro del texto y como llave; y la URL que entra en el cálculo es la URL completa configurada en el panel de Rapyd, no la ruta de la petición entrante. Ese último detalle obligó a que el SDK reciba esa URL como un header sintético (`x-webhook-url`), porque no hay forma de derivarla de la petición (punto 16).

### El secreto del webhook no es la llave de la API

En Wompi, Mercado Pago y Kushki, el secreto que firma los webhooks es un valor **distinto** de la llave de la API, que se saca de otra parte del panel. Rapyd es la excepción: usa la misma. Por eso el SDK tiene un campo `webhookSecret` separado de `privateKey`, y si se omite cae a `privateKey` por compatibilidad. Ese fallback tiene un costo que conviene saber: con webhooks reales de esas tres pasarelas, la verificación va a fallar con un error de firma inválida que parece un ataque y es configuración.

En Wompi hay además un tercer secreto, el **de integridad**, que firma lo que el comercio manda:

```text
signature = SHA256_hex( reference + amount_in_cents + currency + secreto_de_integridad )
```

Sin él, la API real responde `422 "Firma de integridad requerida no enviada"` y no crea nada. Son tres secretos distintos en la misma pasarela: uno identifica, uno firma lo que sale y uno verifica lo que entra.

---

## 5. Comparación en tiempo constante

Cuando el código compara la firma recibida con la calculada, **no puede usar `===`**.

La razón es que `===` sobre cadenas corta en el primer byte distinto, así que tarda un poquito más cuando los primeros bytes coinciden. Un atacante que pueda medir esos tiempos puede reconstruir la firma byte por byte, probando un carácter a la vez, en lugar de tener que adivinarla completa. Es un ataque de canal lateral por temporización, y es práctico sobre una red rápida.

La comparación correcta recorre siempre todos los bytes y tarda lo mismo sin importar dónde esté la diferencia. En Node es `crypto.timingSafeEqual`, que exige que los dos buffers midan lo mismo, así que hay que comparar longitudes antes (y esa comparación sí puede ser directa: la longitud de una firma no es secreta).

En el SDK esto vive en un único módulo, `signature-utils.ts`, que es también el único lugar que importa `crypto`. Concentrarlo tiene una ventaja verificable: para auditar que todas las verificaciones son en tiempo constante hay que leer un archivo, no cuatro.

---

## 6. Webhooks: cuerpo crudo, reenvío y reloj

Un webhook es un POST que la pasarela le hace a una URL del comercio. Tres cosas hay que hacer bien.

**Verificar sobre el cuerpo crudo, exactamente como llegó.** La firma se calculó sobre esos bytes. Si el framework del comercio parsea el JSON y el código vuelve a serializarlo, el orden de las claves o un espacio pueden cambiar, y la firma deja de coincidir aunque sea legítima. Por eso `validateWebhook()` recibe un `string` y no un objeto: obliga a conservar el cuerpo original.

**Rechazar notificaciones viejas (protección anti-replay).** Una firma válida sigue siendo válida para siempre. Si alguien captura una notificación legítima —de un log, de un proxy, de un endpoint expuesto por error— puede reenviarla mil veces y todas van a verificar. La defensa es exigir que el timestamp de la notificación esté dentro de una ventana de tolerancia. El SDK usa **300 segundos** por defecto, configurable globalmente o por llamada, y admite `0` para desactivarla.

Dos detalles de implementación que salieron de medir: las pasarelas no coinciden en si el timestamp va en segundos o milisegundos, así que el SDK lo normaliza antes de comparar; y si el reloj del servidor del comercio está desfasado, la protección va a rechazar webhooks legítimos. Eso último se ve como un error de firma y es un problema de NTP.

**Responder rápido y ser idempotente.** Las pasarelas reintentan si no reciben un `200`, así que el mismo webhook puede llegar varias veces. El manejador del comercio tiene que tolerar duplicados.

### Notificación completa contra notificación liviana

Acá las pasarelas se dividen en dos:

- **Wompi manda el pago completo**: estado, monto, identificador, correo. Con verificar la firma, el comercio ya tiene todo.
- **Mercado Pago manda solo un identificador**: `{"action": "payment.created", "data": {"id": "1234567890"}}`. No hay estado ni monto.

El segundo caso obliga a un patrón de **conciliación en dos pasos**: verificar la firma, obtener el identificador, y consultar el estado real con `getPaymentStatus()`. El SDK devuelve `PENDING` en ese caso en lugar de fallar, porque la notificación es auténtica y lo que falta es el dato, no la validez.

---

## 7. Redirección y 3D Secure

**3D Secure** es la capa de autenticación del pagador ante su banco: el código que llega por SMS o la aprobación en la app. Cuando se activa, el pago no se resuelve en la respuesta del cobro: hay que mandar al pagador a una URL y esperar.

Esto significa que **cualquiera de las cuatro pasarelas puede pedir una redirección incluso con tarjeta**, y que el código del comercio tiene que estar preparado para eso siempre, no solo en PSE. Por eso el resultado de crear un pago en el SDK es una unión de dos casos (`TRANSACTION` o `REDIRECT_REQUIRED`) y no un objeto con un campo opcional: con un campo opcional, olvidarse de la redirección compila; con una unión, no.

La **URL de retorno** es donde vuelve el pagador. Las pasarelas no coinciden en cuántas quieren: Mercado Pago admite tres (éxito, fallo, pendiente), Rapyd dos, Kushki una y en un paso previo al cobro. El SDK las unifica en `ReturnUrlConfig`, que acepta una sola o una por resultado.

---

## 8. Los estados no se llaman igual en ninguna parte

El mismo desenlace de negocio tiene cuatro nombres distintos:

| Desenlace | Wompi | Mercado Pago | Kushki | Rapyd |
|---|---|---|---|---|
| Pago exitoso | `APPROVED` | `approved` | `APPROVAL` | `CLO` |

`CLO` es el más interesante: significa "cerrado", no "pagado". Un checkout cerrado sin pagar también termina en `CLO`, así que traducirlo a "aprobado" solo es correcto si la respuesta además trae `paid: true`. Un comercio que asumiera que `CLO` es éxito estaría entregando producto sin haber cobrado.

Kushki, además, usa **dos vocabularios distintos según el método**: con tarjeta dice `approval`, y con transferencia dice `approvedTransaction`, `declinedTransaction`, `expiredTransaction`. Son tablas separadas, no sinónimos.

La normalización del SDK traduce todo eso a seis valores: `APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED`, `ERROR`. Y conserva el estado nativo en un campo `rawStatus`, porque para auditar y para hablar con el soporte de la pasarela hace falta el original.

**Un estado desconocido se traduce a `ERROR`, no a "aprobado".** Parece obvio, pero la dirección del valor por defecto importa: fallar hacia el lado seguro significa que una pasarela que agregue un estado nuevo va a producir un error visible en lugar de una aprobación falsa.

---

## 9. Error transitorio contra error definitivo

Es la distinción que decide si reintentar.

| Tipo | Ejemplos | Qué hacer |
|---|---|---|
| **Transitorio** | Conexión caída, timeout, HTTP 5xx, HTTP 429 | Reintentar con espera creciente |
| **Definitivo** | Tarjeta sin fondos, credenciales inválidas, petición malformada, recurso no encontrado | No reintentar: el resultado va a ser el mismo |

Reintentar un error definitivo desperdicia tiempo y puede activar los límites de tasa de la pasarela. No reintentar un transitorio convierte una caída de red de dos segundos en una venta perdida.

El **retroceso exponencial con fluctuación** es la forma estándar de reintentar: se espera cada vez más (1s, 2s, 4s) y se le suma un valor aleatorio pequeño. La fluctuación importa porque sin ella, si la pasarela se cae un momento, todos los clientes reintentan sincronizados en el mismo instante y le pegan otra vez al mismo tiempo.

Y una distinción que el SDK marca con cuidado: **un rechazo no es un error.** Que el emisor declinara la tarjeta es una respuesta exitosa del sistema, con un desenlace negativo de negocio. Llega como una `Transaction` con estado `DECLINED`, no como una excepción. Las excepciones quedan para los fallos técnicos.

---

## 10. Sandbox y producción

Cada pasarela tiene un entorno de pruebas con llaves propias, datos ficticios y, casi siempre, comportamiento que **no es idéntico** al de producción. Esa última parte es la que sorprende, y es la razón de existir del segundo componente de este proyecto. Tres casos medidos:

- El sandbox de Wompi publica la URL de redirección de PSE en el mismo instante en que resuelve el pago. O sea: cuando la URL existe, ya no sirve para nada, porque el pago se resolvió solo sin que nadie visitara el banco. Contra ese sandbox el flujo de PSE **no se puede ejercitar** (punto 43).
- La Orders API de Mercado Pago, que es la única que soporta PSE, responde `401` con credenciales de prueba y exige un token de producción (punto 45).
- Kushki publica una ruta de consulta de estado para tarjeta que corresponde a su flujo asíncrono, y un cobro síncrono no queda registrado ahí: responde `CAS004 "No existe la transacción"` (punto 54).

Por eso el proyecto tiene una **API de Simulación** propia, que reproduce el orden real de los eventos y permite ejercitar flujos que los sandboxes no dejan completar, y **además** pruebas de contrato contra los sandboxes reales, que son las que detectan cuándo el simulador se volvió optimista. Las dos cosas hacen falta: el simulador solo sabe lo que se midió, y medir contra los sandboxes encontró defectos que el simulador no podía mostrar.

---

## 11. Qué sigue

Con estos conceptos alcanza para leer cómo funciona cada pasarela en concreto, que es [3-las-cuatro-pasarelas.md](3-las-cuatro-pasarelas.md).
