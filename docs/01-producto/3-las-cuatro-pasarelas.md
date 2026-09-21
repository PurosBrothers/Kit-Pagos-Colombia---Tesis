# Las cuatro pasarelas, una por una

Wompi, Mercado Pago, Kushki y Rapyd resuelven el mismo problema de negocio y no se parecen en nada. Este documento es la ficha de cada una: cómo autentica, cómo expresa el monto, cuántas llamadas necesita cada flujo, cómo firma y qué trampas tiene.

Casi todo lo que sigue está **medido contra los sandboxes reales** entre el 18 y el 20 de septiembre de 2026, no leído de la documentación oficial. Cuando las dos fuentes no coincidieron —y pasó varias veces— manda la medición, y se dice cuál era la discrepancia. El detalle campo por campo está en [ubiquitous-language.md](../02-arquitectura/ubiquitous-language.md); el registro de cada hallazgo, en el [architecture-log](../architecture/architecture-log.md).

> **Por qué estas cuatro.** Wompi, Mercado Pago y Kushki son tres de las pasarelas más usadas en Colombia. La cuarta era PayU, pero PayU fue adquirida en 2025 y su futuro como producto independiente quedó incierto, así que se reemplazó por Rapyd, que opera en Colombia con tarjeta y PSE. La decisión y su justificación están en la sección C del architecture-log.

---

## Comparación de un vistazo

| | **Wompi** | **Mercado Pago** | **Kushki** | **Rapyd** |
|---|---|---|---|---|
| **Autenticación** | `Bearer` con llave pública | `Bearer` con access token | Header propio: `Private-Merchant-Id` o `Public-Merchant-Id` | Firma HMAC por petición, con `salt`, `timestamp` y `access_key` |
| **Formato del monto** | `amount_in_cents`, entero en centavos | `transaction_amount`, pesos | Objeto con desglose de IVA | `amount`, pesos |
| **Llamadas para cobrar con tarjeta** | 2 (token de aceptación + cobro) | 1 | 1 | 1, y devuelve redirección |
| **Llamadas para PSE** | 1 + sondeo | 1 | 2 (token + init) | 2 (cliente + pago) |
| **Consulta de estado** | 1 ruta | 2 rutas, se elige por el formato del id | Hasta 3 tanteos | 2 rutas, se elige por el prefijo del id |
| **Lista de bancos PSE** | Endpoint dedicado | Se filtra de `payment_methods` | Endpoint dedicado | Se filtra de `payment_methods/country` |
| **Estado de éxito** | `APPROVED` | `approved` | `APPROVAL` | `CLO` **más** `paid: true` |
| **Firma de webhook** | SHA-256 con secreto embebido | HMAC-SHA256 hex sobre manifiesto | HMAC-SHA256 hex sobre cuerpo + id | HMAC-SHA256 en base64 sobre hex |
| **Secreto del webhook** | Distinto de la llave de API | Distinto | Distinto | El mismo que la llave de API |
| **Firma en lo que el comercio envía** | Sí, obligatoria | No | No | Sí, en cada petición |
| **Contenido del webhook** | El pago completo | Solo un identificador | El pago | El pago |

La fila más reveladora es la de llamadas: el mismo cobro con tarjeta cuesta entre una y dos peticiones según la pasarela, y con PSE ninguna de las cuatro coincide con otra. No hay forma de que un comercio escriba un código y sirva para las cuatro, y eso es precisamente lo que el SDK absorbe.

---

## Wompi

**Host de pruebas:** `https://sandbox.wompi.co/v1`

**Autenticación.** El SDK autentica **todas** sus llamadas a Wompi con la llave **pública** (`pub_test_*`) como `Authorization: Bearer`: el `WompiAdapter` envía `Bearer {credentials.publicKey}` tanto al pedir el token de aceptación como al cobrar y consultar, y la llave privada nunca viaja por la red (medido en `architecture-log.md`, punto 50; ver `layers-and-components.md` §2.5). Wompi expone además **dos secretos más**, que no son llaves de API: el de eventos, que firma los webhooks, y el de integridad, que firma lo que el comercio manda. Son cuatro valores distintos en un mismo panel, y confundirlos produce errores que parecen de otra cosa.

**Monto.** `amount_in_cents`, entero en centavos. Es la única de las cuatro que pide unidad menor.

**Cobrar con tarjeta — 2 llamadas:**

