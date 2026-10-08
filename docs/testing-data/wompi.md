# Credenciales
El primer paso para probar la API es tener las credenciales y sus keys, estas se encontraran en el ``.env``. 


Para integrar los ambientes de prueba (Sandbox) de **Wompi Colombia**, es necesario utilizar la llave pública de pruebas con el prefijo **`pub_test_`**.

Para integrar los ambientes de prueba (Sandbox) de Wompi, las peticiones deben dirigirse a la URL base: ``https://sandbox.wompi.co/v1``

A continuación se detallan los datos de prueba específicos para cada método de pago y el paso a paso de implementación cuando aplique.

---

# Datos de Prueba en Sandbox — Wompi Colombia

## 1. Tarjetas (Crédito / Débito)

Para probar la tokenización vía API (`POST /tokens/cards`) o mediante el Widget de Checkout:

| Estado Final | Número de Tarjeta | Fecha de Expiración | CVC |
| --- | --- | --- | --- |
| **Aprobada (`APPROVED`)** | `4242 4242 4242 4242` | Cualquier fecha futura | 3 dígitos cualquiera (ej: `123`) |
| **Declinada (`DECLINED`)** | `4111 1111 1111 1111` | Cualquier fecha futura | 3 dígitos cualquiera (ej: `123`) |

> **Nota:** Usar cualquier otro número de tarjeta generará un estado final **`ERROR`**.

### 1.1. El cobro medido contra la API real (19 de septiembre de 2026)

Tres cosas que solo aparecieron al llamar, y que están en el punto 50 del `architecture-log.md`:

1. **El cobro nace `PENDING`, no `APPROVED`.** `POST /transactions` responde `201` con
   `status: "PENDING"` y `finalized_at: null`, y la transacción pasa a `APPROVED` sola poco
   después: unos cientos de milisegundos el 19 de septiembre, y entre 1,2 y 2,8 s en tres
   transacciones el 6 de octubre (sección 1.3). El resultado **no está en la respuesta de
   creación**.
2. **Sin `payment_method` no hay cobro:** `422 UNPROCESSABLE` con
   `"No se especificó método de pago o fuente de pago"`.
3. **Sin firma de integridad tampoco**, ni con tarjeta ni con PSE: `422` con
   `"Firma de integridad requerida no enviada"`. La firma es
   `SHA256(referencia + monto en centavos + divisa + secreto de integridad)`.

   Wompi **valida de a uno y contesta por el primero que falte**, en este orden: formato del
   token, token de aceptación, firma. Eso importa porque significa que exigir un requisito sin
   el otro no acerca al comercio a poder cobrar: solo le cambia el mensaje. Desde el punto 53
   el SDK exige los dos antes de salir a la red —primero el secreto, que es configuración, y
   después el token de aceptación, que cuesta una llamada—, así que un comercio sin
   `integritySecret` recibe un error que nombra el ajuste que falta en vez de este `422`, y sin
   pagar ningún viaje.

   **Wompi tiene dos secretos y no son intercambiables:** el de integridad firma lo que sale y
   el de eventos valida los webhooks que entran. El panel los entrega juntos, intercambiarlos
   es fácil, y el síntoma —`422 "La firma es inválida"`— no dice que el problema sea de
   rotulado. En el SDK van en `integritySecret` y `webhookSecret`.

Las cuotas son opcionales: el cobro sin `installments` responde `201` igual, y la consulta
posterior devuelve la transacción sin ese campo.

```json
{
  "amount_in_cents": 15000000,
  "currency": "COP",
  "customer_email": "comprador@example.com",
  "reference": "ORDER-1042",
  "acceptance_token": "...",
  "signature": "...",
  "payment_method": { "type": "CARD", "token": "tok_test_...", "installments": 1 }
}
```

### 1.2. Consulta de una transacción que no existe (5 de octubre de 2026)

> **Medido contra el sandbox real entre las 11:58 y las 12:11 (UTC−5).**

`GET /v1/transactions/{id}` con un identificador inexistente responde `404`. Da lo mismo un uuid o un
id con la forma del nativo, y da lo mismo enviar `Authorization` o no:

```json
{"error":{"type":"NOT_FOUND_ERROR","reason":"La entidad solicitada no existe"}}
```

El mensaje no incluye el identificador consultado.

