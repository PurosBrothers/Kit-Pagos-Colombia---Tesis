# Credenciales

> **Nota del 15 de octubre de 2026: con qué credenciales se hizo cada medición.** Desde ese día
> el proyecto mide con las credenciales `APP_USR-` de un **vendedor de prueba** de una aplicación
> «Checkout API via Orders»; con ellas están hechas la sección 1.3 y «PSE con el vendedor de prueba»
> de la sección 2. Las mediciones anteriores de este documento que dicen «sandbox» o «cuenta de
> prueba» y usaron el par `APP_USR-` anterior se hicieron, **por inferencia**, con credenciales de
> **producción** de la cuenta real del proyecto. La evidencia, medida el 15 de octubre de 2026:
> `GET /users/me` con ese token devolvía un usuario normal y no uno de prueba; la URL de banco del PSE
> llevaba al portal real de ACH Colombia (`registro.pse.com.co`, sección 2, 14 de octubre) y no al
> simulador de bancos de Mercado Pago; y los usuarios de prueba no podían pagar (sección 2, 18 de
> septiembre y 7 de octubre). Los tokens de tarjeta salían con `live_mode: true`, pero ese dato solo
> no distingue: los del vendedor de prueba también lo traen (sección 1.3). Lo medido con aquellas
> credenciales sigue siendo lo que respondió la API; lo que cambia es cómo se lee: los rechazos por
> antifraude y los `402` con usuarios de prueba son de una cuenta real, no del sandbox. Cada sección
> afectada lo advierte al principio.

El primer paso para probar la API es disponer de las credenciales de prueba y configurar la key de entorno en el archivo `.env`:

* **`MERCADO_PAGO_ACCESS_TOKEN`**: Clave privada de prueba generada en Mercado Pago para peticiones del backend (comienza obligatoriamente con el prefijo **`APP_USR-`**).



Sobre el **e-mail del comprador**, este documento decía que para comprar en el checkout de prueba
era **obligatorio** usar **`test@testuser.com`**, sin citar la fuente. El punto 2 de la sección 2,
medido el 18 de septiembre de 2026 con las credenciales anteriores, dice lo contrario para PSE:
`test_user_co@testuser.com` respondió `400 / 2034 Invalid users involved` y hubo que usar un email
corriente. Con el vendedor de prueba, el 15 de octubre de 2026, **ninguno de los dos resultó
obligatorio**: la tarjeta aprobó con `test@testuser.com`, `comprador@example.com` y
`jaime.pavlich@example.com`, con documento del pagador y sin él (sección 1.3), y el PSE creó la orden
con un email corriente y con uno `@testuser.com` (sección 2, «PSE con el vendedor de prueba»).

A continuación se detallan los datos de prueba específicos para cada método de pago y el paso a paso de implementación cuando aplique.

---

# Datos de Prueba en Sandbox — Mercado Pago

## 1. Tarjetas (Crédito / Débito)

Mercado Pago proporciona **tarjetas de prueba** genéricas que puedes combinar con **datos específicos en el nombre del titular** para simular distintos escenarios de respuesta.

### Datos de la Tarjeta

| Tipo de Tarjeta | Bandera / Marca | Número de Tarjeta | Código de Seguridad (CVV) | Fecha de Caducidad |
| --- | --- | --- | --- | --- |
| **Tarjeta de Crédito** | Mastercard | `5254 1336 7440 3564` | `123` | `11/30` |
| **Tarjeta de Crédito** | Visa | `4013 5406 8274 6260` | `123` | `11/30` |
| **Tarjeta de Débito** | Visa | `4915 1120 5524 6507` (ver la nota) | `123` | `11/30` |
| **Tarjeta de Débito** | Visa | `4912 6840 6309 1904` (ver la nota) | — | — |

**La tarjeta de débito.** Este documento listaba la Visa débito `4915 1120 5524 6507`, sin fuente
registrada. La documentación oficial de tarjetas de prueba de la Orders API
([tarjetas de prueba](https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/integration-test/cards))
lista `4912 6840 6309 1904`, según la consultó el equipo el 15 de octubre de 2026; la página no se
pudo abrir desde el agente ese día, así que su código de seguridad y su fecha no se transcriben aquí.
Lo medido el 15 de octubre de 2026 con el vendedor de prueba fue la `4915…`: su BIN, `491511`, es
`debvisa / debit_card` en `GET /v1/payment_methods/search`, y la orden respondió
`422 unprocessable_content`, enviada como `debvisa` y como `visa` (sección 1.3). La `4912…` no se
midió.

### Escenarios de Prueba (Datos del Titular)

Ingresa los siguientes valores en el campo **Nombre y Apellido del Titular** para forzar el estado deseado del pago:

| Estado / Resultado del Pago | Nombre del Titular (`name`) | Documento de Identidad |
| --- | --- | --- |
| **Pago Aprobado** | `APRO` | `123456789` |
| **Rechazado por Error General** | `OTHE` | `123456789` |
| **Pendiente de Pago** | `CONT` | `-` |
| **Rechazado con Validación para Autorizar** | `CALL` | `-` |
| **Rechazado por Importe Insuficiente** | `FUND` | `-` |
| **Rechazado por Código de Seguridad Inválido** | `SECU` | `-` |
| **Rechazado por Fecha de Vencimiento** | `EXPI` | `-` |
| **Rechazado por Error de Formulario** | `FORM` | `-` |
| **Rechazado por Falta de `card_number**` | `CARD` | `-` |
| **Rechazado por Cuotas Inválidas** | `INST` | `-` |
| **Rechazado por Pago Duplicado** | `DUPL` | `-` |
| **Rechazado por Tarjeta Deshabilitada** | `LOCK` | `-` |
| **Rechazado por Tipo de Tarjeta No Permitida** | `CTNA` | `-` |
| **Rechazado por Intentos Excedidos de PIN** | `ATTE` | `-` |
| **Rechazado por Estar en Lista Negra** | `BLAC` | `-` |
| **No Soportado** | `UNSU` | `-` |
| **Usado para Aplicar Regla de Montos** | `TEST` | `-` |

### 1.1. El cobro medido contra la API real (19 de septiembre de 2026)

> **Nota del 15 de octubre de 2026.** Esta medición usó el par `APP_USR-` anterior, que según la
> inferencia de la nota de «Credenciales» era de producción de la cuenta real, no de prueba. Lo que
> sigue es la Payments API, por donde cobraba la tarjeta el SDK hasta la versión 0.5.0; desde la 0.6.0
> va por la Orders API (sección 1.3), donde `installments` es opcional y `payment_method.id` sí se
> manda.

