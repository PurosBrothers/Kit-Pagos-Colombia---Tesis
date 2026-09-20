# Credenciales

> Alcance actual: el SDK y la API de Simulación usan datos ficticios y un token simulado para pruebas de contrato. Estas credenciales y tarjetas solo aplican cuando se implemente la integración directa con el sandbox de Kushki.

> **Las credenciales de API aparecieron el 18 de septiembre de 2026** (issue #64), en el dashboard
> UAT del comercio *KIT PAGOS COLOMBIA Branch Colombia*, en Desarrolladores → Credenciales. Con ellas
> se midió el flujo completo de Transfer In, y medirlo encontró cuatro defectos que las pruebas
> unitarias no podían ver (sección 5.2 y punto 48 del `architecture-log.md`). Antes de eso solo había
> credenciales de *dashboard*, y el SDK estaba escrito contra la documentación.

El primer paso para probar la API es disponer de las credenciales de Sandbox y configurar las keys de entorno necesarias en el archivo `.env`:

* **`KUSHKI_PUBLIC_MERCHANT_ID`**: Identificador público del comercio para entorno de pruebas.


* **`KUSHKI_PRIVATE_MERCHANT_ID`**: Clave privada de comercio para firmar las peticiones del lado del servidor.



Para integrar los ambientes de prueba (Sandbox) de **Kushki**, asegúrate de dirigir las peticiones a los endpoints de pruebas asignados y utilizar los datos de simulación que se detallan a continuación.

base sandbox URL: `https://api-uat.kushkipagos.com`

---

# Datos de Prueba en Sandbox — Kushki

## 1. Pagos Únicos con Tarjeta (Crédito / Débito)

Para probar la recepción de pagos únicos con tarjeta:

| Estado / Escenario | Número de Tarjeta | Código / Mensaje de Respuesta |
| --- | --- | --- |
| **Aprobada (`APPROVED`)** | `5451 9515 7492 5480` | `(000) Transacción aprobada` |
| **Declinada en Token** | `4574 4412 1519 0335` | `(017) Tarjeta no válida` |
| **Rechazada en Cobro** | `4349 0030 0004 7015` | `(017) Tarjeta no válida` |
| **Tarjeta no Compatible** | `4349 0085 1665 6431` | `(019) Tarjeta no compatible` |
| **Sin Fondos** | `4349 0012 1084 6432` | `(021) Tarjeta sin fondos` |
| **CVV Inválido** | `4349 0032 4337 1321` | `(022) Imposible verificar CVV` |
| **Tarjeta Bloqueada** | `4349 0013 8678 1322` | `(023) Tarjeta bloqueada por el banco` |

> **Nota:** Para todas las tarjetas de prueba, el CVV, Código Postal y Fecha de Expiración en el futuro son libres (cualquier valor es válido).

### 1.1. El cobro medido contra la API real (19 de septiembre de 2026)

El cobro con tarjeta son dos llamadas, y las tres cosas que el SDK tenía mal estaban en la
segunda (punto 50 del `architecture-log.md`):

| Paso | Llamada | Autenticación |
| --- | --- | --- |
| 1 | `POST /card/v1/tokens` con el objeto `card`, `totalAmount` y `currency` | `Public-Merchant-Id` |
| 2 | `POST /card/v1/charges` con el token, el `amount` desglosado y `fullResponse: true` | `Private-Merchant-Id` |

- **La ruta es `/card/v1/charges`.** `POST /charges` responde `403 Forbidden`, exactamente lo
  mismo que una ruta inventada, así que ese 403 no dice nada sobre si la ruta existe.
- **El token tiene que ser real.** Con el literal `"simulated-token"` responde
  `400 K001 "Cuerpo de la petición inválido."`.
- **Hace falta `fullResponse: true`.** Sin esa bandera la respuesta es
  `{ticketNumber, transactionReference}` y nada más: no trae monto ni estado, así que no
  alcanza para saber si el cobro salió. Con la bandera, el estado llega en
  `details.transactionStatus` y el monto desarmado en campos sueltos (`subtotalIva0`,
  `ivaValue`, `currencyCode`), no como el objeto `amount` que se envió.
- **Las cuotas se llaman `months`** y son opcionales.
- **La cuenta UAT aprueba todo.** Las tarjetas de rechazo de la tabla de arriba se cobraron y
  respondieron `APPROVAL`, así que los desenlaces de rechazo no se pudieron observar.
- **La tarjeta que la tabla de arriba lista como aprobada no tokeniza en esta cuenta.**
  `5451 9515 7492 5480` responde `400 K006 "DFR029 - Bin de tarjeta inválido"` en
  `POST /card/v1/tokens`: el BIN no está habilitado para el comercio. Las tarjetas de rechazo
  de la misma tabla sí tokenizan, así que no es la tabla entera, es esa fila para esta cuenta.
  Para probar conviene una Visa de prueba genérica (`4242 4242 4242 4242`), que tokeniza y
  aprueba.
- **Kushki no expone cómo consultar un cobro con tarjeta, y la búsqueda quedó agotada.** El 19
  de septiembre se sondearon nueve rutas candidatas con los dos identificadores que devuelve el
  cobro —`ticketNumber` y `transactionId`— y con las dos llaves: treinta y seis sondeos, todos
  `403`, y **ninguno distinguible de una ruta inventada**. Se usó el discriminador de la sección
  5.2 y un control positivo (`/transfer/v1/bankList`) que confirma que el método sí encuentra
  las rutas que existen.

  | Ruta | Privada | Pública | Veredicto |
  |---|---|---|---|
  | `/transfer/v1/bankList` (control positivo) | `401` de la aplicación | `200` | existe |
  | `/card/v1/charges/{ticket}` | `403` sin ruta | `403` sin ruta | **no existe** |
  | `/charges/{ticket}` | `403 "Forbidden"` | `403 "Forbidden"` | **no existe** |
  | `/card/v1/transaction/{id}`, `/card/v1/transactions/{id}`, `/analytics/v1/transaction/{id}`, `/transaction/v1/status/{id}`, `/card/v1/charges/{id}/status`, `/v1/charges/{id}`, `/card/v2/charges/{id}` | `403` sin ruta | `403` sin ruta | **no existen** |
  | `/rutaInventada/abc123` y `/card/v1/rutaInventada/{ticket}` (controles) | `403` sin ruta | `403` sin ruta | no existen |

  **Qué usar en su lugar:** el cobro **ya trae su estado final** en la respuesta de creación
  cuando se pide con `fullResponse: true`, que es lo que el SDK hace siempre, y los cambios
  posteriores llegan por webhook. Desde el punto 53, `getPaymentStatus()` sobre un cobro con
  tarjeta falla con `UNSUPPORTED_OPERATION` y un mensaje que dice esto; antes devolvía
  `INVALID_CREDENTIALS`, que mandaba a rotar llaves que estaban bien.

  El sondeo con sus controles quedó como script ejecutable en
  `sdk/test/sandbox/probe-kushki-status.ts`, para que esto se pueda volver a medir en vez de
  creerle a este párrafo.

---

## 2. Validación Antifraude en Tarjetas

Para probar el servicio de validación de riesgo/antifraude (TransUnion), envía los campos `documentNumber` y `documentType` dentro del objeto `contactDetails` al momento de la petición de cobro:

| Escenario | Tarjeta (Token) | Documento (`documentNumber`) | Tipo (`documentType`) | Respuesta Retornada |
| --- | --- | --- | --- | --- |
| **Validación Aprobada** | `4349 0032 4337 1321` | `80004393` | `CC` | `(000) TransUnion Approval` |
| **Validación Rechazada** | `5642 5698 1649 7595` | `8000000` | `CC` | `(322) TransUnion Declined` |
| **Validación No Realizada** | Cualquier tarjeta | *No enviar* | *No enviar* | `(006) TransUnion Unavailable` |

---

## 3. Pagos con Autenticación 3D Secure (3DS)

Para probar flujos únicos y recurrentes con 3DS, utiliza cualquier CVV, cualquier fecha futura y el código OTP de prueba **`1234`**:

### A. Transacciones Aprobadas con Modal 3DS (Genera desafío visual)

* `4456 5280 8038 9860`

* `4456 5292 6723 4200`

* `4456 5291 6532 8302`

* `4456 5248 6977 0255`

* `4456 5233 4006 9956`


### B. Transacciones Aprobadas sin Modal 3DS (Frictionless / Exención)

* `4456 5400 0000 0063`

* `4456 5433 7171 3314`

* `4456 5419 8206 8615`

* `4456 5412 4981 1088`


---

## 4. Pagos con Validación OTP

### Paso a paso de implementación

1. **Crear Transacción:** Solicita el cobro utilizando la tarjeta deseada.


2. **Monto de Prueba Requerido:** Ingresa exactamente **`555`** como monto durante la validación del código OTP para garantizar que la transacción resulte exitosa.


3. **Escenarios:**
* Usar la tarjeta `5451 9515 7492 5480` para obtener respuesta `(000) Transacción aprobada`.


* Usar la tarjeta `4574 4412 1519 0335` para probar el fallo `(017) Tarjeta no válida` en solicitud de token.





---

## 5. Transferencias Bancarias (Transfer In) — **este es PSE en Kushki**

> **Respuesta a la pregunta que abrió el issue #68.** Sí: en Kushki, PSE **es** Transfer In, no es
> un método aparte. La documentación oficial lo dice sin rodeos en
> `docs.kushki.com/co/en/transfer-payments/overview/`: *"With Kushki your users can make payments
> with wire transfers through PSE"*. No existe un método llamado `pse` en su API; el mecanismo se
> llama `transfer`. Verificado el **15 de septiembre de 2026**.

### 5.1. Kushki tiene dos versiones de PSE, y cambian la redirección

Esta es la diferencia que hay que tener en cuenta antes de implementar, porque altera el flujo del
usuario y no solo un nombre de campo:

| Versión | Qué pasa tras crear la transacción |
| --- | --- |
| **PSE (1.0)** | La `redirectUrl` lleva al **portal de PSE**. Ahí el usuario llena campos y todavía debe pulsar "Ir al banco" |
| **PSE Avanza (2.0)** | La `redirectUrl` lleva **directo al portal del banco** ya elegido, sin página intermedia |

La documentación advierte que *"la URL de redirección dependerá de la versión de PSE que se esté
usando"*. En PSE Avanza, además, si Kushki detecta que faltan datos del pagador, **inserta un
formulario propio y una página de autorización de tratamiento de datos** antes de mandar al banco.
Consecuencia para el SDK: el destino de la redirección **no es predecible desde el código**, depende
de la configuración del comercio en Kushki. No se puede aseverar en la documentación del SDK que la
redirección lleva al banco.

### 5.2. Flujo completo (cinco pasos)

A diferencia de la tarjeta, PSE en Kushki **exige pedir la lista de bancos antes de poder cobrar**:

1. **Lista de bancos.** `GET /transfer/v1/bankList`, autenticando con el header
   `Public-Merchant-Id`. La referencia de Kushki es explícita: *"This endpoint is required only for
   Transfer In payment method in Colombia. In Chile, it is optional."* La lista se actualiza del
   lado de Kushki, no se cachea a mano.
2. **Token.** `POST /transfer/v1/tokens`, **en plural** (ver la tabla de rutas de abajo),
   autenticando con `Public-Merchant-Id`. Se pide con `bankId` (de la lista del paso 1),
   `callbackUrl`, `userType`, `documentType`, `documentNumber`, `email`, `currency` (`COP`) y el
   objeto `amount` descompuesto. **Acá viaja la URL de retorno del comercio**, en el paso previo al
   cobro: es la única pasarela de las cuatro donde no va en la creación del pago, y la razón por la
   que el adaptador de tarjeta de Kushki no tiene dónde poner `ReturnUrlConfig`.
3. **Iniciar.** `POST /transfer/v1/init` con el token **y el monto otra vez**, autenticando con
   `Private-Merchant-Id`. Devuelve `redirectUrl`.
4. **Redirigir** al pagador a esa `redirectUrl`.
5. **Resultado.** `GET /transfer/v1/status/{token}` con `Private-Merchant-Id`, o por webhook. El
   banco confirma a PSE, PSE notifica a Kushki y Kushki al comercio.

**Verificación de las rutas contra la API UAT real.** Las tres se probaron sin credencial válida
para confirmar que existen. El truco fue comparar contra una ruta inventada, porque AWS API Gateway
responde distinto en cada caso:

| Ruta | Respuesta sin credencial | Lectura |
| --- | --- | --- |
| `GET /transfer/v1/bankList` | `403` — `no identity-based policy allows...` | **Existe** |
| `POST /transfer/v1/tokens` | `403` — `no identity-based policy allows...` | **Existe** |
| `POST /transfer/v1/token` (singular) | `403` — `Missing Authentication Token` | **No existe** |
| `POST /transfer/v1/init` | `403` — `no identity-based policy allows...` | **Existe** |
| `GET /transfer/v1/status/{token}` | `403` — `no identity-based policy allows...` | **Existe** |
| `GET /transfer/v1/rutaQueNoExiste` (control) | `403` — `Missing Authentication Token` | **No existe** |

Las dos filas del token se agregaron el **18 de septiembre de 2026** (issue #64) y cierran el hueco
que el #68 había dejado: la ruta del paso 2 es la **plural**. El singular responde igual que la ruta
de control, o sea que no existe.

### 5.2.1. El flujo medido contra la API real (18 de septiembre de 2026)

Con las credenciales de API se ejecutó el flujo entero. **Cuatro cosas no coincidían con la
documentación**, y ninguna se podía ver desde el simulador, porque el simulador reproducía lo que el
código esperaba en vez de lo que Kushki responde:

**1. `POST /transfer/v1/init` no acepta solo el token.** Hay que repetirle el monto, aunque ya viajó
al pedir el token y aunque la consulta de estado demuestra que Kushki lo tiene guardado:

| Cuerpo enviado | Respuesta |
| --- | --- |
| `{ token }` | `400` — `{"code":"T001","message":"Cuerpo de la petición inválido."}` |
| `{ token, amount }` | `201` — con `redirectUrl` |
| Todo el cuerpo del token, más `token` | `400` — `T001` |

O sea que no es "cuantos más campos, mejor": es exactamente el token y el monto.

**2. La lista de bancos empieza con un elemento que no es un banco.** `GET /transfer/v1/bankList`
devuelve 8 entradas en UAT, y la primera es el texto de relleno de un `<select>`:

```json
[{"code":"0","name":"A continuación seleccione su banco"},
 {"code":"0001","name":"Kushki bank Colombia"},
 {"code":"0002","name":"Kushki bank Ecuador"}, ... ]
```

Los bancos de UAT son ficticios (`Kushki bank Colombia`, `Kushki bank Ecuador`, ... hasta
`Kushki bank USA`), así que **de acá no se puede sacar el catálogo real de entidades colombianas**:
para eso hace falta el ambiente productivo. El SDK descarta el código `"0"`, porque es la primera
entrada y quien tome el primer elemento de la lista cobraría contra un banco que no existe.

**3. La consulta de estado devuelve otra forma, no la de un cobro con tarjeta.** No trae
`ticketNumber`, ni `transaction_status`, ni `contactDetails.email`, que son los tres campos de los que
el normalizador de tarjeta lee. Trae:

```json
{"status":"initializedTransaction","token":"7a93...","paymentDescription":"ORDER-PSE-1789775019380",
 "email":"comprador@example.com","amount":{"subtotalIva0":50000,"subtotalIva":0,"iva":0,"ice":0,
 "currency":"COP"},"transactionReference":"226e3ff4-...","bankId":"0001","documentType":"CC",
 "documentNumber":"123456789","created":1789775795525,"country":"Colombia","merchantName":"...",
 "callbackUrl":"...","userType":"0","userIp":"...","publicMerchantId":"...","trazabilityCode":"-"}
```

Dos detalles que importan para conciliar: **`paymentDescription` devuelve la referencia del comercio
intacta**, así que es el campo del que hay que leerla, y no `transactionReference`, que lo genera
Kushki. Y **una vez iniciada la transferencia la respuesta sí agrega `ticketNumber`** —más
`entityCode`, `processorId`, `processorState`, `transferProcessor`, `returnCode` y `serviceCode`—, lo
que hace que "tiene token y no tiene ticket" sea un criterio equivocado para distinguir las dos
formas. El campo que sí las distingue siempre es el nombre del estado: `status` en transferencia,
`transaction_status` en tarjeta.

**4. Los estados de transferencia son otro vocabulario.** No son los de tarjeta en otro formato:

| Momento | Estado nativo medido |
| --- | --- |
| Después de `POST /transfer/v1/tokens` | `requestedToken` |
| Después de `POST /transfer/v1/init` | `initializedTransaction` |

Los dos son **no finales**, y ninguno estaba en la tabla de traducción del SDK, así que una
transferencia en curso se reportaba como `ERROR`. Es el defecto del punto 46 otra vez, esta vez
encontrado midiendo.

**La consulta de estado de tarjeta, en cambio, quedó en duda.** `GET /charges/{id}` responde
`403 Forbidden` para cualquier identificador, **y también para una ruta de control inventada**, así
que lo medido sugiere que no es la ruta de consulta de cobros con tarjeta. La técnica del #68 no
ayuda acá: a nivel de la raíz del dominio, las rutas registradas y las inexistentes contestan igual.
Encontrar la ruta real de consulta de tarjeta es trabajo aparte; el SDK la conserva como segunda
opción porque es la que el simulador implementa.

**Lo que sigue sin medir.** El desenlace: llevar una transferencia hasta `approvedTransaction` o
`declinedTransaction` exige que una persona autorice en el portal del banco simulado, y los números
de documento de prueba de la sección 5.4 **no cambian el estado por sí solos** —los cuatro quedan en
`initializedTransaction` hasta que alguien complete la autorización—. Los estados finales de la tabla
del SDK vienen de la documentación de Kushki y están marcados como tales.

### 5.3. Tipos de documento válidos en Colombia

`CC` (cédula de ciudadanía), `NIT`, `CE` (cédula de extranjería), `TI` (tarjeta de identidad) y
`PP` (pasaporte). El enum completo de la API incluye valores de otros países
(`RUC`, `CURP`, `RFC`, `RUT`, `DNI`, `PAS`, `CI`, `DE`) que **no aplican a Colombia**: el adaptador
no debe aceptarlos para una transacción colombiana solo porque la API los liste.

### 5.4. Datos de prueba en Sandbox

Al solicitar el token de `transfer in`, la simulación se controla mediante el número de
identificación del usuario. El estado final se consulta llamando al endpoint de consulta de estado.

> **Medido el 18 de septiembre de 2026:** los cuatro escenarios responden igual hasta que alguien
> autoriza en el portal del banco. Se crearon cuatro transferencias, una por número de documento, y
> las cuatro quedaron en `requestedToken` y pasaron a `initializedTransaction` al iniciarlas. O sea
> que el número de documento **predetermina** el desenlace, pero no lo dispara: el estado final llega
> cuando el flujo del banco se completa.

| Estado Final / Escenario | Número de Identificación | Respuesta en Consulta de Estado |
| --- | --- | --- |
| **Exitosa** | `123456789` | `Successful Transaction` |
| **Inicializada (Pendiente)** | `999999990` | `Pending` |
| **Declinada** | `100000002` | `Not Authorized` |
| **Fallida** | Cualquier otro número no especificado | `Failed` |

> **Nota:** el estado `expiredTransaction` **solo aplica a México** según la referencia de Kushki, así
> que para Colombia no debe esperarse por esta vía.

### 5.5. Códigos de error de la red PSE

Estos códigos no los genera Kushki: vienen de la red PSE y llegan tal cual en la consulta de estado
o en el webhook. Son la razón por la que un `DECLINED` genérico pierde información útil:

| Código | Causa |
| --- | --- |
| `00001` | Cancelación del pago por parte del cliente |
| `00002` | Cuenta embargada |
| `00003` | Cuenta inactiva |
| `00004` | Cuenta no existe |
| `00005` | Cuenta no habilitada |
| `00006` | Cuenta no ha sido asignada |
| `00007` | Cuenta saldada |
| `00008` | El monto excede el límite autorizado |
| `00009` | Entidad financiera no disponible |
| `00010` | Fallas técnicas en la entidad financiera |
| `00011` | Fondos insuficientes |
| `00012` | Inconsistencia en datos de la transferencia |
| `00018` | Cambio en estado de la transacción |
| `00025` | Cancelada por PSE — Credibanco no confirmó el estado de la transacción |
| `00026` | OTP no informado |
| `00027` | OTP inválido |

Vale notar `00001` y `00009`: el primero es **abandono del usuario**, no un rechazo del banco, y el
segundo es **indisponibilidad de la entidad**, que es reintentable. Colapsarlos a `DECLINED` borra
esa diferencia. El valor nativo debe preservarse en `rawStatus`.

---

## 6. Pagos en Efectivo (Cash In)

Usa los siguientes números de identificación al solicitar el token de `cash in` para probar los flujos de depósito en efectivo:

| Escenario | Número de Identificación | Respuesta Retornada | Webhook Notificado |
| --- | --- | --- | --- |
| **Transacción Exitosa** | Cualquier número estándar | `Successful Transaction` | Sí |
| **Transacción Inicializada** | `9999999999` | `Transaction initialized` | **No** (sin evento webhook) |
| **Transacción Declinada** | `1000000000` | `Expired Transaction` | Sí |

---

## 7. Suscripciones y Pagos Bajo Demanda (Recurrencia)

### A. Suscripción de Tarjetas

| Estado Final | Número de Tarjeta | Respuesta |
| --- | --- | --- |
| **Aprobada** | `5451 9515 7492 5480` | `(201) Suscripción creada` |
| **Declinada en Token** | `4574 4412 1519 0335` | `(017) Transacción declinada` |

### B. Ejecució﻿n de Cobros bajo demanda

Para probar la posterior ejecución del cobro recurrente asociado a la suscripción creada:

* **`5451 9515 7492 5480`**: Retorna `(000) Transacción aprobada`.


* **`4349 0012 1084 6432`**: Retorna `(021) Tarjeta sin fondos`.


* **`4349 0013 8678 1322`**: Retorna `(023) Tarjeta bloqueada por el banco`.



---

## 8. Dispersión de Dinero (Cash Out / Transfer Out)

Para simular la salida/dispersión de fondos mediante solicitud de token de `cash out` o `transfer out`:

| Estado Final | Número de Identificación | Estado de la Transacción |
| --- | --- | --- |
| **Aprobada** | `123456789` | `Transaction status: Approval` |
| **Declinada** | `999999990` | `Transaction status: Declined` |

---

## 9. Pruebas para Integración en Plugins (Shopify)

Para certificar técnicamente la integración de pagos con tarjeta mediante plugins:

| Escenario de Certificación | Número de Tarjeta | Respuesta Esperada |
| --- | --- | --- |
| **Transacción Aprobada** | `5451 9515 7492 5480` | `(000) Transacción aprobada` |
| **Declinada en Solicitud de Token** | `4574 4412 1519 0335` | `(017) Tarjeta no válida` |
| **Rechazada en Solicitud de Cobro** | `4000 0001 2789 6006` | `(017) Tarjeta no válida` |
