# Credenciales

El primer paso para probar la API es tener las credenciales y sus keys, estas se encontrarán en el archivo `.env`:

* **`RAPYD_ACCESS_KEY`**: Clave de acceso generada en el Dashboard de Sandbox.


* **`RAPYD_SECRET_KEY`**: Clave secreta para la firma de peticiones.



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