Dos llamadas: `POST /v1/card_tokens?public_key=...` con los datos de la tarjeta, y
`POST /v1/payments` con el token. Lo que apareció al medir (punto 50 del
`architecture-log.md`):

- **`installments` es obligatorio, incluso cuando es 1.** Sin el campo responde
  `400 "Invalid installments"`, y se comprobó con tres tarjetas colombianas distintas. Es la
  única de las cuatro pasarelas que lo exige siempre, y la razón de que las cuotas vivan en
  `PaymentMethod` y no en un adaptador.
- **`payment_method_id` no se manda: se deduce del token.** Omitir el token responde
  `400 "payment_method_id attribute can't be null"`, que nombra un campo que el comercio no
  tiene que escribir. Con token, la respuesta trae `payment_method_id: "visa"` o `"master"`.
- **El token es de un solo uso.** Reusarlo en un segundo cobro responde `400 "bin_not_found"`,
  que es un mensaje sobre el BIN y no sobre el token: fácil de perseguir por el lado
  equivocado.
- **Un rechazo viaja con `201`.** La cuenta de prueba rechazó con
  `cc_rejected_high_risk`, `cc_rejected_max_attempts` y `pending_review_manual`, siempre con
  HTTP `201`: el código HTTP no dice si el pago salió, solo que la transacción se creó.
- **`X-Idempotency-Key` es obligatorio, y es un header, no un campo del cuerpo.** Es la única
  de las cuatro pasarelas que lo exige, y sin él no se crea nada. Las dos APIs se quejan
  distinto del mismo header, así que conviene reconocer las dos formas:

  | Ruta | Respuesta sin el header |
  | --- | --- |
  | `POST /v1/payments` (tarjeta) | `400 {"message": "Header X-Idempotency-Key can't be null", "cause": [{"code": 4292}]}` |
  | `POST /v1/orders` (PSE) | `400 {"errors": [{"code": "empty_required_header", "message": "Missing HTTP header: X-Idempotency-Key."}]}` |

  Cuidado al medir a mano: los ejemplos de la documentación de Mercado Pago lo incluyen, así
  que se copia sin pensarlo y el requisito pasa desapercibido. Fue el defecto 19 del proyecto
  (punto 51 del `architecture-log.md`), y el SDK no podía cobrar por ningún método.

```json
{
  "transaction_amount": 150000,
  "description": "ORDER-1042",
  "external_reference": "ORDER-1042",
  "token": "016e85e4a608bfb0c1787ae2f4ed91e0",
  "installments": 1,
  "payer": { "email": "comprador@example.com" }
}
```

### 1.2. Titulares de prueba y token inválido (6 de octubre de 2026)

> **Nota del 15 de octubre de 2026.** La primera tabla se midió con el par `APP_USR-` anterior, que
> por inferencia era de producción de la cuenta real (nota de «Credenciales»). La conclusión del
> final de la sección, que «la cuenta de prueba no aplica la tabla de titulares», se lee ahora así:
> esa cuenta era real; con el vendedor de prueba, la tabla sí se aplicó en la Orders API (sección
> 1.3). Las filas con access tokens inexistentes no dependen de la cuenta.

> **Medido contra el sandbox real entre las 10:31 y las 10:39 (UTC−5), para el issue #122.**
> Cobro de 5 000 COP en una cuota con la tarjeta Mastercard `5254 1336 7440 3564`, 11/2030,
> documento CC `123456789`.

| Caso | HTTP | Lo observado |
| --- | --- | --- |
| Titular `OTHE` | `201` | `status: "rejected"`, `status_detail: "cc_rejected_high_risk"` |
| Titular `CONT` | `201` | `status: "rejected"`, `status_detail: "cc_rejected_high_risk"` |
| Titular `APRO` | `201` | `status: "rejected"`, `status_detail: "cc_rejected_high_risk"` |
| `POST /v1/payments` con un access token inexistente de forma `APP_USR-` | `401` | `{"code":"unauthorized","message":"user not found"}` |
| `POST /v1/payments` con el token `garbage` | `401` | `{"code":"unauthorized","message":"authorization value not present"}` |
| `GET /v1/payments/{id}` con un access token inexistente | `401` | `{"code":"unauthorized","message":"invalid access token"}` |
| `GET /v1/payments/{id}` con `garbage` o sin header | `401` | `{"message":"Must provide your access_token to proceed","error":"unauthorized","status":401,"cause":[{"code":5,...}]}` |

Medido el mismo día entre las 14:05 y las 14:12, con un access token inexistente de la misma
forma que el real:

| Petición | HTTP | Respuesta |
| --- | --- | --- |
| `POST /v1/orders` (PSE, cuerpo como el que arma el SDK) | `401` | `{"code":"unauthorized","message":"invalid access token"}` |
| `GET /v1/orders/{id existente}` | `401` | `{"code":"unauthorized","message":"invalid access token"}` |
| `GET /v1/payment_methods` | `401` | `{"message":"invalid_token","error":"not_found","status":401,"cause":[]}` |
| `GET /v1/payment_methods` sin `Authorization` | `401` | `{"message":"neither a public key or caller id were provided","error":"unauthorized_scopes","status":401,"cause":[]}` |

La cuenta de prueba no aplica la tabla de titulares de la sección anterior: los tres nombres
dieron el mismo rechazo, como ya había pasado con `APRO` el 19 de septiembre. Mercado Pago no
informa la causa; un antifraude a nivel de cuenta es una explicación posible, no medida. La
tabla de titulares queda como documentación oficial sin confirmar en esta cuenta.

### 1.3. Tarjeta por la Orders API (15 de octubre de 2026)

> **Medido contra la API real entre las 13:52 y las 14:00 (UTC−5), para el issue #109**, con las
> credenciales `APP_USR-` del vendedor de prueba de una aplicación «Checkout API via Orders». Es el
> camino del SDK desde la versión 0.6.0. Cobro de 20 000 COP con la Visa `4013 5406 8274 6260`,
> 11/2030, CVC `123` y documento CC `123456789` en el token, salvo donde se dice otra cosa. Cuerpo de
> `POST /v1/orders`: `type: "online"`, `processing_mode: "automatic"`, `total_amount: "20000"`, una
> `external_reference` única y un pago con
> `payment_method: { id: "visa", type: "credit_card", token, installments: 1 }`, más
> `Authorization: Bearer` y un `X-Idempotency-Key` nuevo en cada intento.