### 1.3. Tarjeta declinada y llave inválida (6 de octubre de 2026)

> **Medido contra el sandbox real entre las 10:31 y las 10:39 (UTC−5), para el issue #122.**

| Caso | HTTP | Lo observado |
| --- | --- | --- |
| Tarjeta `4242 4242 4242 4242` | `201` | Nace `PENDING`; la consulta la muestra `APPROVED`, sin `status_message`, a los 2 072 ms |
| Tarjeta `4111 1111 1111 1111` | `201` | Nace `PENDING`; la consulta la muestra `DECLINED` con `status_message: "La transacción fue rechazada (Sandbox)"`, a los 2 800 ms |
| `POST /transactions` con una llave privada inexistente y cuerpo válido | `401` | `{"error":{"type":"INVALID_ACCESS_TOKEN","reason":"Llave no válida"}}` |
| `POST /transactions` con la llave `garbage` | `401` | `{"error":{"type":"INVALID_ACCESS_TOKEN","reason":"La llave proporcionada no corresponde a este ambiente, se recibió: garbage"}}` |
| `POST /transactions` con llave inexistente y cuerpo `{}` | `422` | Error de validación del cuerpo; no hubo `401` |
| `GET /transactions/{id}` con una llave privada inexistente | `403` | `{"error":{"type":"INVALID_ACCESS_TOKEN","reason":"El token no tiene suficientes permisos"}}` |
| `GET /transactions/{id}` sin `Authorization`, con la llave pública o con la privada | `200` | La transacción completa |

- El token de aceptación es de un solo uso (reusarlo da `422 "El token de aceptación ya fue
  usado"`), pero un intento rechazado con `401` no lo gasta. Un `422` por firma sí lo gasta (ver
  «Errores de firma», abajo).
- Con una llave sin formato de sandbox, el `reason` repite la llave recibida. No se comprobó qué
  pasa con una llave de producción enviada al sandbox.

**Con una llave pública inexistente**, que es la que el SDK envía en todas las rutas de Wompi
(`Authorization: Bearer <publicKey>`). Medido el 6 de octubre de 2026 entre las 14:05 y las 14:12
(UTC−5), con `pub_test_` más 32 caracteres hexadecimales:

| Petición | HTTP | Respuesta |
| --- | --- | --- |
| `POST /transactions` (tarjeta, con token, aceptación y firma válidos) | `401` | `{"error":{"type":"INVALID_ACCESS_TOKEN","reason":"Llave no válida"}}` |
| `GET /transactions/{id existente}` | **`200`** | La transacción completa, igual que con la llave válida o sin `Authorization` |
| `GET /merchants/{la misma llave}` | `404` | `{"error":{"type":"NOT_FOUND_ERROR","reason":"La entidad solicitada no existe"}}`, también sin `Authorization` |
| `GET /merchants/foo` | `422` | `{"error":{"type":"INPUT_VALIDATION_ERROR","messages":{"public_key":["Formato inválido"]}}}` |
| `GET /pse/financial_institutions` | **`200`** | Los tres bancos de prueba; también con una `prv_test_` inexistente |
| `GET /pse/financial_institutions` sin `Authorization` | `401` | `{"error":{"type":"INVALID_ACCESS_TOKEN","reason":"Se esperaba una llave pública o privada pero no se recibió ninguna"}}` |
| `GET /pse/financial_institutions` con `foo` o con una `pub_prod_` inexistente | `401` | `"La llave proporcionada no corresponde a este ambiente, se recibió: …"`, con la llave repetida |
| `POST /tokens/cards` | `404` | `{"error":{"type":"NOT_FOUND","reason":"Comercio con llave pub_test_… no encontrado","code":"MERCHANT_NOT_FOUND"}}` |

Wompi rechaza la llave pública inexistente solo en las rutas que crean algo; en las lecturas
parece revisar solo el prefijo y el ambiente. Esa es una explicación posible, no medida. La lista
de bancos no exige una llave pública existente, solo una con forma de sandbox.

**Errores de firma.** Medido el 7 de octubre de 2026 entre las 21:13 y las 21:24 (UTC−5), para el
issue #130, con `POST /transactions` (PSE, banco `1`, 5 000 000 centavos), la llave privada y un
token de aceptación nuevo en cada caso, salvo donde se dice lo contrario. Cada caso cambia una sola
cosa respecto del control:

| Caso | HTTP | Respuesta |
| --- | --- | --- |
| Sin `signature`, o con `signature: null` | `422` | `{"error":{"type":"INPUT_VALIDATION_ERROR","messages":{"signature":["Firma de integridad requerida no enviada"]}}}` |
| `signature` vacía, `"no-es-hex"`, 64 `z`, 64 hex calculados con un secreto equivocado, o la firma correcta en mayúsculas | `422` | `{"error":{"type":"INPUT_VALIDATION_ERROR","messages":{"signature":["La firma es inválida"]}}}` |
| Sin `acceptance_token` y sin `signature` | `422` | `{"error":{"type":"INPUT_VALIDATION_ERROR","messages":{"acceptance_token":["No está presente"]}}}` |
| Cualquier firma, incluida la correcta, con el token de un intento anterior que falló por firma | `422` | `{"error":{"type":"INPUT_VALIDATION_ERROR","messages":{"acceptance_token":["El token de aceptación ya fue usado"]}}}` |
| Control: la firma correcta y un token nuevo | `201` | La transacción en `PENDING` |

- El sobre trae un solo campo y un solo mensaje, y no lleva `reason`. El `422` no trae cabeceras
  propias del error.
- **Un `422` por firma gasta el token de aceptación.** Después de ese error, reintentar con el
  mismo token no funciona: hace falta pedir otro en `GET /merchants/{llave}`. Dos consultas
  seguidas a esa ruta devuelven tokens distintos.
- El token se valida antes que la firma, como dice la sección 1.1.
- Sin medir: si Wompi compara la firma como texto exacto contra el hex en minúsculas, y si marca
  el token como usado antes de validar la firma. Las dos son explicaciones posibles de lo
  observado.

### 1.4. Validación del número en `POST /tokens/cards` (6 de octubre de 2026)

> **Medido contra el sandbox real a las 14:00 (UTC−5)**, con la llave pública, `cvc` `123`,
> vencimiento `12/29` y titular `Prueba Kit`.

| Número enviado | HTTP | Respuesta |
| --- | --- | --- |
| `4242424242424242` | `201` | `status: "CREATED"`, id `tok_test_…` |
| `4242`, o `4242 4242 4242 4242` con espacios | `422` | `{"error":{"type":"INPUT_VALIDATION_ERROR","messages":{"number":["debe coincidir con el patron \"^\\d{12,19}$\""]}}}` |
| `4242424242424241` (16 dígitos) o 19 dígitos que no pasan Luhn | `422` | `{"error":{"type":"INPUT_VALIDATION_ERROR","messages":{"number":["El número de tarjeta es inválido. Luhn check falló."]}}}` |

Wompi revisa primero el patrón y después el algoritmo de Luhn. El patrón no acepta espacios y
admite de 12 a 19 dígitos. «patron» va sin tilde, tal como lo devuelve la API, y ninguna respuesta
trae `reason`. El punto 77 del `architecture-log.md` registró solo el comienzo de este mensaje.

---

## 2. Nequi

### Datos de prueba

| Estado Final | Número de Teléfono (`phone_number`) |
| --- | --- |
| **Aprobada (`APPROVED`)** | `3991111111` |
| **Declinada (`DECLINED`)** | `3992222222` |

> Cualquier otro número de teléfono resultará en un estado **`ERROR`**.

### Ejemplo de Payload (API)

```json
{
  "payment_method": {
    "type": "NEQUI",
    "phone_number": "3991111111"
  }
}

```

---

## 3. PSE (Pagos Seguros en Línea)

### La lista de bancos se pide por API (`GET /pse/financial_institutions`)

> **Medido contra el sandbox real (`https://sandbox.wompi.co/v1`) el 18 de septiembre de 2026, issue
> #64.** Se autentica con la **llave pública**, no con la privada.

Wompi es la única de las cuatro con un endpoint dedicado a esto. Devuelve
`financial_institution_code` y `financial_institution_name`, y en sandbox **lo que devuelve no son
bancos**: son tres entidades de prueba cuyo código fuerza el desenlace.

| `financial_institution_code` | `financial_institution_name` (literal, de la API) |
| --- | --- |
| `"1"` | Banco que aprueba |
| `"2"` | Banco que declina |
| `"3"` | Banco que simula un error |