1. `GET /merchants/{llave_pública}` para obtener el **token de aceptación** de términos y condiciones. Es de un solo uso: hay que pedir uno nuevo por transacción, y reutilizarlo devuelve "El token de aceptación ya fue usado".
2. `POST /transactions` con el token de la tarjeta, el token de aceptación y la **firma de integridad**:

   ```text
   signature = SHA256_hex( reference + amount_in_cents + currency + secreto_de_integridad )
   ```

   Sin esa firma la API responde `422 "Firma de integridad requerida no enviada"` y no crea nada. Fue un defecto real del SDK que las pruebas unitarias no podían ver, porque el simulador no la exigía (punto 44).

**PSE — 1 llamada más un sondeo.** `POST /transactions` con el método PSE devuelve una transacción `PENDING` sin URL. La URL de redirección aparece después, en `transaction.extra.async_payment_url`, así que hay que consultar hasta que llegue.

**Y acá está la trampa más importante de Wompi:** en el sandbox, esa URL aparece **en el mismo instante en que el pago se resuelve**. No hay ninguna ventana de tiempo en la que redirigir tenga sentido, porque cuando la URL existe el pago ya terminó. Contra el sandbox de Wompi, el flujo de PSE **no se puede ejercitar de punta a punta**, y ese es uno de los motivos concretos por los que este proyecto tiene su propia API de Simulación (punto 43).

**Bancos PSE.** `GET /pse/financial_institutions`, con la llave pública. En sandbox la lista **no son bancos**: son tres entidades llamadas "Banco que aprueba", "Banco que declina" y "Banco que simula un error", con códigos `1`, `2` y `3`. El SDK las pasa tal cual en lugar de disfrazarlas, para que el comercio vea contra qué entorno está apuntando.

**Estado.** `GET /transactions/{id}`. Una sola ruta, el caso simple.

**Webhook.** Header `x-event-checksum`, y el algoritmo es un SHA-256 sin llave con el secreto dentro del texto:

```text
checksum = SHA256_hex( concat(valores de signature.properties) + timestamp + secreto_de_eventos )
```

Las propiedades a concatenar las declara el propio webhook en `signature.properties`, como rutas con puntos (`transaction.amount_in_cents`), así que el verificador tiene que resolverlas dinámicamente. Trae el pago completo, así que verificar la firma alcanza para conciliar.

**Alcance.** Wompi documenta nueve métodos de pago (tarjeta, PSE, Nequi, Daviplata, botón y QR de Bancolombia, Puntos Colombia, BNPL y efectivo). El SDK implementa dos: tarjeta y PSE.

---

## Mercado Pago

**Host de pruebas:** `https://api.mercadopago.com`

**Autenticación.** Un access token `TEST-*` como `Authorization: Bearer`. Sencillo, y el único que además exige un header por operación: **`X-Idempotency-Key`**. Sin él la API responde `400 "Header X-Idempotency-Key can't be null"`. No es opcional ni recomendado: es obligatorio, y el SDK genera un UUID por petición.

**Monto.** `transaction_amount` en pesos enteros.

**Cobrar con tarjeta — 1 llamada.** `POST /v1/payments` con el token de la tarjeta. La más directa de las cuatro.

**PSE — 1 llamada, pero a otra API.** PSE no vive en la Payments API sino en la **Orders API**: `POST /v1/orders`, con un cuerpo bastante más exigente. Pide tipo y número de documento, nombre y apellido, teléfono **con indicativo separado del número**, dirección, dirección IP del pagador y una URL de retorno obligatoria.

**Y tiene un bloqueo duro:** la Orders API **responde `401` con credenciales de prueba** y exige un token de producción. O sea que el flujo de PSE de Mercado Pago no se puede probar en sandbox en absoluto (punto 45). Sin simulador propio, este camino no se podría ejercitar nunca.

**Estado — dos rutas, y hay que elegir.** Los pagos con tarjeta se consultan en `/v1/payments/{id}` con un id numérico; las órdenes de PSE en `/v1/orders/{id}` con un ULID prefijado `ORD`. Mercado Pago no manda ningún discriminador, así que el adaptador **deduce la ruta del formato del identificador**: el prefijo `ORD` está documentado y medido, y consultar el recurso equivocado da un 404 que parece "el pago no existe".

**Bancos PSE.** No hay endpoint dedicado: se pide `GET /v1/payment_methods` y se filtra el método `pse`, de donde salen 47 entidades financieras. Bancolombia es `1007`, Davivienda `1051`, y el banco de prueba del sandbox es `1013`.