Con estas credenciales, `POST /v1/payments` responde `401 "Unauthorized use of live credentials"`
(prueba de contrato, 14:18 y 15:59): la Payments API ya no es una opción, y la tarjeta y el PSE van
por la misma API.

**El titular decide el desenlace, por prefijo.** Con el pagador `test@testuser.com`, entre las
13:53:01 y las 14:00:35:

| Titular | HTTP | Orden / pago | `GET /v1/orders/{id}` |
| --- | --- | --- | --- |
| `APRO`, `APRO Ruiz` | `201` | `processed / accredited` | `200`, igual |
| `CONT` | `201` | `processing / in_process` | `200`, igual 1,5 s después |
| `OTHE` | `402` | `failed / failed`, pago `failed / rejected_by_issuer` | `200`, igual |
| `FUND` | `402` | pago `failed / insufficient_amount` | `200`, igual |
| `SECU`, `EXPI`, `FORM` | `402` | pago `failed / bad_filled_card_data` | `200`, igual |
| `CALL` | `402` | pago `failed / required_call_for_authorize` | `200`, igual |
| `Felipe Ruiz` (fuera de la tabla) | `402` | pago `failed / rejected_by_issuer` | `200`, igual |
| Un token ya usado | `402` | pago `failed / invalid_card_token` | — |

La regla se midió con los nombres en mayúsculas. Entre las 13:52:18 y las 13:52:42, ocho órdenes con
el pagador `jaime.pavlich@example.com` y su documento respondieron `402`: el pago salió
`failed / high_risk` con `APRO`, `OTHE`, `FUND`, `SECU`, `CALL` y `CONT`, y
`failed / bad_filled_card_data` con `EXPI` y `FORM`. Desde las 13:53, la misma combinación aprobó dos
veces, y `APRO` también aprobó con `comprador@example.com` y sin el documento del pagador. Entre las
13:52 y las 14:00, 12 de 13 órdenes con `APRO` salieron aprobadas. Mercado Pago no informa la causa
del `high_risk`.

El cuerpo del `402` (titular `OTHE`, 13:53:48), con el `user_id`, el `application_id` y el token
reemplazados:

```json
{
  "errors": [
    {
      "code": "failed",
      "message": "The following transactions failed",
      "details": ["PAY01M50EKNA4CBANNDD3CFM2HED9: rejected_by_issuer"]
    }
  ],
  "data": {
    "id": "ORDTST01M50EKN9M576X8CTMBHWTYHT6",
    "type": "online",
    "processing_mode": "automatic",
    "external_reference": "kp109-card-1792090428531-601",
    "total_amount": "20000",
    "total_paid_amount": "20000",
    "country_code": "COL",
    "user_id": "<user_id>",
    "status": "failed",
    "status_detail": "failed",
    "capture_mode": "automatic_async",
    "currency": "COP",
    "created_date": "2026-10-15T18:53:48.74Z",
    "last_updated_date": "2026-10-15T18:53:50.251Z",
    "integration_data": { "application_id": "<application_id>" },
    "config": { "online": { "transaction_security": { "validation": "never" } } },
    "transactions": {
      "payments": [
        {
          "id": "PAY01M50EKNA4CBANNDD3CFM2HED9",
          "amount": "20000",
          "paid_amount": "20000",
          "reference_id": "000gsvpte1",
          "status": "failed",
          "status_detail": "rejected_by_issuer",
          "payment_method": {
            "id": "visa",
            "type": "credit_card",
            "token": "<token>",
            "installments": 1,
            "installment_amount": "20000",
            "transaction_security": { "validation": "never" }
          }
        }
      ]
    }
  }
}
```

Lo medido sobre la forma:

- El `402` tiene la misma forma que el del PSE de la sección 2: el sobre `errors[]`, con `details` en
  el formato `"<id del pago>: <status_detail>"`, y la orden entera en `data`. La consulta responde
  `200` con la orden suelta, sin el sobre.
- A diferencia del PSE fallido, `total_paid_amount` y `paid_amount` valen el total aunque el pago
  falle.
- Ninguna orden de tarjeta trae `payer`, ni al crear ni al consultar. Todas traen
  `capture_mode: "automatic_async"` y `transaction_security.validation: "never"`. La aprobada tiene
  la misma forma que la del `402`, en `processed / accredited` y sin el sobre.
- Los ids empiezan con `ORDTST01`; los de las mediciones anteriores, con `ORD01`.

**Cómo se obtienen `payment_method.id` y `payment_method.type`.** La Orders API los exige y el token no
los trae:

| Hora | Petición | Respuesta |
| --- | --- | --- |
| 13:55:22 | `POST /v1/card_tokens?public_key=…` | `201`. Claves: `id`, `public_key`, `first_six_digits`, `last_four_digits`, `expiration_month`, `expiration_year`, `cardholder`, `status`, `date_created`, `date_last_updated`, `date_due`, `luhn_validation`, `live_mode`, `require_esc`, `card_number_length`, `security_code_length`, `trunc_card_number`. **Sin `payment_method_id`.** `first_six_digits: "401354"`, `live_mode: true` |
| 13:55:22 | `GET /v1/card_tokens/{id}` con el access token | `200` con las mismas claves más `tokenization` y `wallet`. Leerlo **no consume el token**: la orden creada después con él salió `processed` |
| 13:55:24 | `GET /v1/payment_methods/search?public_key=…&bins=401354` | `200`, `{ paging: { total: 2, limit: 30, offset: 0 }, results: [...] }`: dos entradas `visa / credit_card / active`, cada una con decenas de campos |
| 13:55:24 | Ídem con `bins=525413` y con `bins=491511` | `master / credit_card` y `debvisa / debit_card`, dos entradas cada uno |
| 13:59:07 | Ídem con `bins=999999` | `200`, `results: []`, `total: 0` |
| 13:55:25 | Búsqueda con el Bearer y sin `public_key` | `400 {"code":400,"message":"public_key is required"}`. Con los dos, `200` |
| 13:59:07 | Búsqueda con una llave pública inexistente | `404 {"code":404,"message":"public key not found"}` |
| 13:59:06 | `GET /v1/card_tokens/{id inexistente}` | `404 {"message":"could not get a Cardtoken with the following id: …","status":404,"error":""}` |
| 13:59:06 | `GET /v1/card_tokens/{id}` con un access token inexistente | `401`, `code: "unauthorized_access"`, `cause: [{"description":"","code":""}]` |
| 13:59:06 | `GET /v1/card_tokens/{id}` sin `Authorization` | `401`, `cause: [{"description":"access_parameters is required","code":"E212"}]` |