El tercero no estaba documentado en este archivo y sí existe. En esta medición se registró la lista,
no el desenlace. El estado final del código `3` se midió después, el 5 de octubre de 2026, y está en
la tabla de abajo. Vale la pena no maquillar estos
nombres al mostrarlos: un comercio que ve "Banco que declina" en su selector sabe al instante contra
qué entorno está apuntando.

### Integración API Directa (`POST /transactions`)

Se debe pasar el código de institución financiera (`financial_institution_code`), tomado de la lista
de arriba:

| Estado Final | `financial_institution_code` |
| --- | --- |
| **Aprobada (`APPROVED`)** | `"1"` |
| **Declinada (`DECLINED`)** | `"2"` |
| **Error (`ERROR`)**, medido el 5 de octubre de 2026 | `"3"` |

> **Medido contra el sandbox real el 5 de octubre de 2026, entre las 11:58 y las 12:11 (UTC−5).**
> El banco `"3"` crea la transacción con `201` y `PENDING`. Con consultas cada ~2 s, a los 2 931 ms
> sigue `PENDING` y sin `async_payment_url`. A los 4 964 ms está en `ERROR`, con
> `status_message: "Transacción con ERROR en Sandbox"` y con `async_payment_url` presente. El estado
> se mantiene igual hasta los 41 865 ms, la última consulta. Igual que en los bancos `1` y `2`, la URL
> y el desenlace aparecen en la misma consulta.

> **Medido de nuevo el 6 de octubre de 2026, entre las 13:57 y las 14:00 (UTC−5), para el issue
> #122.** Cinco transacciones (banco `1`, tres veces el `2` y el `3`), consultadas durante 20 s con
> un intervalo efectivo de 0,85 a 1,9 s, unas 90 consultas en total.

| Banco | Desenlace | `status_message` | Primera consulta con `async_payment_url` |
| --- | --- | --- | --- |
| `"1"` | `APPROVED` | `null` | La misma que trae `APPROVED`, a los 2 225 ms |
| `"2"` | `DECLINED` | `"Transacción RECHAZADA en Sandbox"` | La misma que trae `DECLINED`, entre 844 y 5 667 ms |
| `"3"` | `ERROR` | `"Transacción con ERROR en Sandbox"` | La misma que trae `ERROR`, a los 829 ms |

- **Ninguna consulta mostró `PENDING` con `async_payment_url`.** La URL, el desenlace,
  `finalized_at` y `status_message` llegaron siempre juntos. Con ese intervalo no se puede
  descartar una ventana de menos de 100 ms entre la URL y el desenlace.
- La URL tiene la forma `https://api-sandbox.wompi.co/v1/pse/redirect?ticket_id=<id sin guiones>`.
- El tiempo hasta el desenlace varió entre 0,2 y 2,8 s; los 4 964 ms del 5 de octubre se deben
  al intervalo de consulta de entonces, no a un tiempo fijo.
- Por lo tanto, un SDK que se detiene en cuanto ve la URL, sin mirar el estado, le entrega al
  comercio una redirección hacia un pago que ya está rechazado.

### Integración con Widget

En la interfaz visual desplegada, selecciona una de las siguientes opciones del listado de bancos:

* **Banco que aprueba**: Simula una transacción **`APPROVED`**.
* **Banco que rechaza**: Simula una transacción **`DECLINED`**.

### Ejemplo de Payload (API)

```json
{
  "payment_method": {
    "type": "PSE",
    "user_type": 0, // 0: Persona Natural, 1: Persona Jurídica
    "user_legal_id_type": "CC",
    "user_legal_id": "1999888777",
    "financial_institution_code": "1",
    "payment_description": "Pago a Tienda Wompi"
  }
}

```

---

## 4. Botón de Transferencia Bancolombia

### Paso a paso de implementación en Sandbox (API)

1. **Crear Transacción:** Envía la solicitud a `POST /transactions` especificando el tipo de método de pago:
```json
{
  "payment_method": {
    "type": "BANCOLOMBIA_TRANSFER",
    "payment_description": "Pago a Tienda Wompi"
  }
}

```


2. **Obtener la URL de autenticación:** Al recibir la respuesta o consultar la transacción (`GET /transactions/:id`), ubica el campo:
`data.payment_method.extra.async_payment_url`
3. **Simular el Estado:** Redirige o abre dicha URL. Te llevará a una vista de prueba (*Bandbox*) donde podrás seleccionar manualmente el estado deseado (**APPROVED**, **DECLINED**, etc.) para finalizar el flujo.