**Webhook — el caso liviano.** Header `x-signature: "ts=<timestamp>,v1=<hash>"`, y el hash es:

```text
manifiesto = "id:<data.id>;request-id:<x-request-id>;ts:<timestamp>;"
v1 = HMAC_SHA256_hex( secreto, manifiesto )
```

El cuerpo trae **solo un identificador**: `{"action": "payment.created", "data": {"id": "1234567890"}}`. No hay estado ni monto. Es la única de las cuatro que obliga al patrón de dos pasos: verificar la firma y después consultar el estado. El SDK devuelve `PENDING` en ese caso, porque la notificación es auténtica y lo que falta es el dato.

---

## Kushki

**Host de pruebas:** `https://api-uat.kushkipagos.com`

**Autenticación.** No usa `Authorization`. Usa headers propios y **distintos según la llave**: `Public-Merchant-Id` para las operaciones públicas y `Private-Merchant-Id` para las privadas. Y no es una elección del cliente: cada ruta acepta una sola de las dos, así que el adaptador tiene que saber, ruta por ruta, cuál corresponde. Equivocarse da `401`.

**Monto.** Ninguna de las otras tres hace esto: Kushki pide un **objeto con el desglose de impuestos**, con subtotal gravado, subtotal exento, IVA y divisa. El SDK lo modela con un objeto de valor `TaxBreakdown` que por defecto declara el monto como exento y verifica que las partes sumen el total.

**Cobrar con tarjeta — 1 llamada.** `POST /card/v1/charges`, síncrona, con la llave privada y `fullResponse: true` para que la respuesta traiga el estado resuelto.

**PSE — 2 llamadas, y con llaves distintas:**

1. `POST /transfer/v1/tokens` con la llave **pública**: devuelve un token.
2. `POST /transfer/v1/init` con la llave **privada**: devuelve la URL del banco.

El monto va en los dos pasos, porque Kushki lo exige en ambos.

**Estado — hasta tres tanteos, y es la parte más rara del proyecto.** Kushki tiene una ruta de consulta por método y **no publica ningún discriminador** entre sus identificadores. Como adivinar por la forma del id no se pudo verificar, el adaptador **pregunta**: intenta una ruta y, solo si Kushki responde que no conoce ese identificador, pasa a la siguiente.

El orden no es arbitrario, salió de medir:

| Ruta | Con llave privada | Por qué en esa posición |
|---|---|---|
| `/transfer/v1/status/{id}` | `200` si lo conoce, `400 T001` si no | Primera: es la única que emite un "no existe" del que se puede encadenar |
| `/card-async/v1/status/{id}` | `400 CAS004 "No existe la transacción"` | Segunda: la ruta existe, pero es el flujo asíncrono de tarjeta, que Kushki declara disponible solo en Chile |
| `/charges/{id}` | `403` para cualquier id | Última: responde igual que una ruta inventada, así que nunca discrimina |

La forma de distinguir "esta ruta no existe" de "no estás autorizado" fue leer el estilo del error: un `403 "Missing Authentication Token"` es la puerta de entrada diciendo que la ruta no existe, mientras que un `400 CAS004` es la aplicación de Kushki contestando **después** del autorizador, lo cual prueba que la ruta sí está publicada. Toda la exploración está en los puntos 50 y 53 del architecture-log, incluida la primera medición que concluyó —mal— que Kushki no tenía ninguna consulta de tarjeta: probó catorce formas de ruta y ninguna en el espacio `card-async`.

**Bancos PSE.** `GET /transfer/v1/bankList` con la llave pública. Trae una entrada de encabezado con código `0` y texto de instrucción, que el SDK descarta porque no es un banco.

**Webhook.** Header `x-kushki-signature` más `x-kushki-id`:

```text
firma = HMAC_SHA256_hex( secreto, cuerpo_crudo + "." + x-kushki-id )
```

**Dos vocabularios de estado.** Con tarjeta dice `approval`, `declined`, `initialized`. Con transferencia dice `approvedTransaction`, `declinedTransaction`, `expiredTransaction`, `requestedToken`, `initializedTransaction`. Son tablas separadas, y los estados intermedios de transferencia no estaban en la tabla original del SDK, así que una transferencia en curso se reportaba como error (punto 48).

**Alcance.** La documentación de datos de prueba de Kushki trae material de 3DS, OTP, efectivo, suscripciones y dispersión de fondos, todo fuera del alcance de este proyecto.