**Validaciones de la orden de tarjeta**, entre las 13:55:25 y las 14:00:32:

| Caso | HTTP | Respuesta |
| --- | --- | --- |
| Sin `payment_method.id` | `400` | `required_properties`: `'$.transactions.payments[0].payment_method' - missing properties: 'id'` |
| Sin `type` | `400` | ídem, `'type'` |
| Sin `id` ni `type` | `400` | ídem, `'id', 'type'` |
| Sin `token` | `400` | ídem, `'token'` |
| Visa crédito enviada como `debit_card` | `400` | `property_value`: `'$.transactions.payments[0].payment_method.id' - value must be one of 'debmaster', 'debvisa'` |
| Visa crédito enviada como `master` | `400` | `payment_method_not_allowed_for_collector`, «The payment method is not allowed for this collector.» |
| `installments: 3` | `201` | `processed`, `installments: 3`, `installment_amount: "6667"` |
| Sin `installments` | `201` | `processed`, `installments: 1` |
| `total_amount: "20000.00"` | `400` | `property_value`: `'$.transactions.payments[0].amount' - does not match pattern` y `'$.total_amount' - does not match pattern` |
| Mastercard `5254 1336 7440 3564` como `master / credit_card` | `201` | `processed / accredited` |
| Visa débito `4915 1120 5524 6507` como `debvisa / debit_card`, o como `visa / credit_card` | `422` | `{"errors":[{"code":"unprocessable_content","message":"Unprocessable Entity"}]}` |
| La misma débito como `debvisa` con 3 cuotas | `400` | `'$.transactions.payments[0].payment_method.installments' - value must be '1'` |

Y a las 13:55:35, `GET /v1/payments/{id numérico inexistente}` respondió el mismo
`404 "Payment not found"` con `cause[0].code: 2000` que la sección 3 registra con las credenciales
anteriores.

Sin medir: el 3DS por la Orders API (las órdenes llegaron con `validation: "never"` y el SDK no lo
pide), por qué la Visa débito responde `422` en esta cuenta, la tarjeta de débito `4912…` y los
titulares en minúsculas.

---

## 2. PSE (Pagos Seguros en Línea)

> **Nota del 15 de octubre de 2026.** Lo que sigue hasta «PSE con el vendedor de prueba» se midió con
> el token `TEST-` (el `401` del punto 1) y con el par `APP_USR-` anterior, que por inferencia era de
> producción de la cuenta real (nota de «Credenciales»). Eso explica, como hipótesis, el punto 2: un
> usuario de prueba no puede pagarle a una cuenta real. Con el vendedor de prueba, la orden se creó
> con un email corriente y con uno `@testuser.com`, y la URL de banco lleva al simulador de bancos de
> Mercado Pago («PSE con el vendedor de prueba», más abajo).

> ### Verificado contra la API real el 18 de septiembre de 2026 (issue #64)
>
> Lo que sigue en esta sección es correcto en cuanto a la forma del payload y a la
> ubicación de la URL de redirección. Pero al implementarlo aparecieron cuatro
> cosas que no están dichas aquí y que hacen fallar la integración si uno sigue el
> paso a paso literalmente. El razonamiento completo está en el punto 45 del
> `architecture-log.md` y en `sdk/src/infrastructure/adapters/mercadopago-pse.ts`.
>
> 1. **El token `TEST-` no sirve para esta API.** `POST /v1/orders` responde
>    `401 invalid_credentials`: "Test credentials are not supported, use test users
>    with production credentials to sandbox environment". Hace falta el token
>    `APP_USR-`, que es lo que ya decía el paso 1 pero sin explicar que un `TEST-`
>    falla de entrada.
>
> 2. **El email del ejemplo no funciona, y un usuario de prueba tampoco.** Con
>    `test_user_co@testuser.com` la respuesta es `400 / 2034 Invalid users
>    involved`. Y con un usuario creado por `POST /users/test_user` la orden se
>    crea pero el pago muere en `failed / processing_error` (402), o sea lo
>    contrario de lo que aconseja el mensaje de error del punto anterior. **Hay que
>    usar un email corriente** (por ejemplo `comprador@example.com`).
>
> 3. **`total_amount` no admite decimales.** `"5000"` funciona y `"5000.00"`
>    responde `400 Invalid value for property`.
>
> 4. **PSE no se puede cobrar por la Payments API.** Se intentó por
>    `POST /v1/payments` con el banco en `transaction_details.financial_institution`
>    y devuelve `424 / 9032 BankTransfers Api fail` con cualquier banco y cualquier
>    monto, aunque las mismas credenciales sí procesen tarjeta. La Orders API no es
>    una alternativa: es el único camino.
>
> **Campos obligatorios, medidos quitándolos de a uno.** En `payer`: `email`,
> `entity_type`, `first_name`, `last_name`, `identification`, `phone` y `address`,
> todos con `400 '$.payer' - missing properties`. Fuera de `payer`:
> `additional_info` (la IP), `external_reference` y `config` (la URL de retorno).
> Son opcionales `expiration_time` y `processing_mode`.
>
> **Lista real de bancos.** No hace falta adivinarla: `GET /v1/payment_methods`
> devuelve el método `pse` con su arreglo `financial_institutions`. Ahí están
> `1001` Banco de Bogotá, `1007` Bancolombia, `1013` BBVA, `1051` Davivienda y el
> resto, junto con `min_allowed_amount: 1600` y `max_allowed_amount: 340000000`.
> Un código inexistente **no** se rechaza al crear: pasa la validación y el pago
> muere después en `processing_error`. La orden sí se crea, pero la respuesta a
> `POST /v1/orders` ya es ese `402` (medido el 7 de octubre de 2026, en la sección
> que sigue).
>
> Son **47 entidades**, contadas contra la API real el 18 de septiembre de 2026 — el
> mismo número que devuelve Rapyd, porque las dos leen el registro de ACH Colombia.
> El SDK las expone con `kitPagos.getPseBanks()`, que filtra esa entrada del
> catálogo; el comercio no tiene que conocer que la lista viene anidada dentro de
> todos los métodos de pago del país.

