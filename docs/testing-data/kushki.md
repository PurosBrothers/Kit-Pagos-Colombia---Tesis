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

## 5. Transferencias Bancarias (Transfer In)

Al solicitar el token de `transfer in`, la simulación se controla mediante el número de identificación del usuario. El estado final se consulta llamando al endpoint de consulta de estado:

| Estado Final / Escenario | Número de Identificación | Respuesta en Consulta de Estado |
| --- | --- | --- |
| **Exitosa** | `123456789` | `Successful Transaction` |
| **Inicializada (Pendiente)** | `999999990` | `Pending` |
| **Declinada** | `100000002` | `Not Authorized` |
| **Fallida** | Cualquier otro número no especificado | `Failed` |

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