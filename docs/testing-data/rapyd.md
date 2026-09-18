# Credenciales

El primer paso para probar la API es tener las credenciales y sus keys, estas se encontrarán en el archivo `.env`:

* **`RAPYD_API_ACCESS_KEY`**: Clave de acceso generada en el Dashboard de Sandbox.


* **`RAPYD_API_SECRET_KEY`**: Clave secreta para la firma de peticiones.



Para integrar los ambientes de prueba (Sandbox) de **Rapyd**, las peticiones deben dirigirse a la URL base: `[https://sandboxapi.rapyd.net/v1/](https://sandboxapi.rapyd.net/v1/)`.

A continuación se detallan los datos de prueba específicos para las tarjetas y los flujos de simulación de errores y 3D Secure (3DS) en Sandbox.

---

# Datos de Prueba en Sandbox — Rapyd

## 1. Tarjetas de Crédito / Débito (Transacciones Exitosas)

Para realizar transacciones de prueba exitosas en la API (`POST /v1/payments`) o en la Hosted Checkout Page (`POST /v1/checkout`):

| Estado Final | Número de Tarjeta | Fecha de Expiración | CVC |
| --- | --- | --- | --- |
| **Aprobada (`SUCCESS` / `CLO`)** | `4111 1111 1111 1111` | Cualquier fecha futura | 3 dígitos cualquiera (ej: `123`) |
| **Aprobada (`SUCCESS` / `CLO`)** | `4462 0300 0000 0000` | Cualquier fecha futura | 3 dígitos cualquiera (ej: `123`) |

> **Nota:** Puedes usar cualquier fecha de expiración en el futuro y cualquier CVC de 3 dígitos.
> 
> 

---

## 2. Tarjetas de Crédito / Débito (Transacciones con Error)

Para simular rechazos o errores en el procesamiento de tarjetas en Sandbox:

| Tipo de Rechazo / Error | Número de Tarjeta | Código de Error Retornado |
| --- | --- | --- |
| **Do Not Honor** | `4111 1111 1111 1105` | `ERROR_PROCESSING_CARD - [05]` |
| **Stolen Card, pick up** | `4111 1111 1111 1143` | `ERROR_PROCESSING_CARD - [43]` |
| **Insufficient Funds** | `4111 1111 1111 1151` | `ERROR_PROCESSING_CARD - [51]` |

> **Nota:** Estas tarjetas son válidas tanto para la API de pagos directa como para las Hosted Checkout Pages en Sandbox.
> 
> 

### Ejemplos de Payloads de Error (API)

```json
// Do Not Honor
{
  "status": {
    "error_code": "ERROR_PROCESSING_CARD - [05]",
    "status": "ERROR",
    "message": "Do Not Honor",
    "response_code": "ERROR_PROCESSING_CARD - [05]",
    "operation_id": "43c320f4-5f4a-4f89-a874-8da5df13ac82"
  }
}

// Stolen Card
{
  "status": {
    "error_code": "ERROR_PROCESSING_CARD - [43]",
    "status": "ERROR",
    "message": "Stolen Card, pick up",
    "response_code": "ERROR_PROCESSING_CARD - [43]",
    "operation_id": "6c0830fd-415d-4775-9410-afefd51773c3"
  }
}

// Insufficient Funds
{
  "status": {
    "error_code": "ERROR_PROCESSING_CARD - [51]",
    "status": "ERROR",
    "message": "Insufficient Funds",
    "response_code": "ERROR_PROCESSING_CARD - [51]",
    "operation_id": "563694e5-3454-474a-92b0-24ae720538b7"
  }
}

```

---

## 3. Simulación de Autenticación 3D Secure (3DS) vía API

### Paso a paso de implementación en Sandbox (API)

1. **Crear Pago:** Envía la solicitud a `POST /v1/payments` configurando una de estas condiciones para gatillar el 3DS:


* Un monto (`amount`) igual o superior a `1000` (ej: `1050`).


* Para montos menores a `1000`, agrega `"3d_required": true` en `payment_method_options`.





```json
{
  "amount": 1050,
  "currency": "USD",
  "payment_method": {
    "type": "is_visa_card",
    "fields": {
      "number": "4111111111111111",
      "expiration_month": "12",
      "expiration_year": "25",
      "cvv": "789",
      "name": "John Doe"
    }
  },
  "capture": true
}

```