### El `402` de una orden de PSE que falla (7 de octubre de 2026)

> **Nota del 15 de octubre de 2026.** Medido con el par `APP_USR-` anterior, que por inferencia era
> de producción de la cuenta real (nota de «Credenciales»). La forma del `402` se repitió con el
> vendedor de prueba en las órdenes de tarjeta rechazadas (sección 1.3).

> **Medido contra la API real entre las 09:07 y las 09:09 (UTC−5), para el issue #122.** Las
> peticiones usaron el token `APP_USR-`, las cabeceras de `MercadoPagoAdapter.ts` y el cuerpo de
> `buildPseOrderPayload`, con `total_amount` en `"5000"`. Entre un caso y otro cambió una sola
> cosa.

| Caso | Respuesta |
| --- | --- |
| Control: email `comprador@example.com`, banco `1051` | `201`, orden en `action_required / waiting_transfer`, pago con `redirect_url` |
| El mismo cuerpo con el email de un usuario creado por `POST /users/test_user` | `402`, cuerpo de abajo |
| El control con el banco `9999`, que no existe | `402` con la misma forma; el pago trae `financial_institution: "9999"` |
| `GET /v1/orders/{id}` de la orden del `402`, dos veces con 6 s de diferencia | `200` las dos veces, con la orden suelta en `failed / failed` y el mismo `last_updated_date` |

El cuerpo del `402`, con el `user_id` y el `application_id` de la cuenta reemplazados:

```json
{
  "errors": [
    {
      "code": "failed",
      "message": "The following transactions failed",
      "details": ["PAY01M4BB3B6824R6BDME6MJAWQD5: processing_error"]
    }
  ],
  "data": {
    "id": "ORD01M4BB3B5XBNNB1EF1AM53K2MA",
    "type": "online",
    "processing_mode": "automatic",
    "external_reference": "kp122-tu-1791382104",
    "total_amount": "5000",
    "total_paid_amount": "0",
    "country_code": "COL",
    "user_id": "<user_id-cuenta>",
    "status": "failed",
    "status_detail": "failed",
    "capture_mode": "automatic_async",
    "currency": "COP",
    "created_date": "2026-10-07T14:08:25.288Z",
    "last_updated_date": "2026-10-07T14:08:25.849Z",
    "integration_data": { "application_id": "<application_id>" },
    "payer": { "entity_type": "individual" },
    "config": { "online": { "callback_url": "https://merchant.com/pse/return" } },
    "transactions": {
      "payments": [
        {
          "id": "PAY01M4BB3B6824R6BDME6MJAWQD5",
          "amount": "5000",
          "reference_id": "000ghe1vp0",
          "status": "failed",
          "status_detail": "processing_error",
          "payment_method": { "id": "pse", "type": "bank_transfer", "financial_institution": "1051" }
        }
      ]
    }
  }
}
```

Lo medido:

- El `402` trae dos cosas a la vez: el sobre `errors[]`, con `details` en el formato
  `"<id del pago>: <status_detail>"`, y la orden entera en `data`.
- La orden **sí existe**: la consulta responde `200` con el mismo estado. En la consulta la orden
  llega sin el sobre `data` y sin la llave `payer`.
- `total_paid_amount` es `"0"` (en el control es `"5000"`) y el pago no trae `redirect_url`.

Sin medir: si otras causas de rechazo llegan con esta misma forma (un monto bajo el mínimo responde
`422`, según el punto 45 del `architecture-log.md`), si el estado `failed` es definitivo pasados
más de 6 segundos y qué responde un reenvío de la misma `X-Idempotency-Key` después del `402`.

### La URL de banco del PSE y la vuelta al comercio (14 de octubre de 2026)

> **Nota del 15 de octubre de 2026.** Medido con el par `APP_USR-` anterior. Que la URL llevara al
> portal real de ACH Colombia (`registro.pse.com.co`) y no al simulador de bancos es parte de la
> evidencia de que esas credenciales eran de producción (nota de «Credenciales»). Con el vendedor de
> prueba, la URL es otra y lleva al simulador de bancos de Mercado Pago («PSE con el vendedor de
> prueba», más abajo).

> **Medido contra la API real entre las 10:58 y las 11:18 (UTC−5), para el issue #109.** Mismo
> cuerpo y mismo token `APP_USR-` que el control de la sección anterior, y el navegador de Cursor
> para abrir las URL. Las capturas están en la evidencia del #109 (`medicion-real-mercadopago/`).

| Qué se hizo | Lo que pasó |
| --- | --- |
| `POST /v1/orders` con el control (`callback_url` `https://example.com/retorno-pse`) | `201`, `action_required / waiting_transfer`; `payment_method.redirect_url` = `https://www.mercadopago.com.co/payments/<12 dígitos>/bank_transfer?caller_id=<id de la cuenta>&hash=<uuid>` |
| Comparar el id de la ruta con el del pago (`PAY01…`, 29 caracteres) | **No coinciden.** El de la ruta es numérico de 12 dígitos |
| `GET` de la `redirect_url` con `fetch` de Node | `403` |
| `GET` de la `redirect_url` con el `user-agent` de un navegador | `302` a `https://registro.pse.com.co/PSENF/index.html?enc=<cifrado>` |
| Abrirla en el navegador | La página «PSE A UN CLIC» de ACH Colombia: «Autoriza a PSE y realiza tus pagos en línea», con «Continuar» y «Regresar al comercio». **No es una página de Mercado Pago.** No se siguió por «Continuar», que pide registrarse con un código enviado al correo: el simulador de bancos con escenarios que describe el paso a paso de abajo no se vio |
| «Regresar al comercio» y confirmar | Primero «Comprobante de tu pago con Pse» en `…/payments/<12 dígitos>/bank_transfer?caller_id=…&hash=…&from_pse=true` («Tu pago a <vendedor> está en proceso», cuenta regresiva de 3 s, referencia CUS) y después la `callback_url` con **`?payment_id=<el id numérico de la ruta>`** |
| `callback_url` `http://comercio-de-prueba.example.com/retorno` | `201`: acepta `http` si el host es público |
| `callback_url` `http://127.0.0.1:4299/…` (4 de 4), `https://127.0.0.1/retorno`, `https://localhost/retorno`, `http://localhost:4100/` | `402`, `processing_error`, sin `redirect_url`: **rechaza una `callback_url` que apunta a la máquina local**, con `http` o con `https` |

