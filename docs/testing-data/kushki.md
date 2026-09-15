# Credenciales

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
> 
> 

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
2. **Token.** Se pide con `bankId` (de la lista del paso 1), `callbackUrl`, `userType`,
   `documentType`, `documentNumber`, `email`, `currency` (`COP`) y el objeto `amount` descompuesto.
3. **Iniciar.** `POST /transfer/v1/init` con el token, autenticando con `Private-Merchant-Id`.
   Devuelve `redirectUrl`.
4. **Redirigir** al pagador a esa `redirectUrl`.
5. **Resultado.** `GET /transfer/v1/status/{token}` con `Private-Merchant-Id`, o por webhook. El
   banco confirma a PSE, PSE notifica a Kushki y Kushki al comercio.

**Verificación de las rutas contra la API UAT real.** Las tres se probaron sin credencial válida
para confirmar que existen. El truco fue comparar contra una ruta inventada, porque AWS API Gateway
responde distinto en cada caso:

| Ruta | Respuesta sin credencial | Lectura |
| --- | --- | --- |
| `GET /transfer/v1/bankList` | `403` — `no identity-based policy allows...` | **Existe** |
| `POST /transfer/v1/init` | `403` — `no identity-based policy allows...` | **Existe** |
| `GET /transfer/v1/status/{token}` | `403` — `no identity-based policy allows...` | **Existe** |
| `GET /transfer/v1/rutaQueNoExiste` (control) | `403` — `Missing Authentication Token` | **No existe** |

### 5.3. Tipos de documento válidos en Colombia

`CC` (cédula de ciudadanía), `NIT`, `CE` (cédula de extranjería), `TI` (tarjeta de identidad) y
`PP` (pasaporte). El enum completo de la API incluye valores de otros países
(`RUC`, `CURP`, `RFC`, `RUT`, `DNI`, `PAS`, `CI`, `DE`) que **no aplican a Colombia**: el adaptador
no debe aceptarlos para una transacción colombiana solo porque la API los liste.

### 5.4. Datos de prueba en Sandbox

Al solicitar el token de `transfer in`, la simulación se controla mediante el número de
identificación del usuario. El estado final se consulta llamando al endpoint de consulta de estado:

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