2. **Obtener URL de Redirección:** La respuesta inicial mantendrá el estado `status: "ACT"` y la acción `next_action: "3d_verification"`. Extrae el enlace de `data.redirect_url`:



```json
{
  "status": {
    "status": "SUCCESS"
  },
  "data": {
    "id": "payment_b050cb27b65c3d7b742e59e0f68d059c",
    "status": "ACT",
    "next_action": "3d_verification",
    "redirect_url": "https://sandboxcheckout.rapyd.net/3ds-payment?token=payment_b050cb27b65c3d7b742e59e0f68d059c"
  }
}

```

3. **Completar Autenticación:** Pega la URL en tu navegador. En el simulador de 3DS de Rapyd ingresa el código **`123456`** y presiona **Continue**.


4. **Verificación:** La transacción finalizará con el webhook `PAYMENT_COMPLETED` y estado `status: "CLO"`.



> **Nota:** Las operaciones simuladas con 3DS deben autenticarse en un lapso máximo de 15 minutos.
> 
> 

---

## 4. Simulación de Autenticación 3D Secure (3DS) vía Hosted Page

### Paso a paso de implementación

1. **Crear Checkout Page:** Envía la solicitud a `POST /v1/checkout` con un `amount` mayor o igual a `1000`:



```json
{
  "amount": 450,
  "country": "IS",
  "currency": "ISK",
  "payment_method_type": "is_visa_card"
}

```

2. **Redirección del Usuario:** Redirige al cliente a la URL obtenida en `data.redirect_url`.


3. **Ingresar Tarjeta:** Completa la información en la página alojada de Rapyd utilizando la tarjeta `4111 1111 1111 1111` y haz clic en **Place Your Order**.


4. **Autenticar:** Serás llevado automáticamente a la pantalla de 3DS. Ingresa el código **`123456`** y haz clic en **Continue** para completar el pago y disparar el webhook `PAYMENT_COMPLETED`.

---

## 5. PSE (Pagos Seguros en Línea)

> **Procedencia de esta sección.** Todo lo que sigue se obtuvo llamando el sandbox real de Rapyd
> (`https://sandboxapi.rapyd.net`) el **15 de septiembre de 2026**, con las credenciales
> `RAPYD_API_ACCESS_KEY` / `RAPYD_API_SECRET_KEY` del `.env`, firmando con la propia función
> `computeRapydSignature()` del SDK. No es documentación pública transcrita: la documentación
> pública de Rapyd **no menciona PSE en ninguna página**, y su sitemap completo contiene un solo
> método colombiano (`bancolombia.html`). Ver `architecture-log.md`, punto 19.

### 5.1. PSE no es un método de pago, son 47

Rapyd no expone un `co_pse_bank` único. `GET /v1/payment_methods/countries/CO` devuelve **97
métodos** para Colombia, de los cuales **71 son de categoría `bank_redirect`**, y esos 71 se
reparten en **dos familias distintas que no son intercambiables**:

| Familia | Cantidad | Patrón | Qué es | Reembolsable |
| --- | --- | --- | --- | --- |
| **A — PSE** | **47** | `co_pse_{banco}_bank` | PSE real. El banco queda fijado por el tipo. Exige documento del pagador y objeto `customer`. | **No** (los 47) |
| **B — Redirección bancaria** | 24 | `co_{banco}_bank` | Otro producto. Incluye el botón Bancolombia, Addi y Bre-B. Mayoría sin campos obligatorios. | Mayoría sí |

**El infijo `pse_` es la única forma de distinguirlas, y no es opcional.** `co_bancolombia_bank` y
`co_pse_bancolombia_bank` existen los dos, apuntan al mismo banco y se comportan distinto:
el primero no exige **ningún** campo (`fields`, `payment_options` y `payment_method_options` vienen
vacíos) y por eso redirige a la página de SafetyPay a escoger banco; el segundo exige documento del
pagador y trae el banco ya fijado.

### 5.2. Metadatos de la familia PSE

Los **47** métodos `co_pse_*` son idénticos en todas estas dimensiones — se verificó una por una,
no se asumió:

| Propiedad | Valor (idéntico en los 47) |
| --- | --- |
| `category` | `bank_redirect` |
| `payment_flow_type` | `redirect_url` |
| `currencies` | `["COP"]` únicamente |
| `is_refundable` | `false` |
| `is_cancelable` | `false` |
| `is_expirable` | `true` |
| `is_tokenizable` | `false` |
| `supports_subscription` | `false` |
| `maximum_expiration_seconds` | `1209600` (14 días) |
| `amount_range_per_currency` | COP con `minimum_amount` y `maximum_amount` en `null` (sin límites declarados) |

Tres consecuencias directas para el SDK: **no hay reembolso ni cancelación por API** para PSE en
Rapyd, **no se puede tokenizar ni suscribir**, y la transacción **expira** (hasta 14 días), así que
`EXPIRED` es un estado final alcanzable y no teórico.

### 5.3. Campos obligatorios (`GET /v1/payment_methods/{type}/required_fields`)

Se consultaron los `required_fields` de **los 71** métodos `bank_redirect` y se agruparon por
esquema idéntico. Salieron **6 esquemas distintos**, y **los 47 de PSE comparten exactamente uno**:

| Campo | Ubicación | Obligatorio | Expresión regular |
| --- | --- | --- | --- |
| `customer_identification_type` | `payment_method.fields` | **Sí** | `^(RC\|TI\|CC\|CE\|PP\|DE\|NIT)$` |
| `customer_identification_number` | `payment_method.fields` | **Sí** | `^[A-Za-z0-9-]{5,20}$` |
| `merchant_identification_type` | `payment_method.fields` | No | `^(CC\|CE\|PP\|NIT\|DE)$` |
| `merchant_identification_number` | `payment_method.fields` | No | `^[A-Za-z0-9-]{5,20}$` |

> **Corrección de una afirmación previa del proyecto.** `ubiquitous-language.md` afirmaba que el
> documento del pagador viajaba en un campo `identification_value`, condicionado por monto. Es
> **falso** en los dos aspectos: son **dos** campos, se llaman `customer_identification_type` y
> `customer_identification_number`, y son **obligatorios siempre**, sin condición de monto.

El tipo de documento admite **siete** valores: `RC` (Registro Civil), `TI` (Tarjeta de Identidad),
`CC`, `CE`, `PP`, `DE` y `NIT`. Es el conjunto más amplio de las cuatro pasarelas, así que un
`documentType` que Rapyd acepta puede ser rechazado por las otras tres — nunca al revés.

Los otros cinco esquemas de la familia B, para referencia de quien los confunda:

| Esquema | Métodos | Campos |
| --- | --- | --- |
| 2 | 16 | `number_type` (`fpan\|tpan`) + opción `tavv`. Es una plantilla de **tokenización de tarjeta**, no de redirección bancaria. |
| 3 | 5 | Ninguno. Incluye `co_bancolombia_bank`, el único documentado públicamente. |
| 4 | 1 | `co_addi_bank`: `customer_identification_number` (`^[0-9]{7,10}$`) y `document_type` fijo en `^CC$`. |
| 5 | 1 | `co_bancolombia_b_bank` (Botón Bancolombia): solo `complete_payment_url`. |
| 6 | 1 | `col_bank_pay_pros` (Bre-B): opciones `bank_id` y `channel`. |

El esquema 2 confirma contra la API lo que el punto 19 había deducido de la documentación: ese
`number_type`/`tavv` es una plantilla de tarjeta reutilizada. Lo nuevo es que **no es un error
aislado de una página**, lo comparten 16 métodos reales del catálogo.

### 5.4. El objeto `customer` es obligatorio, y es una entidad aparte

Además de los campos anteriores, los 47 métodos PSE declaran en `payment_options` un `customer`
con `is_required: true`. **No es un campo del pago: es una entidad de Rapyd que hay que crear
antes**, con `POST /v1/customers`. Sus campos obligatorios:

| Campo | Obligatorio | Expresión regular | Nota |
| --- | --- | --- | --- |
| `name` | **Sí** | `^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{2,100}$` | **Solo letras y espacios.** Un dígito o un punto lo rechaza |
| `email` | **Sí** | `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$` | |
| `phone_number` | **Sí** | `^([+]?57)?[ ()-]*3[0-9]{9}$` | Celular colombiano: empieza en `3`, 10 dígitos. `+57` opcional |