Dos limitaciones. La vuelta medida es la de **cancelar** con «Regresar al comercio»; no se llegó al
desenlace `approved`, que exige autorizar en un banco. Y el `402` intermitente de la sección anterior
también apareció una vez con la `callback_url` del control (una de tres órdenes idénticas); no se
caracterizó. Sin medir: si el `payment_id` de la vuelta se puede consultar en la API de órdenes.

Medido después, el 15 de octubre de 2026 a las 10:15 (UTC−5) y con las mismas credenciales anteriores:
el `payment_id` de doce dígitos **se consulta en la Payments API**, con `GET /v1/payments/{payment_id}`,
que respondió `pending / pending_waiting_transfer`. Ese pago no nombra la orden: solo se vincula a ella
por la `external_reference`.

### PSE con el vendedor de prueba y la IP del pagador (15 de octubre de 2026)

> **La orden de PSE se midió a las 13:12 (UTC−5) con las credenciales del vendedor de prueba**, con el
> cuerpo de `buildPseOrderPayload`. La tabla de IP se midió entre las 10:11 y las 10:13 (UTC−5); la
> medición no registró con cuál de los dos pares de credenciales.

**La URL de banco cambia con estas credenciales.** `payment_method.redirect_url` es
`https://www.mercadopago.com.co/sandbox/payments/<12 dígitos>/bank_transfer`, con `/sandbox/` en la
ruta, y responde `302` a `api.mercadopago.com/beta/bc_pse_sim/login`, el simulador de bancos de PSE de
Mercado Pago que describe el paso a paso de abajo. La orden se creó con un email corriente y con uno
`@testuser.com`.

**La IP del pagador** (`additional_info["payer.ip_address"]`), cambiando solo ese valor en un PSE por
la Orders API:

| IP enviada | Resultado |
| --- | --- |
| `200.100.50.25`, `181.49.100.20` | Aceptada |
| `127.0.0.1` | Aceptada |
| `192.168.1.10`, `10.0.0.5` | Aceptada |
| `2800:484:1a2b:3c00::20` | Aceptada |
| `0:0:0:0:0:0:0:1` | Aceptada |
| `::1` | `400`, «length must be >= 7, but got 3» |
| `::ffff:127.0.0.1` | `400`, «does not match pattern» |
| `" 127.0.0.1"` (con un espacio delante) | `400`, «does not match pattern» |

`::1` y `::ffff:127.0.0.1` son las formas en que Node entrega `req.ip` en un servidor que escucha en
`::`. Por eso `/v1/api` y, desde la versión 0.6.0, el SDK quitan los espacios y reescriben esas dos
formas como `127.0.0.1` (o `a.b.c.d`) antes de enviarlas (`normalizePayerIp()`).

### La orden de PSE que nace sin URL (noche del 15 de octubre de 2026)

> **Medido entre las 21:33 y las 21:44 (UTC−5) con las credenciales del vendedor de prueba**, en la
> misma tanda que la sección 4. Lo registra el informe de esa medición, que resume los resultados;
> los cuerpos completos de las respuestas no quedaron guardados en el repositorio.

Las 18 órdenes de PSE creadas en ese intervalo (la búsqueda de órdenes del vendedor las cuenta todas;
el informe de esa noche contaba 12), con varios pagadores y bancos, nacieron
`processing / in_process` con `201` y **sin `redirect_url`**, y unos 4 segundos después estaban en
`failed / processing_error`. A las 13:12 del mismo día, el mismo cuerpo había nacido
`action_required` con la URL (sección anterior).

**Lo que se descartó el 16 de octubre de 2026** (15:09–15:23, mismas credenciales):