---

## Rapyd

**Host de pruebas:** `https://sandboxapi.rapyd.net/v1`

**Autenticación — la más laboriosa de las cuatro.** No hay un header fijo: **cada petición se firma**, y la firma depende del método HTTP, de la ruta, de un valor aleatorio, del reloj y del cuerpo:

```text
texto = método_en_minúsculas + ruta + salt + timestamp + access_key + secreto + cuerpo
firma = base64( HMAC_SHA256_hex( secreto, texto ) )
```

Van cuatro headers: `access_key`, `salt`, `timestamp` y `signature`. Tres detalles que arruinan la firma si se pasan por alto: el digest se serializa a hexadecimal y **ese texto** es lo que se codifica en base64 (pedir `digest("base64")` directo produce otra firma); el secreto entra **dos veces**, como llave y dentro del texto; y el cuerpo que se firma tiene que ser **exactamente** la cadena que se envía, así que el adaptador serializa una sola vez y reutiliza esa cadena para firmar y para el cuerpo.

**Monto.** `amount` en pesos. Y es la razón de fondo por la que el monto en el SDK se guarda como texto: como la firma se calcula sobre el cuerpo serializado, `"19.90"` y `"19.9"` producen firmas distintas y solo una es válida.

**Cobrar con tarjeta — 1 llamada, y devuelve una redirección.** `POST /checkout` crea una página de pago alojada por Rapyd y devuelve su URL.

**Por qué no es servidor a servidor:** se midió que el único camino directo que funciona exige el **número de la tarjeta** en la petición, lo cual metería el servidor del comercio en el alcance de PCI DSS. El checkout alojado lo evita. El costo es que el cobro con tarjeta en Rapyd siempre implica redirigir, igual que PSE, y eso es una diferencia visible para el comercio (punto 50).

**PSE — 2 llamadas:**

1. `POST /customers` para crear el cliente con sus datos de identificación.
2. `POST /payments` con el método PSE y el id del cliente.

La URL del banco viene en la respuesta de creación, sin sondeo: se midió `status: "ACT"` y `next_action: "pending_confirmation"` con la URL ya presente.

**Estado — dos recursos.** Un id de checkout no se consulta en `/payments/{id}`: son recursos distintos. El adaptador elige según el prefijo del identificador.

**Bancos PSE.** `GET /payment_methods/country?country=CO`, del que se filtran los métodos PSE. Los códigos son cadenas descriptivas como `co_pse_bancolombia_bank`, no números; son 47.

**Estado de éxito — el más engañoso.** `CLO` significa "cerrado", **no "pagado"**. Un checkout que se cerró sin pagar también queda en `CLO`. Traducirlo a `APPROVED` solo es correcto si la respuesta además trae `paid: true`, y el SDK verifica las dos cosas. Un comercio que asumiera que `CLO` es éxito estaría despachando producto sin haber cobrado.

**Webhook.** Header `signature`, con la misma construcción en base64, y con una particularidad: el texto que se firma incluye **la URL del webhook configurada en el panel de Rapyd**, que no se puede derivar de la petición entrante. Por eso el SDK la recibe como un header sintético `x-webhook-url` que el comercio agrega (punto 16). Es la única de las cuatro que usa la misma llave para la API y para los webhooks.

---

## Qué se lleva uno de todo esto

Tres conclusiones que sostienen el resto del proyecto:

1. **La diferencia no está en los detalles, está en la forma del flujo.** No es que una pasarela llame `amount` a lo que otra llama `amount_in_cents`: es que cobrar con tarjeta cuesta una llamada en Mercado Pago, dos en Wompi, y en Rapyd devuelve una redirección. Un comercio no puede escribir un solo código y esperar que sirva para las cuatro, y un diccionario de nombres de campo no alcanza para unificarlas.
2. **La documentación oficial no alcanza.** Cada trampa de este documento se descubrió ejecutando código contra el sandbox, y varias contradicen lo que estaba escrito en la documentación del proveedor.
3. **Los sandboxes tampoco alcanzan.** El de Wompi no permite ejercitar PSE, el de Mercado Pago no permite ejercitar PSE en absoluto, y el de Kushki no registra los cobros síncronos en su ruta de consulta. De ahí sale el segundo componente del proyecto.

---

## Qué sigue

Con el panorama completo del problema, ya se puede leer la propuesta: [4-por-que-kit-pagos.md](4-por-que-kit-pagos.md).