Estos tres, más el tipo y número de documento, son **exactamente** los cinco campos del objeto de
valor `Payer` del SDK (`fullName`, `email`, `phone`, `documentType`, `documentNumber`), cuatro de
los cuales estaban declarados y sin usar. Esta sección es la razón por la que existen.

La consecuencia arquitectónica es que **PSE en Rapyd no es un pago de un paso**: exige crear un
`customer` primero, y `PaymentGatewayPort` no tiene hoy dónde expresar ese paso previo.

### 5.5. Paso a paso de implementación en Sandbox (API)

1. **Listar los bancos.** `GET /v1/payment_methods/countries/CO`, filtrar
   `category === "bank_redirect"` y quedarse con los que empiecen por `co_pse_`. No hay lista
   estática publicada: el catálogo se pide por API y Rapyd lo actualiza.
2. **Crear el `customer`.** `POST /v1/customers` con `name`, `email` y `phone_number` respetando
   las expresiones regulares de arriba. Guardar el `id` devuelto (prefijo `cus_`).
3. **Crear el pago.** `POST /v1/payments` con el tipo del banco elegido:

```json
{
  "amount": "50000.00",
  "currency": "COP",
  "customer": "cus_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "payment_method": {
    "type": "co_pse_bancolombia_bank",
    "fields": {
      "customer_identification_type": "CC",
      "customer_identification_number": "1999888777"
    }
  },
  "complete_payment_url": "https://comercio.example.com/pago/exito",
  "error_payment_url": "https://comercio.example.com/pago/error"
}
```

4. **Redirigir.** La respuesta trae `data.redirect_url`. Como `payment_flow_type` es
   `redirect_url`, este paso **no es opcional**: sin la redirección el pago no avanza.
5. **Esperar el resultado.** Llega por webhook, con la misma semántica por tipo de evento que el
   resto de Rapyd: `PAYMENT_COMPLETED` (`CLO`) aprobado, `PAYMENT_FAILED` (`ERR`) rechazado,
   `PAYMENT_EXPIRED` (`EXP`) si el pagador nunca autorizó dentro de los 14 días.

### 5.6. Trampas de nomenclatura confirmadas en el catálogo

Cuatro casos reales del sandbox que van a morder a quien derive nombres a mano:

| Trampa | Detalle |
| --- | --- |
| **Tres formas de pagar con BBVA** | `co_bbva_bank`, `co_bbva_colombia_bank` y `co_pse_banco_bbva_colombia_bank` coexisten |
| **Un typo en producción** | `co_bancoavvilas_bank` ("Banco AV Villa") y `co_bancoavvillas_bank` ("Banco AV Villas") coexisten, con una `l` de diferencia |
| **Sufijo duplicado** | `co_pse_lulo_bank_bank` termina en `_bank_bank` |
| **Nombre desincronizado del tipo** | `co_pse_scotiabank_colpatria_bank` se llama hoy **"Davibank"** tras el rebranding |

De la última sale una regla dura: **el nombre visible del banco se lee del campo `name` que
devuelve la API, nunca se deriva del string del tipo.** El tipo conserva la marca vieja.

### 5.7. Lo que sigue sin confirmarse

Honestidad sobre el alcance de esta verificación: se confirmó el **catálogo** y el **contrato de
campos**, no un pago completo de punta a punta. Falta por confirmar (a) qué devuelve exactamente
`data.redirect_url` para un `co_pse_*` y si la página intermedia es de PSE o de SafetyPay, y (b) si
el sandbox permite forzar estados finales de PSE como sí lo permite con las tarjetas de 3DS. Nada
de eso bloquea el diseño de `PaymentMethod`, que es lo que este issue tenía que desbloquear.

> **Nota sobre el catálogo del sandbox.** La documentación de Rapyd advierte que en sandbox
> `List Payment Methods by Country` devuelve **todos** los métodos de la plataforma, mientras que en
> producción devuelve solo los que la organización tiene habilitados. Los 47 `co_pse_*` prueban que
> el catálogo existe y cuál es su contrato, **no** que una cuenta de producción los tenga los 47
> activos.