- **No es nuestra petición.** El ejemplo de la [compra de prueba con PSE](https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/integration-test/pse), enviado tal cual (CC, `test@testuser.com`, banco `1051`, `expiration_time` en la raíz), falla igual, y también el de la [integración de PSE](https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/payment-integration/websites/pse) (NIT), el cuerpo del SDK con y sin `expiration_time` en el pago, otro banco y otro monto, un pagador nunca usado, y una orden en modo `manual` procesada después con `POST /v1/orders/{id}/process`. La IP anidada en `additional_info.payer.ip_address`, como la muestra la [referencia de crear order](https://www.mercadopago.com.co/developers/es/reference/online-payments/checkout-api/create-order/post), responde `400`; la clave plana `additional_info["payer.ip_address"]`, la del SDK, es la que acepta la API.
- **Mercado Pago no llega a crear la transferencia.** Las dos órdenes buenas de las 13:12 tenían su pago en la Payments API (`pending_waiting_transfer`, con `bank_transfer_id`); ninguna de las fallidas lo tiene, y ninguna respuesta trae `cause` ni otra pista. Una tarjeta con las mismas credenciales sigue saliendo `processed / accredited`.
- **Una pista sin confirmar.** Las URL de banco de las dos órdenes de las 13:12, que nadie pagó, llevan al simulador de bancos (`bc_pse_sim/login`), y este responde «¡Lo sentimos! No se puede continuar con el pago, ya tienes una transacción en curso.» Se cancelaron las dos (`200 canceled`) y el PSE siguió fallando.
- **Sin incidentes publicados.** [status.mercadopago.com](https://status.mercadopago.com/) decía «All Systems Operational» a las 14:54, sin incidentes de PSE ni de Orders entre el 13 y el 16 de octubre; esa página no cubre el sandbox. `/users/me` del vendedor no muestra restricciones (`site_status: active`), y la documentación de [cuentas de prueba](https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/resources/test-accounts) no menciona límites de órdenes.

**Con una segunda aplicación funcionó dos veces** (16 de octubre de 2026, 15:37–15:44). Con las
credenciales de prueba de una **segunda** aplicación de Checkout API vía Orders, la misma petición del SDK nació
`action_required / waiting_transfer` con la `redirect_url`, que llevó a «Banco Prueba PSE»
(`api.mercadopago.com/beta/bc_pse_sim/login`). El recorrido completo:

1. Iniciar sesión con un usuario y una contraseña cualesquiera.
2. «Información de Pago»: el documento, el `Payment ID` (el id de 12 dígitos de la URL) y un desplegable de 30 escenarios. El primero es «APROBAR PAGO»; le siguen «USUARIO ABANDONÓ TRANSACCION EN BANCO», «CUENTA INACTIVA», «CUENTA NO EXISTE», «FALLAS TECNICAS» y otros.
3. Con «APROBAR PAGO» y «Enviar»: «Estado de la Transacción: OK».
4. «Volver al comercio» llevó a la `callback_url` con `?payment_id=<id de 12 dígitos>`.
5. `getPaymentStatus()` del SDK sobre el id de la orden: `APPROVED`, nativo `processed`, final.

Con el mismo par, la tarjeta con titular `APRO Ruiz` salió `APPROVED` (`processed`) y con `OTHE Ruiz`,
`DECLINED` con `rejected_by_issuer`.

**Las dos aplicaciones comparten el vendedor de prueba** (medido el 16 de octubre a las 16:12). Con el
token de la segunda, `/users/me` devuelve un usuario registrado el 15 de octubre a las 13:00, cuando
se creó la primera aplicación, y `GET /v1/payments/search` del 15 de octubre devuelve 64 pagos hechos
con la primera: los dos PSE de las 13:12 (`cancelled / by_collector`) y las pruebas de tarjeta.

**A las 19:07 la segunda aplicación falló igual.** Un PSE del cliente C por `/v1/api` nació
`processing` sin URL y terminó `failed / processing_error`. A las 19:09, el mismo cuerpo que había
funcionado a las 15:41, enviado con el SDK, nació `processing` sin URL, y a las 19:24 otro PSE del
cliente C con `test@testuser.com` y el banco 1051 terminó igual. Los dos PSE de la segunda
aplicación que llegaron al banco, a las 15:38 y a las 15:41, quedaron cerrados: la búsqueda de pagos
los da `rejected / bank_error` y `approved / accredited`. Una transacción abierta, entonces, no lo explica.

**Una tercera aplicación entregó la URL tres veces seguidas** (17 de octubre de 2026, 12:41–12:46).
Con el mismo vendedor de prueba (`/users/me` da el mismo usuario) y el mismo cuerpo, los tres primeros
PSE nacieron `action_required` con la URL y se cerraron en «Banco Prueba PSE»: el primero y el tercero
con «APROBAR PAGO» («Estado de la Transacción: OK»; la consulta da `APPROVED`, nativo `processed`) y el
segundo con «USUARIO ABANDONÓ TRANSACCION EN BANCO» («NOT_AUTHORIZED»; la consulta da `DECLINED`, nativo
`failed`, con `processing_error`). El primero volvió a `https://example.com/retorno-pse?payment_id=183679736521`.
No es, entonces, un límite de dos PSE por aplicación. El abandono en el banco termina con el mismo
`processing_error` que las órdenes sin URL; lo que las distingue es que esta orden sí tuvo URL.

**La causa no se conoce, y no es la petición.** La misma petición pasa de funcionar a fallar sin que
cambie nada de nuestro lado. Lo que se repite: las primeras órdenes de PSE de cada aplicación, creadas
poco después de crearla, entregaron URL (dos el 15 de octubre a las 13:12 con la primera, dos el 16 a las
15:38 y 15:41 con la segunda, tres el 17 entre las 12:41 y las 12:44 con la tercera), y en las dos
primeras, horas después, ninguna orden la entregaba. En esas dos, entre los PSE que funcionaron y los que
fallaron hubo cobros con tarjeta de la misma aplicación. Falta medir si el corte depende del tiempo o de
esos cobros.

**Tres horas después, sin cobros con tarjeta, seguía funcionando** (17 de octubre de 2026). Con la
tercera aplicación, ya en las líneas principales del `.env`, el PSE 4 entregó la URL a las 15:12 con el
mismo cuerpo, y el PSE 5, a las 15:23, desde la tienda del prototipo C y con su propio pagador
(`pagador.c@example.com`, 84 000 COP, banco 1051): «Banco Prueba PSE», «APROBAR PAGO», el comprobante de
Mercado Pago y la vuelta a la tienda con `payment_id=184734495674`, `APPROVED`. El PSE 6, a las 15:46, también
desde la tienda (65 000 COP, Bancolombia), terminó igual: `payment_id=184739554282`, `APPROVED`. A la segunda aplicación,
creada hacia las 15:30 del 16, se le cortó antes de las 19:07, unas tres horas y media después y con
cobros con tarjeta en medio. Con la tercera no se ha cobrado ninguna tarjeta.

**Sin «Volver al comercio», el pago no se confirma.** El PSE 4 se aprobó en el banco simulado a las
15:12 y la consulta siguió dando `action_required` a las 15:13 y a las 15:14. Segundos después de pulsar
«Volver al comercio», que pasa por el comprobante de Mercado Pago («Tu pago a Test Test está en proceso»,
con una cuenta regresiva), dio `APPROVED`. Los otros cuatro pasaron por ese botón antes de consultarse.
Es una sola comparación, pero coincide con la documentación: el comprobante es el paso que lleva a la
`callback_url`. Cancelar las órdenes abiertas no cambió nada. Por precaución, **en este sandbox cada PSE se
termina en el banco simulado**, aprobándolo o eligiendo «USUARIO ABANDONÓ TRANSACCION EN BANCO», en vez
de dejarlo abierto.

Para el comercio, una orden sin URL no tiene adónde mandar al pagador, pero existe y tiene
identificador. Desde la versión 0.6.0-rc.2, `createPayment()` la devuelve como una transacción
`PENDING` con `rawStatus` `processing`, y la consulta posterior da `DECLINED` con `rejectionCode`
`processing_error`. Antes fallaba con `MALFORMED_RESPONSE`. El simulador no reproduce estas órdenes.

### Paso a paso de implementación en Sandbox (Orders API)

1. **Crear la Orden:** Envía la solicitud a `POST /v1/orders` utilizando tu `Access Token` de prueba:



```json
{
  "type": "online",
  "total_amount": "5000",
  "external_reference": "ext_ref_1234",
  "processing_mode": "automatic",
  "expiration_time": "PT20M",
  "payer": {
    "email": "test_user_co@testuser.com",
    "entity_type": "individual",
    "identification": {
      "type": "CC",
      "number": "76262349"
    },
    "first_name": "John",
    "last_name": "Doe",
    "phone": {
      "area_code": "57",
      "number": "3001234567"
    },
    "address": {
      "street_name": "Calle 10",
      "street_number": "100",
      "city": "Bogota",
      "zip_code": "110111",
      "neighborhood": "Centro"
    }
  },
  "transactions": {
    "payments": [
      {
        "amount": "5000",
        "payment_method": {
          "id": "pse",
          "type": "bank_transfer",
          "financial_institution": "1051"
        }
      }
    ]
  },
  "additional_info": {
    "payer.ip_address": "200.100.50.25"
  },
  "config": {
    "online": {
      "callback_url": "https://merchant.com/pse/return"
    }
  }
}

```

2. **Obtener la URL de Redirección:** La respuesta devolverá `status: "action_required"` y `status_detail: "waiting_transfer"`. Ubica y extrae la URL del campo:
`transactions.payments[0].payment_method.redirect_url`


3. **Simular el Pago en el Sandbox:**

> Con las credenciales del vendedor de prueba, la `redirect_url` lleva a este simulador
> (`bc_pse_sim`, 15 de octubre de 2026); con las credenciales anteriores llevaba al portal real de ACH
> Colombia (14 de octubre de 2026). Los pasos siguientes no se recorrieron.

* Abre la `redirect_url` en el navegador para ingresar al simulador bancario.


* Ingresa **cualquier usuario y contraseña** en la pantalla inicial de inicio de sesión del banco.


* En el menú desplegable de escenarios, selecciona el estado de prueba deseado (**Aprobación**, **Abandono**, **Fondos Insuficientes**, **Cuenta Inactiva**, etc.) y haz clic en **Enviar**.


* Haz clic en **Volver al comercio** para ser redirigido automáticamente a la `callback_url`.





---

## 3. Verificación y Operaciones de Prueba

### Verificar el Estado de una Compra

Para consultar el resultado final de cualquier transacción (tarjeta o PSE), realiza una petición `GET` al endpoint de la API:

```http
GET https://api.mercadopago.com/v1/orders/{id}

```

Reemplaza `{id}` por el identificador de la orden devuelto en la creación. El campo `status` contendrá el resultado de la prueba.

### Consulta de un identificador que no existe (5 de octubre de 2026)

> **Nota del 15 de octubre de 2026.** Medido con el par `APP_USR-` anterior, que por inferencia era
> de producción de la cuenta real (nota de «Credenciales»). El `404` de `GET /v1/payments/{id}` se
> repitió igual con el vendedor de prueba (sección 1.3).

> **Medido contra la API real entre las 11:58 y las 12:11 (UTC−5).** Las órdenes se consultaron
> con el token `APP_USR-`. Con ese token, `GET /v1/orders/{id}` sí responde; el `401` de las líneas
> 108 a 111 es del token `TEST-` en `POST /v1/orders` y no se volvió a medir.

| Consulta | Respuesta |
| --- | --- |
| `GET /v1/payments/1` o `/v1/payments/99999999999` | `404 {"message":"Payment not found","error":"not_found","status":404,"cause":[{"code":2000,"description":"Payment not found","data":"<fecha>;<uuid>"}]}` |
| `GET /v1/payments/abc` (no numérico) | `404` con el cuerpo del enrutador: `{"error":"resource not found","message":"Si quieres conocer los recursos de la API…"}` |
| `GET /v1/orders/ORD01JZZZZZZZZZZZZZZZZZZZZZZZ` (con la forma del id real) | `404 {"errors":[{"code":"order_not_found","message":"Order not found."}]}` |
| `GET /v1/orders/ORDabc` (formato inválido) | `400 {"errors":[{"code":"invalid_path_param","message":"path param order id is invalid"}]}` |

Las dos APIs usan sobres de error distintos, igual que con `X-Idempotency-Key`. La medición no
registró el formato de la fecha de `cause[].data`. El simulador imita las filas primera y tercera,
y responde a la segunda como a la primera, y a la cuarta como a la tercera.

### Reembolsos de Prueba

Si necesitas realizar un reembolso de prueba (`POST /v1/orders/{id}/refund`), ejecuta el llamado a la API utilizando únicamente tu **`Access Token` de prueba** (`APP_USR-`).

---

## 4. Duplicados e idempotencia en la Orders API (15 de octubre de 2026)

> **Medido entre las 21:37 y las 21:45 (UTC−5) contra `POST /v1/orders`, con las credenciales del
> vendedor de prueba**, con tarjeta y con PSE. Lo registra el informe de esa medición, que resume
> los resultados; los cuerpos completos no quedaron guardados en el repositorio, salvo los dos
> sobres de error de la tabla, que se copian textuales.

| Caso | Respuesta |
| --- | --- |
| Misma `external_reference`, distinta `X-Idempotency-Key` | `201` y `201`: dos órdenes y dos cobros aprobados (tarjeta 2 de 2, PSE 2 de 2). Mercado Pago **no rechaza** una referencia repetida |
| Misma llave, mismo cuerpo | `201` con una copia byte a byte de la respuesta original, aunque la orden haya cambiado de estado desde entonces, y una sola orden. Tardó unos 200–300 ms, frente a 1,1–1,5 s de la creación |
| Misma llave, otro cuerpo (monto, token o referencia) | `409 {"errors":[{"code":"idempotency_key_already_used","message":"X-Idempotency-Key already used. Please retry with a different value."}]}`, sin crear orden |
| Misma llave, dos peticiones en paralelo | `201` y `423 {"errors":[{"code":"resource_locked","message":"Idempotency key locked. Please retry after some time."}]}` |
| Rechazo (titular `OTHE`, `402`) y reintento con otra tarjeta y la **misma** llave | `409` |
| El mismo token del rechazo con una llave nueva | La segunda orden responde `402 invalid_card_token`: no hay segundo cobro |

Ninguna cabecera de la respuesta repite la llave, y `x-request-id` cambia en cada petición.

**La documentación oficial.** La referencia de creación de órdenes
([create-order](https://www.mercadopago.com.uy/developers/en/reference/online-payments/checkout-api/create-order/post))
describe la llave con 1 a 128 caracteres, lista `409`, `423` y `500` entre las respuestas, y da
`external_reference` como opcional, de hasta 64 caracteres y sin unicidad. La vigencia de 24 horas de
la llave aparece solo en la documentación de Point y no se midió.

**Lo que se hizo con esto.** El SDK sigue mandando una llave nueva en cada `createPayment()`: con una
llave derivada de la referencia, un rechazo no se podría reintentar con otra tarjeta (daría `409`). El
`423` llega como `RESOURCE_LOCKED`, un error transitorio, desde la 0.6.0-rc.2. La API de Simulación
imita la idempotencia medida en `POST /v1/sim/mercadopago/orders` y, con el monto 10 409, crea las dos
órdenes (`docs/02-arquitectura/3-api-de-simulacion.md`).