---

## 5. Bancolombia QR

### Integración API Directa (`POST /transactions`)

Define el estado deseado directamente en el payload usando la propiedad `sandbox_status`:

| Estado Final | Valor de `sandbox_status` |
| --- | --- |
| **Aprobada** | `"APPROVED"` |
| **Declinada** | `"DECLINED"` |
| **Error** | `"ERROR"` |

### Integración con Widget

En el Widget se mostrarán botones interactivos para seleccionar el estado deseado: **Transacción APROBADA**, **Transacción DECLINADA** o **Transacción con ERROR**.

### Ejemplo de Payload (API)

```json
{
  "payment_method": {
    "type": "BANCOLOMBIA_QR",
    "payment_description": "Pago a Tienda Wompi",
    "sandbox_status": "APPROVED"
  }
}

```

---

## 6. Puntos Colombia

### Integración API Directa (`POST /transactions`)

Utiliza la propiedad `sandbox_status` dentro del objeto `payment_method`:

| Caso / Estado Deseado | Valor de `sandbox_status` |
| --- | --- |
| **Pago 100% con puntos (Aprobado)** | `"APPROVED_ONLY_POINTS"` |
| **Pago 50% con puntos (Aprobado)** | `"APPROVED_HALF_POINTS"` |
| **Pago solo puntos declinado** | `"DECLINED"` |
| **Error al pagar con puntos** | `"ERROR"` |

### Ejemplo de Payload (API)

```json
{
  "payment_method": {
    "type": "PCOL",
    "sandbox_status": "APPROVED_ONLY_POINTS"
  }
}

```

---

## 7. BNPL Bancolombia (Compra Ahora, Paga Después)

### Paso a paso de implementación

1. **Iniciar Transacción:** Crea la transacción con el método de pago BNPL Bancolombia a través de la API o Widget.
2. **Redirección Sandbox:** Serás redirigido a la interfaz de pruebas de BNPL.
3. **Selección de Estado:** En la página de prueba visual se desplegará una pantalla de simulación donde podrás hacer clic en el botón correspondiente al estado con el que deseas que termine la transacción (**Aprobada**, **Rechazada**, etc.).

---

## 8. Daviplata

### A. Pago Simple (Transacción Directa)

#### Integración visual (Widget / Interfaz Wompi)

Al procesar la transacción se desplegará la interfaz con opciones de selección directa para definir si finalizará en **Aprobada**, **Declinada** o **Error**.

#### Integración vía API (Códigos OTP de prueba)

| Estado Final / Escenario | Código OTP a enviar |
| --- | --- |
| **Aprobada (`APPROVED`)** | `574829` |
| **Declinada (`DECLINED`)** | `932015` |
| **Declinada por Saldo Insuficiente** | `186743` |
| **Error (`ERROR`)** | `999999` |
| **OTP Inválido (permite reintento en estado `PENDING`)** | Cualquier otro número de 6 dígitos (ej: `123456`) |

---

### B. Pago Recurrente (Tokenización Daviplata)

#### Teléfonos de prueba para creación de Token

| Escenario | Número de Teléfono |
| --- | --- |
| **Token Aprobado** (Permite transacciones `APPROVED`) | `3991111111` |
| **Token Declinado** (Genera transacciones `DECLINED`) | `3992222222` |
| **Token Declinado (Monedero Inválido)** | `3993333333` |

#### Códigos OTP para confirmación de Token

| Escenario | Código OTP |
| --- | --- |
| **Confirmar Token Aprobado (`APPROVED`)** | `574829` |
| **Confirmar Token Declinado (Suscripción existente)** | `932016` |
| **Simular OTP Inválido** | Cualquier número de 6 dígitos diferente a los anteriores |

---

## 9. Su+ Pay

### Paso a paso de implementación

1. **Iniciar Pago:** Genera la transacción seleccionando **Su+ Pay** como método de pago.
2. **Redirección de Simulación:** El sistema redirigirá automáticamente a la página de pruebas de Sandbox de SU+ Pay.
3. **Finalización:** En la vista desplegada, elige el estado final con el cual deseas que concluya la prueba para verificar los webhooks y respuestas en tu sistema.